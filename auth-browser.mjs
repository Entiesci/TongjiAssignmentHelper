import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const jobs = new Map();
let activeId = null;

function prepareTemp(dataDir) {
  const tempDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.TMP = tempDir;
  process.env.TEMP = tempDir;
  return tempDir;
}

export function getLoginJob(id) {
  return jobs.get(id) || null;
}

export function startLogin(source, dataDir, credentials = {}) {
  const config = SOURCES[source];
  if (!config) throw new Error(`不支持的数据源：${source}`);

  if (activeId) {
    const active = jobs.get(activeId);
    if (active && active.status === 'waiting') {
      if (active.source === source) return active;
      throw new Error('已有另一个登录窗口正在进行，请先完成或关闭它');
    }
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    source,
    status: 'waiting',
    message: `请在打开的浏览器窗口中完成${config.name}登录`,
    startedAt: Date.now(),
    cookie: null,
    snapshot: null,
  };
  jobs.set(id, job);
  activeId = id;

  runLogin(job, config, dataDir, credentials)
    .catch((error) => {
      job.status = 'failed';
      job.message = error.message || '登录失败';
    })
    .finally(() => {
      if (activeId === id) activeId = null;
      setTimeout(() => jobs.delete(id), 10 * 60 * 1000).unref?.();
    });

  return job;
}

export function startTongjiLogin(dataDir) {
  return startLogin('tongji', dataDir);
}

/**
 * 用已登录的持久化浏览器配置，在后台无头刷新快照，不需要用户重新登录。
 * 登录态失效时抛错，调用方保留旧快照并提示重新一键登录。
 */
export async function autoLoginTongji({ username, password, dataDir }) {
  if (!username || !password) throw new Error('未保存账号密码');
  prepareTemp(dataDir);

  const context = await chromium.launchPersistentContext(path.join(dataDir, 'edge-profile'), {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 860 },
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://1.tongji.edu.cn/workbench', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    if (page.url().includes('iam.tongji.edu.cn')) {
      const usernameInput = page.locator('#j_username');
      if (!(await usernameInput.count())) throw new Error('没有找到统一身份认证登录表单');

      await usernameInput.fill(username);
      await page.locator('#j_password').fill(password);

      const checkcode = page.locator('#j_checkcode');
      if (await checkcode.isVisible().catch(() => false)) {
        throw new Error('登录需要验证码，请手动一键登录');
      }

      await page.locator('#loginButton').click();
      await page.waitForTimeout(4000);

      const bodyText = await page.evaluate(() => document.body.innerText || '');
      if (/用户名或密码错误|密码错误|账号或密码/.test(bodyText)) {
        throw new Error('账号或密码错误');
      }
      if (
        page.url().includes('iam.tongji.edu.cn') &&
        /验证码|二次验证|动态码|短信验证/.test(bodyText)
      ) {
        throw new Error('登录需要二次验证，请手动一键登录');
      }

      for (let attempt = 0; attempt < 15; attempt += 1) {
        if (page.url().includes('1.tongji.edu.cn') && !page.url().includes('iam.tongji.edu.cn')) {
          const ok = await page.evaluate(async () => {
            try {
              const response = await fetch(
                '/api/baseresservice/schoolCalendar/currentTermCalendar?flag=0',
                { credentials: 'include' }
              );
              return response.ok;
            } catch (error) {
              return false;
            }
          });
          if (ok) break;
        }
        await page.waitForTimeout(1000);
      }
    }

    const loggedIn = await page.evaluate(async () => {
      try {
        const response = await fetch(
          '/api/baseresservice/schoolCalendar/currentTermCalendar?flag=0',
          { credentials: 'include' }
        );
        return response.ok;
      } catch (error) {
        return false;
      }
    });
    if (!loggedIn) throw new Error('自动登录后仍未进入工作台，可能需要二次验证');

    try {
      await extractTimetable(context, dataDir);
    } catch (error) {
      console.warn('[tongji-timetable]', error.message);
    }

    try {
      await extractExams(context, dataDir);
    } catch (error) {
      console.warn('[tongji-exams]', error.message);
    }

    const cookies = await context.cookies('https://1.tongji.edu.cn');
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    if (!cookie) throw new Error('自动登录成功但没有读取到 Cookie');
    return cookie;
  } finally {
    await context.close().catch(() => {});
  }
}

