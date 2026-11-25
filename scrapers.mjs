/* ============================================================
 * 真实数据抓取适配器
 * ------------------------------------------------------------
 * 统一使用用户提供的 Cookie / Token 请求各平台。
 * 未登录时抛出 AuthError，由前端引导用户去登录页。
 *
 * 注意：校园系统接口可能随版本变化，解析器采用“已知字段 +
 * 递归查找数组”的方式，尽量兼容；失败时返回可读错误。
 * ============================================================ */

export class AuthError extends Error {
  constructor(source, message = '需要登录') {
    super(message);
    this.name = 'AuthError';
    this.source = source;
    this.code = 'AUTH_REQUIRED';
  }
}

export class ScrapeError extends Error {
  constructor(source, message) {
    super(message);
    this.name = 'ScrapeError';
    this.source = source;
    this.code = 'SCRAPE_FAILED';
  }
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function request(url, options = {}) {
  const { method = 'GET', cookie, token, body, rawBody, headers = {}, timeout = 25000 } = options;
  const finalHeaders = {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...headers,
  };
  if (cookie) {
    finalHeaders.cookie = String(cookie)
      .replace(/^cookie\s*:\s*/i, '')
      .replace(/\r?\n/g, ' ')
      .trim();
  }
  if (token) finalHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined && !finalHeaders['content-type']) {
    finalHeaders['content-type'] = 'application/json;charset=UTF-8';
  }

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    /* HTML / 空响应 */
  }
  return { status: response.status, url: response.url, text, json, headers: response.headers };
}

function looksLikeLogin(result) {
  if (!result) return true;
  if (result.status === 401 || result.status === 403) return true;
  if (/login|cas|authserver|sso/i.test(result.url)) return true;
  if (!result.json && /<title>[^<]*(登录|统一身份认证)/i.test(result.text)) return true;
  if (
    result.json &&
    (result.json.status === -101 ||
      result.json.status === 401 ||
      result.json.code === 401 ||
      result.json.code === '401' ||
      /登录|未登录|请先登录/.test(String(result.json.message || '')))
  ) {
    return true;
  }
  return false;
}

function pick(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return undefined;
}

function textOf(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const string = String(value).trim();
  if (/^\d{10,13}$/.test(string)) {
    const number = Number(string);
    return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  }
  const normalized = string.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateKey(value) {
  const iso = toIso(value);
  if (!iso) return null;
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function collectArrays(root, limit = 400) {
  const arrays = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length && arrays.length < limit) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      arrays.push(current);
      current.slice(0, 30).forEach((item) => {
        if (item && typeof item === 'object') queue.push(item);
      });
      continue;
    }
    Object.values(current).forEach((value) => {
      if (value && typeof value === 'object') queue.push(value);
    });
  }
  return arrays;
}

function findArray(root, predicate) {
  const arrays = collectArrays(root);
  for (const array of arrays) {
    if (!array.length) continue;
    const samples = array.filter((item) => item && typeof item === 'object').slice(0, 300);
    if (samples.some((item) => predicate(item))) return array;
  }
  return null;
}

/**
 * 解析 Chrome / Edge 的 “Copy as cURL (bash)” 文本。
 * 用于 Educoder 这类需要多个隐藏请求头的接口。
 */
