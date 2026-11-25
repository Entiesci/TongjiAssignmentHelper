import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '.data');
const input = process.argv[2] || path.join(DATA_DIR, 'timetable-raw.json');
const source = JSON.parse(fs.readFileSync(input, 'utf8'));
const component = source.find((item) => item.key === 'lessonTimeTableDatas');
if (!component) {
  console.error('未找到 lessonTimeTableDatas');
  process.exit(1);
}

const startDate = '2026-09-14';
const start = new Date(`${startDate}T00:00:00`);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

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

for (const course of component.data) {
  if (course.remove) continue;
  const weeks = normalizeWeeks(course.weeks);
  if (!weeks.length || !course.dayOfWeek) continue;
  const location =
    course.roomLable ||
    course.roomIdI18n ||
    course.classRoomName ||
    (String(course.roomId) === '0' ? '线上课堂' : course.classRoom) ||
    '—';
  const teacher = course.teacherName || '';
  const className = course.className || '';
  const campus = course.campusI18n || '';
  const timeText = `第${course.timeStart}-${course.timeEnd}节`;

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
      time: timeText,
      location,
      description: [teacher, className, course.weekNum, campus].filter(Boolean).join(' · '),
      course: course.courseName,
      teacher,
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
    startDate,
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

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'timetable.json'), JSON.stringify(data, null, 2), 'utf8');
console.log(`已生成 ${events.length} 条课程事件 -> .data/timetable.json`);