export async function refreshSnapshot(source, dataDir, credentials = {}) {
  const config = SOURCES[source];
  if (!config || !config.afterLogin) {
    throw new Error('该数据源不支持自动刷新');
  }
  prepareTemp(dataDir);

  const context = await chromium.launchPersistentContext(path.join(dataDir, 'edge-profile'), {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 860 },
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    let loggedIn = await config.check(context, page);
    if (!loggedIn && config.prepare) {
      await config.prepare(page, credentials);
      await page.waitForTimeout(3000);
      loggedIn = await config.check(context, page);
    }
    if (!loggedIn) throw new Error('登录已失效，请重新一键登录');

    const { cookie, token } = await readCookies(context, config.cookieUrls);
    return await config.afterLogin(context, { cookie, token, credentials }, dataDir);
  } finally {
    await context.close().catch(() => {});
  }
}

async function runLogin(job, config, dataDir, credentials = {}) {
  const userDataDir = path.join(dataDir, 'edge-profile');
  prepareTemp(dataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--start-maximized'],
  });

  try {
    let page = context.pages()[0] || (await context.newPage());
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const deadline = Date.now() + 5 * 60 * 1000;
    let prepared = false;
    while (Date.now() < deadline) {
      const pages = context.pages().filter((candidate) => !candidate.isClosed());
      if (!pages.length) throw new Error('登录窗口已关闭');
      page = pages[pages.length - 1];

      let loggedIn = await config.check(context, page);
      if (!loggedIn && !prepared && config.prepare) {
        prepared = true;
        try {
          await config.prepare(page, credentials);
          await page.waitForTimeout(3000);
          loggedIn = await config.check(context, page);
        } catch (error) {
          /* 自动填充失败时保留窗口，让用户手动登录 */
        }
      }
      if (loggedIn) {
        const { cookie, token } = await readCookies(context, config.cookieUrls);
        if (!cookie) throw new Error('登录成功但没有读取到 Cookie');
        job.cookie = cookie;

        if (config.afterLogin) {
          job.message = '登录成功，正在同步数据…';
          const snapshot = await config.afterLogin(
            context,
            { cookie, token, credentials },
            dataDir
          );
          if (snapshot) {
            job.snapshot = snapshot;
            job.message =
              snapshot.message || `登录成功，已同步 ${snapshot.assignments?.length || 0} 项作业`;
          } else {
            job.message = '登录成功，Cookie 已自动回填';
          }
        } else {
          job.message = '登录成功，Cookie 已自动回填';
        }

        job.status = 'success';
        return;
      }

      await page.waitForTimeout(2000);
    }

    throw new Error('登录超时（5 分钟），请重试');
  } finally {
    await context.close().catch(() => {});
  }
}

async function readCookies(context, urls) {
  const cookies = await context.cookies(urls);
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  const token = cookies.find((item) => item.name === 'token')?.value || '';
  return { cookie, token };
}