export function parseCurl(input) {
  let text = String(input || '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
  if (!text) return null;

  let url = null;
  const quoted = text.match(/curl(?:\.exe)?\s+(?:--[^\s]+\s+)*['"]([^'"]+)['"]/i);
  if (quoted) {
    url = quoted[1];
  } else {
    const plain = text.match(/curl(?:\.exe)?\s+([^\s]+)/i);
    if (plain) url = plain[1];
  }
  if (!url) return null;
  url = url.replace(/^\$/, '');

  const methodMatch = text.match(/(?:-X|--request)\s+['"]?([A-Za-z]+)['"]?/);
  let method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

  const headers = {};
  const headerRegex = /(?:-H|--header)\s+(['"])([\s\S]*?)\1/g;
  let headerMatch;
  while ((headerMatch = headerRegex.exec(text))) {
    const line = headerMatch[2];
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  const dataMatch = text.match(/(?:--data-raw|--data-binary|--data|-d)\s+(['"])([\s\S]*?)\1/);
  let rawBody;
  if (dataMatch) {
    rawBody = dataMatch[2];
    if (!methodMatch) method = 'POST';
  }

  return { url, method, headers, rawBody };
}

function sourceOf(result, fallback = '学校门户') {
  return textOf(pick(result, ['publishDept', 'source', 'deptName', 'senderName', 'unitName'])) || fallback;
}

/* ---------------- 同济大学 · 校历 ---------------- */
export function normalizeSemester(schoolCalendar, events) {
  const startRaw = pick(schoolCalendar, [
    'beginDay',
    'weekBeginDay',
    'startDate',
    'start_date',
    'startTime',
    'start_time',
    'beginDate',
    'beginTime',
  ]);
  const endRaw = pick(schoolCalendar, [
    'endDay',
    'endDate',
    'end_date',
    'endTime',
    'end_time',
    'finishDate',
    'finishTime',
  ]);

  let start = startRaw ? new Date(toIso(startRaw)) : null;
  let end = endRaw ? new Date(toIso(endRaw)) : null;

  if ((!start || Number.isNaN(start.getTime())) && events.length) {
    const dates = events.map((event) => new Date(`${event.date}T00:00:00`)).filter((d) => !Number.isNaN(d.getTime()));
    if (dates.length) {
      start = new Date(Math.min(...dates));
      end = new Date(Math.max(...dates));
    }
  }
  if (!start || Number.isNaN(start.getTime())) {
    throw new ScrapeError(
      'tongji',
      `校历接口返回了数据，但没有找到学期起止日期。字段：${Object.keys(schoolCalendar || {}).join(', ') || '空'}`
    );
  }
  if (!end || Number.isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + 18 * 7 * 86400000);
  }

  // 学期开始对齐到周一
  const monday = new Date(start);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const apiTotalWeeks =
    Number(pick(schoolCalendar, ['weekNum', 'totalWeeks', 'weekCount'])) ||
    Math.ceil((end - monday) / 86400000 / 7);
  const teachingWeekStart = Number(pick(schoolCalendar, ['teachingWeekStart'])) || 1;
  const teachingWeekEnd = Number(pick(schoolCalendar, ['teachingWeekEnd'])) || apiTotalWeeks;
  const examWeekStartRaw = Number(pick(schoolCalendar, ['examWeekStart']));
  const examWeekEndRaw = Number(pick(schoolCalendar, ['examWeekEnd']));
  const examWeekStart = examWeekStartRaw > 0 ? examWeekStartRaw : null;
  const examWeekEnd =
    examWeekStart && examWeekEndRaw >= examWeekStart
      ? Math.max(examWeekEndRaw, examWeekStart + 1)
      : examWeekStart
        ? examWeekStart + 1
        : null;

  // 学校接口的 endDay 会把寒假算进去（例如第 23 周），这里按“考试周考 2 周”修正：
  // 学期在第 2 个考试周结束时结束，即考试周开始 + 2 周 - 1 天。
  let totalWeeks = apiTotalWeeks;
  if (examWeekStart && examWeekEnd) {
    totalWeeks = examWeekEnd;
    end = new Date(monday.getTime() + totalWeeks * 7 * 86400000 - 86400000);
  }

  const currentWeek = Math.min(
    totalWeeks,
    Math.max(1, Math.floor((Date.now() - monday.getTime()) / 86400000 / 7) + 1)
  );

  const year =
    pick(schoolCalendar, ['year', 'academicYear', 'schoolYear']) ||
    `${monday.getFullYear()}-${monday.getFullYear() + 1}`;
  let term = pick(schoolCalendar, ['termName', 'term', 'semesterName', 'semester']);
  if (term === 1 || term === '1') term = '第一学期';
  else if (term === 2 || term === '2') term = '第二学期';
  term = term || (monday.getMonth() >= 7 ? '第一学期' : '第二学期');

  return {
    id: String(pick(schoolCalendar, ['id', 'calendarId']) || `${year}-${term}`),
    academicYear: String(year),
    term: String(term),
    name: `${year} 学年 · ${term}`,
    shortName: `${year} · ${term}`,
    startDate: dateKey(monday.toISOString()),
    endDate: dateKey(end.toISOString()),
    totalWeeks,
    currentWeek,
    teachingWeekStart,
    teachingWeekEnd,
    examWeekStart,
    examWeekEnd,
  };
}

function normalizeCalendarEvents(json) {
  const list =
    findArray(json, (item) => {
      const title = pick(item, [
        'adjustCourseRemark',
        'holidayName',
        'title',
        'name',
        'eventName',
        'calendarName',
        'remark',
      ]);
      const date = pick(item, ['date', 'startDate', 'startTime', 'beginDate', 'beginTime', 'beginDay']);
      return title && date;
    }) || [];

  const seen = new Set();
  return list
    .map((item, index) => {
      const adjustRemark = textOf(pick(item, ['adjustCourseRemark']));
      const holidayName = textOf(pick(item, ['holidayName']));
      const remark = textOf(pick(item, ['remark']));
      const title =
        adjustRemark ||
        holidayName ||
        textOf(pick(item, ['title', 'name', 'eventName', 'calendarName'])) ||
        remark;
      const startRaw = pick(item, ['date', 'startDate', 'startTime', 'beginDate', 'beginTime', 'beginDay']);
      const endRaw = pick(item, ['endDate', 'endTime', 'finishDate', 'finishTime', 'endDay']);
      const date = dateKey(startRaw);
      if (!title || !date) return null;
      const key = `${date}|${title}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const startDate = new Date(toIso(startRaw));
      const hasTime = /T|\d{1,2}:\d{2}/.test(String(startRaw));
      const time = hasTime
        ? `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
        : '全天';
      const typeRaw = String(pick(item, ['typeName', 'type', 'category', 'calendarType']) || '');
      let category = 'admin';
      if (/调课/.test(title)) category = 'adjust';
      else if (/考试|exam/i.test(typeRaw) || /考试|期末|期中/.test(title)) category = 'exam';
      else if (
        holidayName ||
        /假|节|holiday/i.test(typeRaw) ||
        /放假|假期|寒假|暑假|国庆|元旦|春节|清明|端午|中秋/.test(title)
      ) {
        category = 'holiday';
      } else if (/活动|讲座|运动|比赛|activity/i.test(typeRaw)) category = 'activity';
      else if (/教学|上课|选课|课程|teaching/i.test(typeRaw) || /上课|教学|选课|考试周/.test(title)) {
        category = 'teaching';
      }
      return {
        id: String(pick(item, ['id', 'calendarId', 'eventId']) || `event-${index}`),
        date,
        title,
        category,
        time,
        location: textOf(pick(item, ['location', 'place', 'address'])) || '—',
        description: adjustRemark || remark || holidayName || title,
        endDate: dateKey(endRaw) || date,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

export async function scrapeTongjiCalendar(options = {}) {
  const { cookie = '', curl = '' } = typeof options === 'string' ? { cookie: options } : options;
  const base = 'https://1.tongji.edu.cn';
  let calendarUrl = `${base}/api/baseresservice/schoolCalendar/currentTermCalendar?flag=0`;
  let requestOptions = { cookie };
  let listHeaders = {};

  if (curl) {
    const parsed = parseCurl(curl);
    if (!parsed) throw new ScrapeError('tongji', '校历 cURL 解析失败，请复制 currentTermCalendar 请求的 cURL。');
    calendarUrl = parsed.url;
    requestOptions = {
      method: parsed.method,
      headers: parsed.headers,
      rawBody: parsed.rawBody,
      timeout: 30000,
    };
    listHeaders = parsed.headers || {};
  }

  const term = await request(calendarUrl, requestOptions);
  if (looksLikeLogin(term)) throw new AuthError('tongji', '校历接口需要登录，请先登录统一身份认证。');
  if (!term.json) {
    throw new ScrapeError(
      'tongji',
      `校历接口返回了非 JSON 内容（${term.status}，${String(term.text || '').slice(0, 80)}）`
    );
  }

  const payload = term.json.data || term.json;
  const schoolCalendar =
    payload.schoolCalendar ||
    payload.currentTermCalendar ||
    payload.term ||
    (Array.isArray(payload) ? payload[0] : payload) ||
    {};

  const semester = normalizeSemester(schoolCalendar, []);
  const startYear = new Date(`${semester.startDate}T00:00:00`).getFullYear();
  const endYear = new Date(`${semester.endDate}T00:00:00`).getFullYear();
  const years = [...new Set([startYear, endYear].filter((year) => Number.isFinite(year)))];
  if (!years.length) years.push(new Date().getFullYear());

  const collected = [];
  for (const year of years) {
    try {
      const listResponse = await request(
        `${base}/api/baseresservice/schoolHoliday/list?year=${encodeURIComponent(year)}&t=${Date.now()}`,
        {
          headers: listHeaders,
          cookie: curl ? undefined : cookie,
        }
      );
      if (listResponse.json) {
        collected.push(...normalizeCalendarEvents(listResponse.json));
      }
    } catch (error) {
      // 某一年的节假日接口失败时，保留另一年的数据
    }
  }

  const seen = new Set();
  const events = collected.filter((event) => {
    if (!event.date || event.date < semester.startDate || event.date > semester.endDate) return false;
    const key = event.id || `${event.date}|${event.title}|${event.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const semesterStart = new Date(`${semester.startDate}T00:00:00`);
  events.forEach((event) => {
    event.week = Math.floor((new Date(`${event.date}T00:00:00`) - semesterStart) / 86400000 / 7) + 1;
  });

  console.log('[tongji-calendar] payload keys:', Object.keys(payload || {}).slice(0, 40));
  console.log('[tongji-calendar] school keys:', Object.keys(schoolCalendar || {}).slice(0, 60));
  console.log('[tongji-calendar] schoolCalendar:', JSON.stringify(schoolCalendar).slice(0, 1200));
  console.log('[tongji-calendar] list years:', years.join(','), 'events:', events.length);
  console.log('[tongji-calendar] event sample:', JSON.stringify(events.slice(0, 2)).slice(0, 800));

  return {
    semester,
    events,
    debug: {
      semesterKeys: Object.keys(schoolCalendar || {}).slice(0, 40),
      eventCount: events.length,
    },
  };
}

/* ---------------- 同济大学 · 通知 ---------------- */
export async function scrapeTongjiNotices(options = {}) {
  const { cookie = '', curl = '' } = typeof options === 'string' ? { cookie: options } : options;
  const base = 'https://1.tongji.edu.cn';
  let headers = {};

  if (curl) {
    const parsed = parseCurl(curl);
    if (parsed) headers = parsed.headers;
  }

  const response = await request(`${base}/api/commonservice/workbenchMsg/queryAllWorkbenchMsg`, {
    method: 'POST',
    headers,
    cookie: curl ? undefined : cookie,
    body: { msgType: '', readStatus: '', pageSize_: 50, pageNum_: 1 },
  });
  if (looksLikeLogin(response)) throw new AuthError('tongji', '通知接口需要登录，请先登录统一身份认证。');
  if (!response.json) throw new ScrapeError('tongji', '通知接口返回了非 JSON 内容。');

  const list =
    findArray(response.json, (item) => {
      return (
        pick(item, ['msgTitle', 'title', 'messageTitle']) &&
        pick(item, ['msgPublishTime', 'createTime', 'publishTime', 'time'])
      );
    }) || [];

  const notices = list
    .map((item, index) => {
      const title = textOf(pick(item, ['msgTitle', 'title', 'messageTitle']));
      if (!title) return null;
      const rawTime = pick(item, ['msgPublishTime', 'createTime', 'publishTime', 'time']);
      const cleanTime = String(rawTime || '').replace(/\.\d+$/, '');
      const typeCode = String(pick(item, ['msgType', 'type']) || '');
      const typeName =
        typeCode === '1' ? '通知公告' : typeCode === '2' ? '系统消息' : typeCode === '3' ? '发版通知' : '通知公告';
      let category = '教务';
      if (/学工|学生|奖|助|贷|就业|资助/.test(title)) category = '学工';
      else if (/学院|系|院系/.test(title)) category = '院系';
      else if (/讲座|活动|比赛|音乐会|运动|竞赛/.test(title)) category = '活动';
      else if (/停水|停电|后勤|图书馆|一卡通|网络|消防|生活|校医院|体检/.test(title)) category = '生活';

      return {
        id: String(pick(item, ['msgId', 'id', 'messageId']) || `notice-${index}`),
        title,
        source: sourceOf(item, '学校门户'),
        category,
        publishedAt: toIso(cleanTime) || new Date().toISOString(),
        unread: !pick(item, ['markReadStatus', 'readStatus', 'isRead']),
        pinned: false,
        summary: `学校消息中心 · ${typeName}，点击查看原文。`,
        content: ['该通知来自学校消息中心，完整正文请点击下方“打开原文”查看。'],
        attachments: [],
        url: 'https://1.tongji.edu.cn/MessageCenterNew',
        typeName,
      };
    })
    .filter(Boolean);

  return {
    notices,
    debug: { count: notices.length, keys: Object.keys(list[0] || {}).slice(0, 40) },
  };
}

/* ---------------- Canvas ---------------- */
export async function scrapeCanvas({
  baseUrl = 'https://canvas.tongji.edu.cn',
  token = '',
  cookie = '',
  curl = '',
  courseFilter = '大学物理A1',
  snapshot = null,
} = {}) {
  if (snapshot && Array.isArray(snapshot.assignments) && snapshot.assignments.length) {
    return {
      assignments: snapshot.assignments,
      debug: { snapshot: true, count: snapshot.assignments.length },
    };
  }

  const base = baseUrl.replace(/\/+$/, '');
  let coursesUrl = `${base}/api/v1/courses?enrollment_state=active&per_page=100`;
  let requestOptions = token ? { token } : { cookie };

  if (curl) {
    const parsed = parseCurl(curl);
    if (!parsed) throw new ScrapeError('canvas', 'Canvas cURL 解析失败，请复制 /api/v1/courses 请求。');
    if (/\/api\/v1\/courses/.test(parsed.url)) coursesUrl = parsed.url;
    requestOptions = { headers: parsed.headers };
  }

  const coursesResponse = await request(coursesUrl, requestOptions);
  if (looksLikeLogin(coursesResponse) || !Array.isArray(coursesResponse.json)) {
    throw new AuthError('canvas', 'Canvas 接口需要登录，请检查 API Token 或 cURL。');
  }

  const courses = coursesResponse.json.filter((course) => course && course.id);
  const keyword = String(courseFilter || '大学物理').trim();
  const matched = courses.filter((course) => {
    return (
      String(course.id) === keyword ||
      `${course.name || ''} ${course.course_code || ''}`.includes(keyword)
    );
  });

  if (!matched.length) {
    throw new ScrapeError(
      'canvas',
      `未找到课程“${keyword}”。当前课程：${courses
        .map((course) => course.name)
        .filter(Boolean)
        .join('、')}`
    );
  }

  const assignments = [];
  const errors = [];

  for (const course of matched) {
    try {
      const response = await request(
        `${base}/api/v1/courses/${course.id}/assignments?per_page=100&order_by=due_at&include[]=submission`,
        requestOptions
      );
      if (!Array.isArray(response.json)) {
        if (looksLikeLogin(response)) {
          throw new AuthError('canvas', 'Canvas 作业接口需要登录。');
        }
        errors.push(`${course.name || course.id}: 返回了非数组`);
        continue;
      }
      response.json.forEach((assignment) => {
        if (!assignment || !assignment.name) return;
        const submission = assignment.submission || {};
        let status = 'pending';
        if (submission.workflow_state === 'submitted') status = 'submitted';
        if (submission.workflow_state === 'graded' || submission.score !== null) status = 'graded';
        assignments.push({
          id: `canvas-${assignment.id}`,
          platform: 'canvas',
          course: course.name || course.course_code || 'Canvas 课程',
          title: assignment.name,
          description: textOf(assignment.description) || '无详细说明',
          dueAt: toIso(assignment.due_at) || new Date().toISOString(),
          status,
          done: status !== 'pending',
          score: submission.score ?? null,
          type: /quiz/i.test(assignment.submission_types?.[0] || '') ? '测验' : '作业',
          priority: 'normal',
          points: assignment.points_possible != null ? `${assignment.points_possible} 分` : '',
          url: assignment.html_url || `${base}/courses/${course.id}/assignments/${assignment.id}`,
        });
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      errors.push(`${course.name || course.id}: ${error.message}`);
    }
  }

  return {
    assignments,
    debug: {
      keyword,
      courses: matched.length,
      assignments: assignments.length,
      errors,
    },
  };
}

/* ---------------- Educoder ---------------- */
function extractEducoderAssignments(json, courseId, seen, referer) {
  const list =
    findArray(json, (item) => {
      return (
        pick(item, ['name', 'title', 'homework_name', 'homeworkName']) &&
        pick(item, ['end_time', 'endTime', 'deadline', 'endDate'])
      );
    }) || [];

  const out = [];
  list.forEach((item, index) => {
    const title = textOf(pick(item, ['name', 'title', 'homework_name', 'homeworkName']));
    if (!title) return;
    const due = toIso(pick(item, ['end_time', 'endTime', 'deadline', 'endDate']));
    if (!due) return;
    const id = String(pick(item, ['id', 'homework_id', 'homeworkId']) || `${courseId}-${index}-${title}`);
    if (seen.has(id)) return;
    seen.add(id);
    const rawStatus = pick(item, ['status', 'homework_status', 'submit_status']);
    let status = 'pending';
    if (rawStatus === 1 || rawStatus === '1' || /已提交|submitted/i.test(String(rawStatus))) status = 'submitted';
    if (rawStatus === 2 || rawStatus === '2' || /批阅|graded/i.test(String(rawStatus))) status = 'graded';
    out.push({
      id: `educoder-${id}`,
      platform: 'educoder',
      course: textOf(pick(item, ['course_name', 'courseName', 'classroom_name'])) || 'Educoder 课程',
      title,
      description: textOf(pick(item, ['description', 'content', 'remark'])) || '来自 Educoder 的作业',
      dueAt: due,
      status,
      done: status !== 'pending',
      type: /实验|实训|shixun/i.test(title) ? '实验' : '作业',
      priority: 'normal',
      points: '',
      url: referer,
    });
  });
  return out;
}

export async function scrapeEducoder({
  cookie = '',
  courseId = '6ryliqfk',
  apiUrl = '',
  zzud = '',
  curl = '',
  snapshot = null,
} = {}) {
  if (snapshot && Array.isArray(snapshot.assignments) && snapshot.assignments.length) {
    return {
      assignments: snapshot.assignments,
      debug: { snapshot: true, count: snapshot.assignments.length },
    };
  }

  const referer = `https://www.educoder.net/classrooms/${courseId}/common_homework`;
  const urls = [];
  if (apiUrl) {
    urls.push(apiUrl);
  } else {
    for (const type of [1, 2, 3, 4]) {
      urls.push(
        `https://data.educoder.net/api/courses/${encodeURIComponent(courseId)}/homework_commons.json?coursesId=${encodeURIComponent(
          courseId
        )}&id=${encodeURIComponent(courseId)}&limit=50&type=${type}${zzud ? `&zzud=${encodeURIComponent(zzud)}` : ''}`
      );
    }
  }

  const assignments = [];
  const seen = new Set();
  const errors = [];
  let successful = 0;

  // 1) 最稳：用户从 DevTools 复制的原始 cURL，原样复刻请求头
  if (curl) {
    const parsed = parseCurl(curl);
    if (!parsed) {
      errors.push('cURL 解析失败，请确认复制的是 “Copy as cURL (bash)”');
    } else {
      try {
        const response = await request(parsed.url, {
          method: parsed.method,
          headers: parsed.headers,
          rawBody: parsed.rawBody,
          timeout: 30000,
        });
        if (looksLikeLogin(response)) {
          throw new AuthError('educoder', 'Educoder cURL 需要登录，请重新复制请求。');
        }
        if (!response.json) {
          errors.push('cURL 返回了非 JSON 内容');
        } else if (response.json.status === -102) {
          errors.push(`cURL 返回 -102：${response.json.message || '会话校验失败'}`);
        } else if (response.json.status === -101) {
          throw new AuthError('educoder', 'Educoder cURL 返回未登录（-101）。');
        } else {
          successful += 1;
          assignments.push(...extractEducoderAssignments(response.json, courseId, seen, referer));
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        errors.push(`cURL：${error.message}`);
      }
    }
  }

  // 2) 普通 Cookie + URL 方式
  // Educoder 的 GET 请求要求把 _educoder_session 同时放进 Pc-Authorization 头
  const sessionMatch = /(?:^|;\s*)_educoder_session=([^;]+)/.exec(cookie || '');
  const pcAuthorization = sessionMatch ? decodeURIComponent(sessionMatch[1]) : '';

  for (const url of urls) {
    let response;
    try {
      response = await request(url, {
        cookie,
        headers: {
          referer,
          origin: 'https://www.educoder.net',
          accept: 'application/json',
          ...(pcAuthorization ? { 'Pc-Authorization': pcAuthorization } : {}),
        },
      });
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    if (looksLikeLogin(response)) {
      throw new AuthError('educoder', 'Educoder 接口需要登录，请先登录后再复制 Cookie。');
    }
    if (!response.json) {
      errors.push('返回了非 JSON 内容');
      continue;
    }
    if (response.json.status === -102) {
      errors.push('服务器时间校验失败（-102），请刷新页面后重新复制带 zzud 的接口地址');
      continue;
    }
    if (response.json.status === -101) {
      throw new AuthError('educoder', 'Educoder 返回未登录（-101）。');
    }
    successful += 1;
    assignments.push(...extractEducoderAssignments(response.json, courseId, seen, referer));
  }

  if (!successful) {
    throw new ScrapeError(
      'educoder',
      errors.length ? `Educoder 抓取失败：${errors[0]}` : 'Educoder 接口没有返回可解析的数据。'
    );
  }

  return {
    assignments,
    debug: { count: assignments.length, errors },
  };
}

/* ---------------- 课堂派 ---------------- */
export async function scrapeKetangpai({ cookie = '', curl = '', snapshot = null } = {}) {
  if (snapshot && Array.isArray(snapshot.assignments) && snapshot.assignments.length) {
    return {
      assignments: snapshot.assignments,
      debug: { snapshot: true, count: snapshot.assignments.length },
    };
  }

  const base = 'https://openapiv5.ketangpai.com';
  const tokenMatch = /(?:^|;\s*)token=([^;]+)/.exec(cookie || '');
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
  let options = { cookie, token };
  let coursesUrl = `${base}/CourseApi/myAllCourses`;

  if (curl) {
    const parsed = parseCurl(curl);
    if (!parsed) throw new ScrapeError('ketangpai', '课堂派 cURL 解析失败，请复制 /CourseApi 请求。');
    options = { headers: parsed.headers };
    if (/\/CourseApi\//.test(parsed.url)) coursesUrl = parsed.url;
  }

  let coursesResponse = await request(coursesUrl, options);
  if (!coursesResponse.json) {
    coursesResponse = await request(coursesUrl, {
      ...options,
      method: 'POST',
      body: {},
    });
  }
  if (looksLikeLogin(coursesResponse)) {
    throw new AuthError('ketangpai', '课堂派接口需要登录，请先登录后再复制 Cookie。');
  }
  if (!coursesResponse.json) {
    throw new ScrapeError('ketangpai', '课堂派课程接口返回了非 JSON 内容。');
  }

  const courses =
    findArray(coursesResponse.json, (item) => {
      return pick(item, ['id', 'courseId', 'course_id']) && pick(item, ['name', 'coursename', 'courseName']);
    }) || [];

  const assignments = [];
  const errors = [];

  for (const course of courses.slice(0, 40)) {
    const courseId = pick(course, ['id', 'courseId', 'course_id']);
    const courseName = textOf(pick(course, ['name', 'coursename', 'courseName']));
    let response = await request(
      `${base}/Futurev2/Homework/getListByCourseToStudent?courseId=${encodeURIComponent(courseId)}`,
      options
    );
    if (!response.json) {
      response = await request(`${base}/Futurev2/Homework/getListByCourseToStudent`, {
        ...options,
        method: 'POST',
        body: { courseId },
      });
    }
    if (!response.json) continue;

    const list =
      findArray(response.json, (item) => {
        return pick(item, ['title', 'name', 'homeworkName']) && pick(item, ['endtime', 'endTime', 'deadline']);
      }) || [];

    list.forEach((item, index) => {
      const title = textOf(pick(item, ['title', 'name', 'homeworkName']));
      const due = toIso(pick(item, ['endtime', 'endTime', 'deadline', 'end_date']));
      if (!title || !due) return;
      const rawStatus = pick(item, ['status', 'submitStatus', 'state']);
      let status = 'pending';
      if (rawStatus === 1 || rawStatus === '1' || /已提交|submitted/i.test(String(rawStatus))) status = 'submitted';
      if (rawStatus === 2 || rawStatus === '2' || /批阅|graded/i.test(String(rawStatus))) status = 'graded';
      assignments.push({
        id: `ketangpai-${pick(item, ['id', 'homeworkId']) || `${courseId}-${index}`}`,
        platform: 'ketangpai',
        course: courseName || '课堂派课程',
        title,
        description: textOf(pick(item, ['description', 'content', 'remark'])) || '来自课堂派的作业',
        dueAt: due,
        status,
        done: status !== 'pending',
        type: '作业',
        priority: 'normal',
        points: '',
        url: 'https://prepc.ketangpai.com/#/main',
      });
    });
  }

  if (!courses.length) {
    throw new ScrapeError('ketangpai', '课堂派没有返回课程列表，可能是 Cookie 失效或页面结构变化。');
  }

  return {
    assignments,
    debug: { courses: courses.length, assignments: assignments.length, errors },
  };
}

/* ---------------- 聚合 ---------------- */
export async function scrapeAll(credentials) {
  const platforms = [
    { id: 'ketangpai', name: '课堂派' },
    { id: 'educoder', name: 'Educoder' },
    { id: 'canvas', name: 'Canvas' },
  ];

  const results = await Promise.allSettled([
    credentials.ketangpai?.cookie || credentials.ketangpai?.curl || credentials.ketangpai?.snapshot
      ? scrapeKetangpai(credentials.ketangpai)
      : Promise.reject(new AuthError('ketangpai')),
    credentials.educoder?.cookie || credentials.educoder?.curl || credentials.educoder?.snapshot
      ? scrapeEducoder(credentials.educoder)
      : Promise.reject(new AuthError('educoder')),
    credentials.canvas?.token ||
    credentials.canvas?.curl ||
    credentials.canvas?.cookie ||
    credentials.canvas?.snapshot
      ? scrapeCanvas(credentials.canvas)
      : Promise.reject(new AuthError('canvas')),
  ]);

  const assignments = [];
  const errors = [];
  const statuses = platforms.map((platform, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      assignments.push(...result.value.assignments);
      return {
        ...platform,
        connected: true,
        error: null,
        debug: result.value.debug,
      };
    }
    const error = result.reason;
    if (!(error instanceof AuthError)) {
      errors.push({ platform: platform.id, message: error.message });
    }
    return {
      ...platform,
      connected: false,
      error: error.code === 'AUTH_REQUIRED' ? '未登录' : error.message,
    };
  });

  assignments.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  return { assignments, platforms: statuses, errors };
}
