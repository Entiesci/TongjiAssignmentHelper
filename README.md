# 同舟 · 校园手账

从 **同济大学门户 / Canvas / Educoder / 课堂派** 抓取真实数据，汇总成校历、学校通知、作业三个页面。

界面是手写的自定义视觉系统（纸感底色、衬线标题、细线网格、朱砂强调），**没有使用 Material 3，也没有使用任何 UI 组件库**。深色模式代码保留，但入口暂时隐藏，当前强制浅色。

> 这个版本不再自动回退演示数据。未登录时页面会显示登录墙；推荐在「账号配置」页填写各平台账号密码，后台会自动登录并同步数据。手动 Cookie / Token 作为备用。

### 版本更新检查

网页启动后会通过 jsDelivr 读取 `version.json`，如果版本比当前 `APP_VERSION` 新，就在页面内弹窗显示更新说明和 Release 链接。

- 当前版本：`assets/app.js` 里的 `APP_VERSION`
- 发布信息：仓库根目录的 `version.json`
- 发布新 Release 后，`.github/workflows/release-manifest.yml` 会自动更新 `version.json`
- 如果 GitHub Actions 不可用，发布后手动同步 `version.json` 即可

### 版本规则

当前版本：`ver.0.13`。

- 功能更新：升级到下一个 `ver.0.xx`，例如 `ver.0.14`
- 纯补丁 / 修 bug：不单独 bump 版本号
- 功能更新发布时同步修改：
  - `assets/app.js` 的 `APP_VERSION`
  - `version.json`
  - Release tag 和标题
  - 发布包文件名，例如 `tongji-hub-desktop-ver.0.14.zip`

宣发文见 [PROMO.md](PROMO.md)。

---

## 1. 运行

Windows 用户直接双击 **`start.bat`**；macOS / Linux 运行：

```bash
chmod +x start.sh
./start.sh
```

也可以手动：

```bash
cd TongjiAssignmentHelper
npm install
npm start
```

打开 <http://127.0.0.1:4173>。

要求 Node.js ≥ 18（使用内置 `fetch`）和本机 Edge；依赖 `playwright-core` 用于一键登录。

### 桌面托盘模式

不想每次手动开服务，可以用托盘版：

```bat
npm install
desktop\start-tray.bat
```

托盘版是一个 PowerShell + WinForms 托盘宿主（`TongjiTray.ps1`），不使用 Electron；界面仍在浏览器里打开，托盘右键可以打开界面、立即同步、退出。启动时会自动同步所有作业，并通过 Windows 通知提示未完成作业数和登录失败。

详见 [desktop/README.md](desktop/README.md)。

---

## 2. 使用流程

1. 打开页面，进入任意页面会看到「登录 Required」。
2. 点击侧栏 **「账号配置」**。
3. 在每个平台卡片里填写账号和密码，点「保存并登录」。
4. 也可以先把所有平台账号填好，再点右上角 **「全部自动登录」**：系统会先保存所有已填写的账号，再逐个平台登录；按钮上会显示当前正在登录的平台和整体进度条。
5. 后端用 `playwright-core` 驱动无头 Edge 完成登录，并自动同步校历、通知和作业。
6. 如果平台要求验证码 / 短信 / 微信扫码，自动登录会失败；点该平台的「手动填写」按步骤粘贴 Cookie / Token。

账号密码保存在本机 `.data/credentials.json`，浏览器配置保存在 `.data/edge-profile`。第一次自动登录需要本机 Edge，之后通常可以复用登录态。

同一时间只允许一个登录任务：有登录正在进行时，其它「保存并登录 / 仅登录 / 扫码登录 / 全部自动登录」按钮会暂时禁用，后端也会拒绝并发的登录请求，避免多个无头浏览器争用同一个配置目录。

### 2.1 同济大学门户（校历 + 通知）

推荐直接点「一键登录」。

#### 自动重登（可选）

1. 账号配置 → 同济大学门户
2. 填写学号/工号、统一身份认证密码
3. 点「保存并登录」；账号保存后默认用于自动登录

后端检测到校历/通知接口 401 时，会用 Playwright 无头登录并自动回填新 Cookie；失败会保留旧数据并提示，5 分钟内不重复尝试，避免连续试错。