function toIso(value) {
  if (!value) return null;
  const text = String(value).replace(' ', 'T');
  const date = new Date(text.includes('+') ? text : `${text}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapKetangpaiAssignments(courseData, courseName, courseId) {
  const statusMap = { 0: 'pending', 1: 'submitted', 2: 'submitted', 3: 'graded', 4: 'graded' };
  return (courseData.list || []).map((item) => {
    const status = statusMap[item.mstatus] || 'pending';
    return {
      id: `ketangpai-${item.id}`,
      platform: 'ketangpai',
      course: courseName,
      title: item.title,
      description: `${courseName} · 课堂派`,
      dueAt: new Date(Number(item.endtime) * 1000).toISOString(),
      status,
      done: status !== 'pending',
      score: item.grade ? Number(item.grade) : null,
      type: item.activitylabel || '作业',
      priority: 'normal',
      points: item.fullscore ? `${item.fullscore} 分` : '',
      url: `https://prepc.ketangpai.com/#/main/classDetail?courseid=${encodeURIComponent(
        courseId
      )}&courserole=0&submodulename=4`,
    };
  });
}

function mapEducoderAssignments(list, courseName = '高程26秋') {
  return list.map((item, index) => {
    const statuses = Array.isArray(item.status) ? item.status.join(' ') : String(item.status || '');
    const workStatus = Array.isArray(item.work_status)
      ? item.work_status.join(' ')
      : String(item.work_status || '');
    let status = 'pending';
    if (/查看作品|已提交|已批阅|已批改/.test(workStatus)) status = 'submitted';
    if (/已批改|已评分|已批阅/.test(statuses)) status = 'graded';
    if (item.un_commit_work) status = 'pending';

    const end = item.end_time_s || item.end_time;
    const date = end ? new Date(String(end).replace(' ', 'T') + '+08:00') : null;

    return {
      id: `educoder-${item.homework_id || index}`,
      platform: 'educoder',
      course: courseName,
      title: item.name || 'Educoder 作业',
      description: `${item.author || 'Educoder'} · ${statuses || '作业'}`,
      dueAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString(),
      status,
      done: status !== 'pending',
      score: null,
      type: item.is_shixun ? '实验' : '作业',
      priority: 'normal',
      points: '',
      url: 'https://www.educoder.net/classrooms/6ryliqfk/common_homework',
    };
  });
}

function normalizeWeeks(value) {
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const text = String(value || '')
    .replace(/[\[\]（）()]/g, '')
    .trim();
  if (!text) return [];
  const even = text.includes('双');
  const odd = text.includes('单');
  const weeks = new Set();
  for (const part of text.split(/[,，、\s]+/)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)/);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i += 1) {
        if (even && i % 2 !== 0) continue;
        if (odd && i % 2 === 0) continue;
        weeks.add(i);
      }
      continue;
    }
    const n = Number(part.replace(/[^\d]/g, ''));
    if (n > 0) weeks.add(n);
  }
  return [...weeks].sort((a, b) => a - b);
}

function mapTimetableCourses(courses) {
  const start = new Date('2026-09-14T00:00:00');
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const events = [];
  const seen = new Set();

  for (const course of courses) {
    if (course.remove) continue;
    const weeks = normalizeWeeks(course.weeks);
    if (!weeks.length || !course.dayOfWeek) continue;
    const location =
      course.roomLable ||
      course.roomIdI18n ||
      course.classRoomName ||
      (String(course.roomId) === '0' ? '线上课堂' : course.classRoom) ||
      '—';
    const description = [course.teacherName, course.className, course.weekNum, course.campusI18n]
      .filter(Boolean)
      .join(' · ');

    for (const week of weeks) {
      const date = new Date(start);
      date.setDate(start.getDate() + (week - 1) * 7 + (course.dayOfWeek - 1));
      const id = `course-${course.teachingClassId}-${week}-${course.dayOfWeek}-${course.timeStart}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push({
        id,
        date: ymd(date),
        week,
        title: course.courseName,
        category: 'course',
        time: `第${course.timeStart}-${course.timeEnd}节`,
        location,
        description,
        course: course.courseName,
        teacher: course.teacherName || '',
      });
    }
  }

  if (!events.some((event) => event.title.includes('高级语言') && event.location.includes('学校机房'))) {
    for (const week of [2, 4, 6, 8, 10, 12, 14, 16]) {
      const date = new Date(start);
      date.setDate(start.getDate() + (week - 1) * 7 + 4);
      events.push({
        id: `course-eie120201-lab-${week}-5-7`,
        date: ymd(date),
        week,
        title: '高级语言程序设计（人工智能拔尖班）',
        category: 'course',
        time: '第7-8节',
        location: '学校机房(四平路)',
        description: '彭瑞(07110) · 01班 · [2, 4, 6, 8, 10, 12, 14, 16] · 四平路校区',
        course: '高级语言程序设计（人工智能拔尖班）',
        teacher: '彭瑞',
      });
    }
  }

  events.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  return {
    generatedAt: new Date().toISOString(),
    semester: {
      id: '2026-2027-1',
      academicYear: '2026-2027',
      term: '第一学期',
      name: '2026 学年 · 第一学期',
      shortName: '2026 · 第一学期',
      startDate: '2026-09-14',
      endDate: '2027-01-17',
      totalWeeks: 18,
      currentWeek: 10,
      teachingWeekStart: 1,
      teachingWeekEnd: 16,
      examWeekStart: 17,
      examWeekEnd: 18,
    },
    events,
  };
}

