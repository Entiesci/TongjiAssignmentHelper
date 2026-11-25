import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '.data');
const input = process.argv[2] || path.join(DATA_DIR, 'ketangpai-raw.json');
const entries = JSON.parse(fs.readFileSync(input, 'utf8'));
const courseDataEntry = entries.find((entry) => entry.key === 'courseData');
const courseBaseEntry = entries.find((entry) => entry.key === 'courseBaseData');
if (!courseDataEntry) {
  console.error('未找到 courseData');
  process.exit(1);
}

const courseData = courseDataEntry.data;
const courseBase = courseBaseEntry ? courseBaseEntry.data : {};
const courseName = courseBase.coursename || '课堂派课程';
const courseId = courseData.list[0]?.courseid || '';
const statusMap = { 0: 'pending', 1: 'submitted', 2: 'submitted', 3: 'graded', 4: 'graded' };

const assignments = courseData.list.map((item) => {
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
    url: `https://prepc.ketangpai.com/#/main/classDetail?courseid=${encodeURIComponent(courseId)}&courserole=0&submodulename=4`,
  };
});

const data = {
  generatedAt: new Date().toISOString(),
  courseName,
  courseId,
  assignments,
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'ketangpai.json'), JSON.stringify(data, null, 2), 'utf8');
console.log(`已生成 ${assignments.length} 项课堂派作业 -> .data/ketangpai.json`);
