import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '.data');
const input = process.argv[2] || path.join(DATA_DIR, 'educoder-raw.json');
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const list = Array.isArray(raw) ? raw[0]?.data || [] : raw.data || [];
if (!Array.isArray(list) || !list.length) {
  console.error('未找到 Educoder dataSource');
  process.exit(1);
}

const course = '高程26秋';

function toIso(value) {
  if (!value) return null;
  const text = String(value).replace(' ', 'T');
  const date = new Date(text.includes('+') ? text : `${text}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const assignments = list.map((item, index) => {
  const statuses = Array.isArray(item.status) ? item.status.join(' ') : String(item.status || '');
  const workStatus = Array.isArray(item.work_status) ? item.work_status.join(' ') : String(item.work_status || '');
  let status = 'pending';
  if (/查看作品|已提交|已批阅|已批改/.test(workStatus)) status = 'submitted';
  if (/已批改|已评分|已批阅/.test(statuses)) status = 'graded';
  if (item.un_commit_work) status = 'pending';

  return {
    id: `educoder-${item.homework_id || index}`,
    platform: 'educoder',
    course,
    title: item.name || 'Educoder 作业',
    description: `${item.author || 'Educoder'} · ${statuses || '作业'}`,
    dueAt: toIso(item.end_time_s || item.end_time) || new Date().toISOString(),
    status,
    done: status !== 'pending',
    score: null,
    type: item.is_shixun ? '实验' : '作业',
    priority: 'normal',
    points: '',
    url: 'https://www.educoder.net/classrooms/6ryliqfk/common_homework',
  };
});

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(
  path.join(DATA_DIR, 'educoder.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), course, assignments }, null, 2),
  'utf8'
);
console.log(`已生成 ${assignments.length} 项 Educoder 作业 -> .data/educoder.json`);