async function extractTimetable(context, dataDir) {
  for (const route of ['/GraduateStudentTimeTable', '/StudentTimeTable']) {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`https://1.tongji.edu.cn${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (bodyText.includes('无权限') || bodyText.includes('登录统一身份认证')) continue;

    let courses = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      courses = await page.evaluate(() => {
        const root = document.querySelector('#app')?.__vue__;
        if (!root) return null;
        const seen = new Set();
        const stack = [root];
        while (stack.length) {
          const vm = stack.pop();
          if (!vm || seen.has(vm)) continue;
          seen.add(vm);
          const data = vm.$data || {};
          const list =
            (Array.isArray(data.lessonTimeTableDatas) && data.lessonTimeTableDatas) ||
            (Array.isArray(data.tableData) && data.tableData);
          if (list && list.length && list.some((item) => item && item.courseName)) {
            return list;
          }
          (vm.$children || []).forEach((child) => stack.push(child));
        }
        return null;
      });
      if (courses) break;
      await page.waitForTimeout(1000);
    }

    if (courses && courses.length) {
      const snapshot = mapTimetableCourses(courses);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'timetable.json'), JSON.stringify(snapshot, null, 2), 'utf8');
      return snapshot;
    }
  }
  return null;
}

async function extractExams(context, dataDir) {
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://1.tongji.edu.cn/workbench', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2500);

  await page.goto('https://1.tongji.edu.cn/StuExamEnquiries', {
    waitUntil: 'domcontentloaded',
    referer: 'https://1.tongji.edu.cn/workbench',
    timeout: 60000,
  });

  let payload = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    payload = await page.evaluate(() => {
      const root = document.querySelector('#app')?.__vue__;
      if (!root) return null;
      const seen = new Set();
      const stack = [root];
      while (stack.length) {
        const vm = stack.pop();
        if (!vm || seen.has(vm)) continue;
        seen.add(vm);
        const data = vm.$data || {};
        if (Array.isArray(data.tableData) && data.tableData.length) {
          const term = Array.isArray(data.termList) ? data.termList[0] : null;
          const times = term?.noWeekendWorkTimes || term?.weekendWorkTimes || [];
          return {
            rows: data.tableData,
            periods: times.map((item) => ({
              node: Number(item.classNode),
              start: item.beginTime,
              end: item.endTime,
            })),
          };
        }
        (vm.$children || []).forEach((child) => stack.push(child));
      }
      return null;
    });
    if (payload) break;
    await page.waitForTimeout(1000);
  }

  if (!payload || !payload.rows.length) return null;

  const exams = [];
  const undated = [];

  for (const row of payload.rows) {
    const courseName = String(row.courseName || '').trim();
    if (!courseName) continue;

    if (!row.examDate || !row.startTime || !row.endTime) {
      undated.push({
        title: courseName,
        remark: row.remark || '考核方式待定',
        examTime: row.examTime || '',
      });
      continue;
    }

    const date = String(row.examDate).slice(0, 10);
    const location =
      row.examSite || row.roomName || row.roomNames || row.roomNameStr || '待定';
    const time = `${row.startTime}-${row.endTime}`;
    const description = [
      row.examTime,
      location !== '待定' ? location : '',
      row.remark,
    ]
      .filter(Boolean)
      .join(' · ');

    exams.push({
      id: `exam-${row.calendarId || 'term'}-${row.newTeachingClassCode || row.courseCode || courseName}-${date}`,
      date,
      week: Number(row.weekNumber) || null,
      title: courseName,
      category: 'exam',
      time,
      location,
      description,
      course: courseName,
      teacher: row.teacherName || row.teacherStr || '',
    });
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    exams,
    undated,
    periods: payload.periods.filter((item) => item.node >= 1 && item.node <= 11),
  };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'exams.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  return snapshot;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapCanvasAssignments(course, assignments) {
  return assignments.map((assignment) => {
    const submission = assignment.submission || {};
    let status = 'pending';
    if (submission.workflow_state === 'submitted') status = 'submitted';
    if (submission.workflow_state === 'graded' || submission.score != null) status = 'graded';

    return {
      id: `canvas-${assignment.id}`,
      platform: 'canvas',
      course: course.name || course.course_code || 'Canvas 课程',
      title: assignment.name,
      description: stripHtml(assignment.description) || '无详细说明',
      dueAt: assignment.due_at || new Date().toISOString(),
      status,
      done: status !== 'pending',
      score: submission.score ?? null,
      type: /quiz/i.test(assignment.submission_types?.[0] || '') ? '测验' : '作业',
      priority: 'normal',
      points: assignment.points_possible != null ? `${assignment.points_possible} 分` : '',
      url:
        assignment.html_url ||
        `https://canvas.tongji.edu.cn/courses/${course.id}/assignments/${assignment.id}`,
    };
  });
}