注意：

- 账号密码以**明文**保存在本机 `.data/credentials.json`，仅建议个人电脑使用，不要把 `.data` 发给别人。
- 课堂派 / Educoder 的账号登录表单是页面自动化，若遇到验证码、短信或微信扫码，自动登录会失败，请用「手动填写」。
- 验证码 / 二次验证无法自动完成，会回退到手动一键登录。
- 凭据是普通 JSON，以后移植 Android 可以复用；但 Playwright 自动登录只能在桌面端运行，Android 需要改成 App 内 WebView 自动填充。

手动方式：

1. 打开 <https://1.tongji.edu.cn/> 并登录。
2. 按 `F12` → **网络 / Network** → 刷新页面 → 点任意一个 `1.tongji.edu.cn` 请求。
3. 在「请求头 / Request Headers」里复制 `Cookie:` 后面的整段内容。
4. 粘贴到「同济大学门户」的 Cookie 输入框。

后端会请求：

- `GET /api/baseresservice/schoolCalendar/currentTermCalendar?flag=0`
- `GET /api/baseresservice/schoolCalendar/list`
- `POST /api/commonservice/workbenchMsg/queryAllWorkbenchMsg`（通知列表）

### 2.2 Canvas

推荐直接点 **「一键登录」**：

1. 数据源 → Canvas → 一键登录。
2. Canvas 使用同济统一身份认证，账号密码和同济门户相同；已保存的同济账号会自动填充。
3. 登录成功后，后端在已登录的浏览器上下文里调用 Canvas REST API，生成 `.data/canvas.json` 快照。
4. 当前匹配 `大学物理A1(I) 5000281008906`，共 11 项作业。

不再依赖 API Token。Canvas Token 会自动过期，只保留为备用：

- 「填写 API Token」仍可手动粘贴 Token / cURL
- 课程过滤默认 `大学物理A1`

如果 Canvas 未登录、但同济门户已登录，打开作业页或点「同步作业」时会**自动用同济账号登录 Canvas**，不需要手动点一键登录；成功后生成 Canvas 快照，失败则 5 分钟内不重复尝试。

「同步作业」会用持久化浏览器配置无头刷新 Canvas 快照；Canvas 会话过期时会尝试复用同济账号密码自动登录。

后端调用的 Canvas 接口：

- `GET /api/v1/courses?enrollment_state=active&per_page=100`
- `GET /api/v1/courses/:id/assignments?per_page=100&order_by=due_at&include[]=submission`

### 2.3 Educoder / 头歌

推荐直接点数据源里的 **「一键登录，自动回填 Cookie」**：

1. 会打开一个独立的 Edge 窗口，停在头歌课堂页并弹出登录框（账号密码或微信扫码）。
2. 登录成功后，后端自动依次打开「课后作业 / 图文作业 / 编程作业 / 分组作业 / 在线考试」。
3. 从页面 React 数据里提取作业，生成快照并刷新页面。

也可以手动复制 Cookie：

1. 打开 <https://www.educoder.net/classrooms/6ryliqfk/common_homework> 并登录。
2. `F12` → Network → 找到 `homework_commons.json` 请求。
3. 复制请求头里的 Cookie。
4. 可选：把完整的 `homework_commons.json` 地址（带 `zzud`）粘贴到「作业接口地址」。

后端会请求：

```
GET https://data.educoder.net/api/courses/{courseId}/homework_commons.json
    ?coursesId={courseId}&id={courseId}&limit=50&type=1&zzud=...
```

并会尝试 `type=1..4`，覆盖课后作业、图文作业、编程作业等类型。

### 2.4 课堂派

推荐直接点数据源里的 **「一键登录，自动回填 Cookie」**：

1. 会打开一个独立的 Edge 窗口，进入课堂派登录页。
2. 用账号密码或手机短信完成登录。
3. 后端自动读取 Cookie，并进入课程作业页提取 `courseData`，生成作业快照。
4. 窗口自动关闭，页面刷新。

也可以手动复制 Cookie（含 `token`）粘贴。

