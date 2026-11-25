import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '.data');
const START_DATE = '2026-09-14';
const start = new Date(`${START_DATE}T00:00:00`);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const TEMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TEMP_DIR, { recursive: true });
process.env.TMP = TEMP_DIR;
process.env.TEMP = TEMP_DIR;

const context = await chromium.launchPersistentContext(path.join(DATA_DIR, 'edge-profile'), {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1280, height: 860 },
});

try {
  const creds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'credentials.json'), 'utf8'));
  const cookieHeader = creds.tongji?.cookie || '';
  const cookies = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      return index > 0 ? { name: part.slice(0, index), value: part.slice(index + 1) } : null;
    })
    .filter(Boolean);
  if (cookies.length) {
    await context.addCookies(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: 'https://1.tongji.edu.cn',
      }))
    );
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://1.tongji.edu.cn/GraduateStudentTimeTable', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  console.log('url:', page.url());
  console.log('title:', await page.title());
  const probe = await page.evaluate(() => ({
    hasApp: Boolean(document.querySelector('#app')),
    hasVue: Boolean(document.querySelector('#app')?.__vue__),
    text: (document.body.innerText || '').slice(0, 600),
  }));
  console.log('probe:', JSON.stringify(probe, null, 2));

  if (page.url().includes('iam.tongji.edu.cn')) {
    const username = creds.tongji?.username || '';
    const password = creds.tongji?.password || '';
    if (!username || !password) {
      throw new Error('同济登录已失效，请先在账号配置里填写同济账号密码');
    }

    await page.locator('#j_username').fill(username);
    await page.locator('#j_password').fill(password);
    if (await page.locator('#j_checkcode').isVisible().catch(() => false)) {
      throw new Error('同济登录需要验证码，请先手动一键登录');
    }
    await page.locator('#loginButton').click().catch(() => {});
    await page.waitForTimeout(6000);

    if (page.url().includes('iam.tongji.edu.cn')) {
      throw new Error('同济自动登录未成功，请检查账号密码或手动一键登录');
    }

    await page.goto('https://1.tongji.edu.cn/GraduateStudentTimeTable', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(6000);
  }

  let courses = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
        if (Array.isArray(data.lessonTimeTableDatas) && data.lessonTimeTableDatas.length) {
          return data.lessonTimeTableDatas;
        }
        (vm.$children || []).forEach((child) => stack.push(child));
      }
      return null;
    });
    if (courses) break;
    await page.waitForTimeout(1000);
  }

  if (!courses || !courses.length) {
    throw new Error('页面已打开，但没有提取到 lessonTimeTableDatas');
  }

  const events = [];
  const seen = new Set();

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

  // 页面 lessonTimeTableDatas 没返回双周机房课，补上这门课的双周实验
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

  const data = {
    generatedAt: new Date().toISOString(),
    semester: {
      id: '2026-2027-1',
      academicYear: '2026-2027',
      term: '第一学期',
      name: '2026 学年 · 第一学期',
      shortName: '2026 · 第一学期',
      startDate: START_DATE,
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

  fs.writeFileSync(path.join(DATA_DIR, 'timetable.json'), JSON.stringify(data, null, 2), 'utf8');
  console.log(`已恢复 ${events.length} 条课程事件 -> .data/timetable.json`);
} finally {
  await context.close();
}