const SOURCES = {
  tongji: {
    name: '同济大学门户',
    loginUrl: 'https://1.tongji.edu.cn/workbench',
    cookieUrls: ['https://1.tongji.edu.cn'],
    async check(context, page) {
      if (!page.url().includes('1.tongji.edu.cn') || page.url().includes('iam.tongji.edu.cn')) {
        return false;
      }
      return page.evaluate(async () => {
        try {
          const response = await fetch(
            '/api/baseresservice/schoolCalendar/currentTermCalendar?flag=0',
            { credentials: 'include' }
          );
          return response.ok;
        } catch (error) {
          return false;
        }
      });
    },
    async afterLogin(context, credentials, dataDir) {
      const snapshot = await extractTimetable(context, dataDir);
      let examCount = 0;
      try {
        const exams = await extractExams(context, dataDir);
        examCount = exams?.exams?.length || 0;
      } catch (error) {
        console.warn('[tongji-exams]', error.message);
      }

      if (snapshot) {
        return {
          message: `登录成功，已同步 ${snapshot.events.length} 条课程、${examCount} 场考试`,
        };
      }
      return { message: '登录成功，但未提取到个人课表（可能当前账号无课表权限）' };
    },
  },

  ketangpai: {
    name: '课堂派',
    loginUrl: 'https://prepc.ketangpai.com/#/login',
    cookieUrls: [
      'https://prepc.ketangpai.com',
      'https://www.ketangpai.com',
      'https://openapiv5.ketangpai.com',
    ],
    async prepare(page, credentials) {
      const { username, password } = credentials?.ketangpai || {};
      if (!username || !password) return;

      const account = page.getByPlaceholder('请输入邮箱/手机号/账号').first();
      if (!(await account.count())) return;
      await account.fill(username);
      await page.getByPlaceholder('请输入密码').first().fill(password);
      const login = page.getByRole('button', { name: '登录', exact: true }).first();
      if (await login.count()) await login.click().catch(() => {});
      await page.waitForTimeout(3000);
    },
    async check(context, page) {
      if (page && page.url().includes('#/login')) return false;
      const { cookie, token } = await readCookies(context, this.cookieUrls);
      if (!cookie) return false;
      try {
        const response = await fetch('https://openapiv5.ketangpai.com/CourseApi/myAllCourses', {
          headers: { cookie, token, accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return false;
        const json = await response.json().catch(() => null);
        return Boolean(json && json.status === 1);
      } catch (error) {
        return false;
      }
    },
    async afterLogin(context, { cookie, token }, dataDir) {
      const response = await fetch('https://openapiv5.ketangpai.com/CourseApi/myAllCourses', {
        headers: { cookie, token, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const json = await response.json().catch(() => null);
      const courses = json && Array.isArray(json.data) ? json.data : [];
      const assignments = [];

      for (const course of courses.slice(0, 10)) {
        const page = context.pages()[0] || (await context.newPage());
        await page.goto(
          `https://prepc.ketangpai.com/#/main/classDetail?courseid=${encodeURIComponent(
            course.id
          )}&courserole=0&submodulename=4`,
          { waitUntil: 'domcontentloaded', timeout: 60000 }
        );
        await page.waitForTimeout(4000);

        const homeworkTab = page.getByText('作业', { exact: true }).first();
        if (await homeworkTab.count()) {
          await homeworkTab.click().catch(() => {});
          await page.waitForTimeout(2000);
        }

        let courseData = null;
        for (let attempt = 0; attempt < 15; attempt += 1) {
          courseData = await page.evaluate(() => {
            const root = document.querySelector('#app')?.__vue__;
            if (!root) return null;
            const seen = new Set();
            const stack = [root];
            while (stack.length) {
              const vm = stack.pop();
              if (!vm || seen.has(vm)) continue;
              seen.add(vm);
              const data = vm.$data || {};
              if (data.courseData && Array.isArray(data.courseData.list) && data.courseData.list.length) {
                return data.courseData;
              }
              (vm.$children || []).forEach((child) => stack.push(child));
            }
            return null;
          });
          if (courseData) break;
          await page.waitForTimeout(1000);
        }

        if (courseData) {
          assignments.push(
            ...mapKetangpaiAssignments(
              courseData,
              course.coursename || course.name || '课堂派课程',
              course.id
            )
          );
        }
      }

      const snapshot = {
        generatedAt: new Date().toISOString(),
        courseName: courses.map((course) => course.coursename).filter(Boolean).join('、'),
        courseId: courses[0]?.id || '',
        assignments,
      };

      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'ketangpai.json'), JSON.stringify(snapshot, null, 2), 'utf8');
      return snapshot;
    },
  },

  educoder: {
    name: 'Educoder',
    loginUrl: 'https://www.educoder.net/classrooms/6ryliqfk/common_homework',
    cookieUrls: ['https://www.educoder.net', 'https://data.educoder.net'],
    async prepare(page, credentials) {
      const { username, password } = credentials?.educoder || {};
      if (!username || !password) return;

      const tab = page.getByText('账号登录', { exact: true }).first();
      if (await tab.count()) await tab.click().catch(() => {});
      await page.waitForTimeout(500);

      let account = page.locator('#login').first();
      if (!(await account.count())) {
        account = page
          .locator(
            'input[placeholder*="手机号"], input[placeholder*="账号"], input[placeholder*="用户名"], input[name="login"], input[name="user[login]"]'
          )
          .first();
      }
      if (!(await account.count())) return;
      await account.fill(username);

      const pass = page.locator('#password, input[type="password"]').first();
      if (!(await pass.count())) return;
      await pass.fill(password);

      const login = page
        .locator('button[type="submit"]')
        .filter({ hasText: '登录' })
        .first();
      if (await login.count()) await login.click().catch(() => {});
      await page.waitForTimeout(5000);

      const bodyText = await page.evaluate(() => document.body.innerText || '');
      if (/用户名或密码错误|账号或密码错误/.test(bodyText)) {
        throw new Error('Educoder 用户名或密码错误，请检查账号密码，或改用扫码登录');
      }
      if (/验证码/.test(bodyText)) {
        throw new Error('Educoder 登录需要验证码，请改用扫码登录');
      }
    },
    async check(context, page) {
      try {
        const loggedIn = await page.evaluate(() => {
          const text = document.body.innerText || '';
          return text.includes('退出课堂') || text.includes('当前身份');
        });
        if (loggedIn) return true;
      } catch (error) {
        /* 页面切换中，继续用接口兜底 */
      }

      const { cookie } = await readCookies(context, this.cookieUrls);
      if (!cookie) return false;
      try {
        const response = await fetch(
          'https://data.educoder.net/api/users/get_user_info.json?course_id=6ryliqfk&school=1',
          {
            headers: { cookie, accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!response.ok) return false;
        const json = await response.json().catch(() => null);
        return Boolean(json && (json.status === 0 || json.data));
      } catch (error) {
        return false;
      }
    },
    async afterLogin(context, { cookie }, dataDir) {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto('https://www.educoder.net/classrooms/6ryliqfk/common_homework', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForTimeout(5000);

      const labels = ['课后作业', '图文作业', '编程作业', '分组作业', '在线考试'];
      const seen = new Set();
      const assignments = [];

      for (const label of labels) {
        const tab = page.getByText(label, { exact: true }).first();
        if (await tab.count()) {
          await tab.click().catch(() => {});
          await page.waitForTimeout(2500);
        }

        const lists = await page.evaluate(() => {
          const element = document.querySelector('#root') || document.body;
          const key = Object.keys(element).find((name) => name.startsWith('__reactContainer$'));
          if (!key) return [];
          const root = element[key].stateNode?.current || element[key];
          const out = [];
          const visited = new Set();
          const stack = [root];
          while (stack.length) {
            const fiber = stack.pop();
            if (!fiber || visited.has(fiber)) continue;
            visited.add(fiber);
            const props = fiber.memoizedProps;
            if (props && typeof props === 'object') {
              for (const propKey of Object.keys(props)) {
                const value = props[propKey];
                if (
                  propKey === 'dataSource' &&
                  Array.isArray(value) &&
                  value.some(
                    (item) =>
                      item &&
                      typeof item === 'object' &&
                      (item.homework_id || item.name)
                  )
                ) {
                  out.push(value);
                }
              }
            }
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
          }
          return out;
        });

        for (const list of lists) {
          for (const item of list) {
            const id = item.homework_id || item.name;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            assignments.push(item);
          }
        }
      }

      const snapshot = {
        generatedAt: new Date().toISOString(),
        course: '高程26秋',
        assignments: mapEducoderAssignments(assignments),
      };

      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'educoder.json'), JSON.stringify(snapshot, null, 2), 'utf8');
      return snapshot;
    },
  },

  canvas: {
    name: 'Canvas',
    loginUrl: 'https://canvas.tongji.edu.cn/',
    cookieUrls: ['https://canvas.tongji.edu.cn'],
    async prepare(page, credentials) {
      if (!page.url().includes('iam.tongji.edu.cn')) return;
      const canvasCreds = credentials?.canvas || {};
      const tongjiCreds = credentials?.tongji || {};
      const username = canvasCreds.username || tongjiCreds.username;
      const password = canvasCreds.password || tongjiCreds.password;
      if (!username || !password) return;

      await page.locator('#j_username').fill(username);
      await page.locator('#j_password').fill(password);
      if (await page.locator('#j_checkcode').isVisible().catch(() => false)) return;
      await page.locator('#loginButton').click().catch(() => {});
      await page.waitForTimeout(4000);
    },
    async check(context, page) {
      if (page.url().includes('iam.tongji.edu.cn')) return false;
      return page.evaluate(async () => {
        try {
          const response = await fetch('/api/v1/users/self', { credentials: 'include' });
          return response.ok;
        } catch (error) {
          return false;
        }
      });
    },
    async afterLogin(context, { credentials }, dataDir) {
      const page = context.pages()[0] || (await context.newPage());
      const filter = credentials?.canvas?.courseFilter || '大学物理A1';

      const result = await page.evaluate(
        async ({ filter }) => {
          const coursesResponse = await fetch(
            '/api/v1/courses?enrollment_state=active&per_page=100',
            { credentials: 'include' }
          );
          if (!coursesResponse.ok) {
            return { error: `Canvas 课程接口返回 ${coursesResponse.status}` };
          }
          const courses = await coursesResponse.json();
          const keyword = String(filter || '').trim();
          const matched = courses.filter(
            (course) =>
              String(course.id) === keyword ||
              `${course.name || ''} ${course.course_code || ''}`.includes(keyword)
          );
          if (!matched.length) {
            return {
              error: `未找到课程“${keyword}”`,
              courses: courses.map((course) => course.name).filter(Boolean),
            };
          }

          const items = [];
          for (const course of matched) {
            const assignmentsResponse = await fetch(
              `/api/v1/courses/${course.id}/assignments?per_page=100&order_by=due_at&include[]=submission`,
              { credentials: 'include' }
            );
            if (!assignmentsResponse.ok) continue;
            const assignments = await assignmentsResponse.json();
            for (const assignment of assignments) items.push({ course, assignment });
          }
          return { items };
        },
        { filter }
      );

      if (result.error) throw new Error(result.error);

      const assignments = result.items.map(
        ({ course, assignment }) => mapCanvasAssignments(course, [assignment])[0]
      );
      const snapshot = {
        generatedAt: new Date().toISOString(),
        course: [...new Set(result.items.map((item) => item.course.name).filter(Boolean))].join('、'),
        assignments,
      };

      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'canvas.json'), JSON.stringify(snapshot, null, 2), 'utf8');
      return snapshot;
    },
  },
};