课堂派页面使用 `https://prepc.ketangpai.com`（加载更快），API 实际地址仍是 `https://openapiv5.ketangpai.com`，请求需要同时带 Cookie 和 `token` 请求头：

- `GET /CourseApi/myAllCourses`：课程列表（已验证可用）
- 课程活动/作业列表：页面由 `courseData` 渲染，接口需要页面上下文，当前用快照导入

课堂派作业快照导入：

```bash
# 把课堂派页面导出的组件数据放到 .data/ketangpai-raw.json
node import-ketangpai.mjs
# 或指定路径
node import-ketangpai.mjs path/to/ktp-data.json
```

当前快照：`26秋工科数学分析`，9 项作业，其中「作业9」未提交。

---

## 3. 功能

### 校历

- 真实学期起止、总周数、当前周（来自 `currentTermCalendar`）
- 月历、周数、学期进度
- 真实校历事件：节假日、调课（`adjustCourseRemark`）等
- 个人课表：从教务页面导出的课程数据，按周次/星期/节次生成课程事件
- 同一天事件排序：**假期 > 调课 > 课程 > 考试 / 教学 / 活动 / 事务**
- 学期节点：开学、教学周结束、考试周、学期结束
- 导出 `.ics`

个人课表的导入：

```bash
# 把教务页面下载的组件数据放到 .data/timetable-raw.json
node import-timetable.mjs
# 也可以指定路径
node import-timetable.mjs path/to/timetable-data.json
```

生成结果在 `.data/timetable.json`，由 `/api/timetable` 提供，页面加载时自动合并进校历。

> 同济校历接口返回的是学期/周次配置，不提供“开学典礼”这类活动标题。页面用真实学期起止与周数生成上述 4 个节点；如果你有活动接口，可以在 `scrapers.mjs` 里替换。

### 学校通知

- 真实数据：`workbenchMsg/queryAllWorkbenchMsg`，当前账号 24 条通知
- 今天 / 昨天 / 本周 / 更早分组
- 分类筛选、关键词搜索、只看未读
- 桌面主从阅读、移动端全屏阅读
- 未读状态、全部标为已读（只改本地状态，不代用户操作系统）
- 列表接口只返回标题/时间/已读状态，正文通过「打开原文」查看

### 作业

- 课堂派 / Educoder / Canvas 聚合
- Canvas 只同步指定课程（当前为大学物理A1）
- 课堂派当前同步「26秋工科数学分析」9 项作业
- 「同步作业」会用已登录的持久化浏览器配置在后台无头刷新课堂派 / Educoder / Canvas 快照，不需要重新登录；同步时按钮显示「正在同步」并带进度条，当前平台放在悬停提示里
- 校历铺满内容区，点击某一天从右侧滑出当日日程抽屉
- 作业 DDL 自动写入校历，优先级最高（高于假期 / 调课 / 课程），并排在当日和未来节点最前
- 已逾期 / 今天 / 未来 7 天 / 更晚 / 已完成
- 完成状态、平台跳转、手动同步
- 未登录平台显示登录入口

---

## 4. 架构

```
浏览器
  │  同源 Cookie（本地会话）
  ▼
Node 服务（server.mjs）
  │  读取会话里的平台 Cookie / Token
  ▼
1.tongji.edu.cn / Canvas / Educoder / 课堂派
```

- `server.mjs`：静态文件 + API + 会话
- `scrapers.mjs`：各平台抓取与字段归一化
- `assets/api.js`：前端请求封装
- `assets/app.js`：路由、渲染、交互
- `assets/styles.css`：自定义设计系统

数据源凭据默认写入本机 `.data/credentials.json`，方便重启后继续使用；开启自动重登后，其中会包含**明文账号密码**。删除该文件即可清除，不要把这个文件提交到 Git 或发给别人。生产环境请改为加密存储或改用 CAS/OAuth。

---

## 5. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/sources` | 数据源列表与连接状态 |
| POST | `/api/sources/:id/credentials` | 保存账号密码 / Cookie / Token |
| POST | `/api/accounts/:id/login` | 用已保存账号密码自动登录单个平台 |
| POST | `/api/accounts/login-all` | 依次自动登录所有已配置平台 |
| DELETE | `/api/sources/:id` | 断开数据源 |
| GET | `/api/calendar` | 校历；未登录返回 401 + loginUrl |
| GET | `/api/notices` | 通知；未登录返回 401 + loginUrl |
| GET | `/api/assignments` | 聚合作业；未登录平台返回 connected=false |
| POST | `/api/assignments/sync` | 重新抓取 |
| POST | `/api/assignments/:id/done` | 本地完成状态 |
| POST | `/api/notices/:id/read` | 本地已读状态 |

401 示例：

```json
{
  "code": "AUTH_REQUIRED",
  "source": "tongji",
  "loginUrl": "https://1.tongji.edu.cn/",
  "message": "请先登录同济大学门户"
}
```

前端收到后显示登录墙，不会使用演示数据。

---

## 6. 已知限制

- Cookie 会过期，过期后重新登录并粘贴即可。
- 学校系统接口可能改版；如果字段变化，调整 `scrapers.mjs` 中对应的归一化函数。
- 同济校历事件接口和 Educoder / 课堂派的响应结构是按当前前端 bundle 推断的，首次用真实账号抓取时如果字段不一致，页面的登录墙会显示抓取错误，便于定位。
- 一键登录会打开真实统一身份认证页面，验证码 / 双因素认证由用户完成；不会代替用户输入密码。
- 一键登录需要本机安装 Edge；首次运行需要 `npm install` 安装 `playwright-core`。
- 个人课表目前是从教务页面导出的快照（`.data/timetable-raw.json`），不是实时接口；课表变动后重新导出并运行 `import-timetable.mjs`。教务的 `findStudentTimeTable` 接口使用一次性请求令牌，后端直接复用会返回 500。
- 学校校历接口的 `weekNum` / `endDay` 会把寒假算进去（23 周、次年 2 月），本项目按“考试周考 2 周”修正：第 17–18 周考试，学期在第 18 周结束（2027-01-17）。
- 节假日按学期起止年份分别请求并合并，跨年学期也能拿到次年元旦（如 2026-2027 第一学期的 2027-01-01 元旦）；学期范围外的节假日会被过滤。
- 课堂派 / Educoder 作业列表使用页面快照；「同步作业」会用持久化浏览器配置在后台刷新快照，约需 10–20 秒。
- 如果持久化配置里的登录态过期，同步会保留旧数据并提示「登录已失效，请重新一键登录」。
- 不代替用户提交作业、操作通知，只读。
- 凭据默认保存在本机 `.data/credentials.json`；如不希望落盘，删除该文件并修改 `server.mjs` 的持久化逻辑。

---

## 7. 分享给别人

不能只发 `index.html` 让对方双击打开。这个页面依赖 Node 后端完成登录、抓取、会话和一键登录；直接打开 HTML 会没有数据。

正确做法：

1. 把整个项目文件夹压缩发给对方。
2. **不要包含 `.data/`**：里面有你的 Cookie、Token、课表和作业快照，属于个人数据。
3. `node_modules/` 可以不发，对方首次启动会自动安装。
4. 对方需要安装 **Node.js 18+** 和 **Edge**。
5. Windows 双击 `start.bat`，macOS/Linux 运行 `./start.sh`。
6. 首次启动会自动 `npm install`，然后浏览器打开 <http://127.0.0.1:4173>。
7. 对方用自己的学号登录；一键登录会在他自己的电脑上打开 Edge，不会使用你的账号。

如果对方完全不想装 Node.js，可以：

- 由你在一台常开的电脑/服务器上运行，让对方通过局域网访问你的 `http://你的IP:4173`；
- 或者改成纯静态页面，但会失去后端抓取、登录和一键登录能力。

注意：一键登录需要在本机弹出浏览器，不适合没有桌面的云服务器。公网部署应改为 CAS/OAuth 后端回调，而不是把浏览器开在服务器上。

## 8. 安全与合规

- 只抓取你本人有权访问的数据。
- 不要把 Cookie / Token 提交给第三方服务。
- 不要绕过验证码、双因素认证或访问控制。
- 遵守学校和各平台的服务条款、robots 协议与接口规范。
- 生产环境应把凭据加密存储、加访问审计、按用户隔离，并使用 HTTPS。
