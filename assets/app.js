/* ============================================================
 * 同舟 · 校园手账
 * 页面逻辑：登录、路由、校历、通知、作业、平台连接
 * ============================================================ */
(function () {
  'use strict';

  const Api = window.TongjiApi;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const MONTH_EN = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY.', 'JUN.', 'JUL.', 'AUG.', 'SEP.', 'OCT.', 'NOV.', 'DEC.'];
  const CAT_LABEL = {
    deadline: '作业DDL',
    course: '课程',
    exam: '考试',
    holiday: '假期',
    adjust: '调课',
  };
  const PERIOD_SECTIONS = [
    { label: '上午', start: 1, end: 4 },
    { label: '下午', start: 5, end: 8 },
    { label: '晚上', start: 9, end: 11 },
  ];

  const DEFAULT_PERIOD_TIMES = [
    ['08:00', '08:45'],
    ['08:50', '09:35'],
    ['10:00', '10:45'],
    ['10:50', '11:35'],
    ['13:30', '14:15'],
    ['14:20', '15:05'],
    ['15:30', '16:15'],
    ['16:20', '17:05'],
    ['18:30', '19:15'],
    ['19:20', '20:05'],
    ['20:10', '20:55'],
  ];

  const CATEGORY_PRIORITY = {
    deadline: 0,
    holiday: 1,
    exam: 2,
    adjust: 3,
    course: 4,
  };

  function compareEvents(a, b) {
    const priorityA = CATEGORY_PRIORITY[a.category] ?? 99;
    const priorityB = CATEGORY_PRIORITY[b.category] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return String(a.time || '').localeCompare(String(b.time || ''));
  }
  const PLATFORM_META = {
    ketangpai: { color: '#F57C00', short: '课' },
    educoder: { color: '#00796B', short: 'E' },
    canvas: { color: '#3949AB', short: 'C' },
  };
  const SOURCE_META = {
    tongji: { color: '#17465c', short: '同' },
    canvas: { color: '#3949AB', short: 'C' },
    educoder: { color: '#00796B', short: 'E' },
    ketangpai: { color: '#F57C00', short: '课' },
  };
  const THEME_KEY = 'tongji-hub:theme';
  const DEVELOPER_GITHUB = 'https://github.com/entiesci';
  // 功能更新时同步修改 APP_VERSION、version.json、Release tag 和 zip 文件名；纯补丁不 bump。
  const APP_VERSION = 'ver.0.15';
  const UPDATE_MANIFEST_URLS = [
    'https://cdn.jsdelivr.net/gh/Entiesci/TongjiAssignmentHelper@main/version.json',
    'https://raw.githubusercontent.com/Entiesci/TongjiAssignmentHelper/main/version.json',
  ];
  // 功能保留但暂不开放：隐藏主题按钮，强制浅色
  const THEME_TOGGLE_ENABLED = false;
  const ROUTES = ['calendar', 'notices', 'homework', 'accounts'];
  const pad = (n) => String(n).padStart(2, '0');

  const state = {
    user: null,
    route: 'calendar',
    theme: 'light',
    semester: null,
    events: [],
    eventMap: new Map(),
    notices: [],
    assignments: [],
    exams: [],
    examPeriods: [],
    platforms: [],
    sources: [],
    authErrors: {},
    errors: {},
    lastSync: null,
    syncBusy: false,
    externalSyncBusy: false,
    settingsTab: 'accounts',
    syncPollTimer: null,
    loading: { calendar: true, notices: true, homework: true },
    ui: {
      month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      selectedDate: todayKey(),
      noticeQuery: '',
      unreadOnly: false,
      activeNotice: null,
      detailOpen: false,
    },
  };

  /* ---------------- 小工具 ---------------- */
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escapeHTML = (value = '') =>
    String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function debounce(fn, ms) {
    let timer = 0;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function atTime(date, h, m) {
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function mondayOnOrBefore(date) {
    const d = startOfDay(date);
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function keyOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function fmtMD(date) {
    return `${date.getMonth() + 1}.${pad(date.getDate())}`;
  }

  function fmtHM(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fmtFullDate(dateStr) {
    const d = parseKey(dateStr);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEKDAY_FULL[(d.getDay() + 6) % 7]}`;
  }

  function fmtDateTime(isoStr) {
    const d = new Date(isoStr);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${fmtHM(d)}`;
  }

  function fmtRelativeTime(isoStr) {
    const d = new Date(isoStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days === 1) return `昨天 ${fmtHM(d)}`;
    if (days < 7) return `${days} 天前`;
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  function weekOf(date) {
    if (!state.semester) return 0;
    const start = parseKey(state.semester.startDate);
    return Math.floor((startOfDay(date) - start) / 86400000 / 7) + 1;
  }

  function dueInfo(assignment) {
    const due = new Date(assignment.dueAt);
    const now = new Date();
    const dayDiff = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
    const time = fmtHM(due);
    const overdue = due < now;
    let text;
    if (overdue) {
      const hours = Math.max(1, Math.round((now - due) / 3600000));
      if (hours < 48) {
        text = `已逾期 ${hours} 小时 · 原定 ${dayDiff === 0 ? '今天' : dayDiff === -1 ? '昨天' : `${due.getMonth() + 1} 月 ${due.getDate()} 日`} ${time}`;
      } else {
        const days = Math.round(hours / 24);
        text = `已逾期 ${days} 天 · 原定 ${due.getMonth() + 1} 月 ${due.getDate()} 日 ${time}`;
      }
    } else if (dayDiff === 0) {
      text = `今天 ${time}`;
    } else if (dayDiff === 1) {
      text = `明天 ${time}`;
    } else if (dayDiff <= 7) {
      text = `${WEEKDAY_FULL[(due.getDay() + 6) % 7]} ${time}`;
    } else {
      text = `${due.getMonth() + 1} 月 ${due.getDate()} 日 ${time}`;
    }
    return { text, overdue };
  }

  function statusInfo(assignment) {
    if (assignment.done) {
      if (assignment.status === 'graded') {
        return { text: assignment.score != null ? `已批阅 ${assignment.score}` : '已批阅', cls: 'is-done' };
      }
      if (assignment.status === 'submitted') return { text: '已提交', cls: 'is-done' };
      return { text: '已完成', cls: 'is-done' };
    }
    if (new Date(assignment.dueAt) < new Date()) return { text: '已逾期', cls: 'is-overdue' };
    if (sameDay(new Date(assignment.dueAt), new Date())) return { text: '今天截止', cls: 'is-today' };
    return { text: '待完成', cls: '' };
  }

  function showToast(message, actionLabel, onAction) {
    const el = $('#toast');
    el.innerHTML = `<span>${escapeHTML(message)}</span>${actionLabel ? `<button class="toast-action" type="button">${escapeHTML(actionLabel)}</button>` : ''}`;
    el.classList.add('is-visible');
    const action = el.querySelector('.toast-action');
    if (action) {
      action.addEventListener(
        'click',
        () => {
          el.classList.remove('is-visible');
          if (onAction) onAction();
        },
        { once: true }
      );
    }
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove('is-visible'), 4200);
  }

  /* ---------------- 主题 ---------------- */
  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(mode) {
    state.theme = mode;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'dark' || (mode === 'system' && systemDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#141614' : '#f4f0e8');
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (e) {
      /* ignore */
    }
    $$('.theme-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.themeMode === mode);
    });
  }

  function toggleTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
  }

  /* ---------------- 登录 ---------------- */
  function showLoginError(message) {
    const el = $('#loginError');
    el.textContent = message || '';
    el.hidden = !message;
  }

  function setBtnBusy(btn, busy, busyText) {
    if (!btn) return;
    if (busy) {
      if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span>${escapeHTML(busyText || '处理中…')}</span>`;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
        delete btn.dataset.originalHtml;
      }
    }
  }

  function showLogin() {
    $('#shell').hidden = true;
    $('#loginView').hidden = false;
    if (window.innerWidth > 900) $('#loginId').focus();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const studentId = $('#loginId').value.trim();
    const password = $('#loginPw').value;
    showLoginError('');

    if (!studentId) {
      showLoginError('请输入学号或工号。');
      $('#loginId').focus();
      return;
    }
    if (!password) {
      showLoginError('请输入密码。');
      $('#loginPw').focus();
      return;
    }

    const btn = $('#loginBtn');
    setBtnBusy(btn, true, '正在登录…');
    try {
      const result = await Api.login(studentId, password);
      state.user = result.user;
      await enterApp(true);
      showToast(`欢迎回来，${state.user.name}`);
    } catch (error) {
      showLoginError(error.message || '登录失败，请稍后重试。');
    } finally {
      setBtnBusy(btn, false);
    }
  }

  async function enterApp(animate) {
    const loginView = $('#loginView');
    if (animate) {
      loginView.style.transition = 'opacity .22s ease';
      loginView.style.opacity = '0';
      await wait(200);
    }
    loginView.hidden = true;
    loginView.style.opacity = '';
    loginView.style.transition = '';
    $('#shell').hidden = false;
    updateUserUI();
    setRoute(ROUTES.includes(currentHash()) ? currentHash() : state.route, { replace: true });
    await loadData();
  }

  function updateUserUI() {
    if (!state.user) return;
    const initials = state.user.initials || state.user.name.slice(0, 1);
    $('#avatarInitials').textContent = initials;
    $('#accountBtnMobile').textContent = initials;
    $('#userName').textContent = state.user.name;
    $('#userMeta').textContent = '设置 · 账号与关于';
  }

  async function logout() {
    closeSheet();
    try {
      await Api.logout();
    } catch (e) {
      /* ignore */
    }
    state.user = null;
    state.notices = [];
    state.assignments = [];
    state.exams = [];
    state.examPeriods = [];
    state.platforms = [];
    state.events = [];
    state.eventMap.clear();
    state.semester = null;
    state.ui.activeNotice = null;
    state.ui.detailOpen = false;
    $('#loginPw').value = '';
    showLogin();
    showToast('已退出登录');
  }

  /* ---------------- 路由 ---------------- */
  function currentHash() {
    return (location.hash || '').replace(/^#\/?/, '');
  }

  function setRoute(route, options) {
    const opts = options || {};
    if (!ROUTES.includes(route)) route = 'calendar';
    state.route = route;

    $$('.page').forEach((page) => {
      page.hidden = page.dataset.page !== route;
    });
    $$('[data-route]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.route === route);
    });

    const hash = `#/${route}`;
    if (opts.replace) {
      history.replaceState(null, '', hash);
    } else if (location.hash !== hash) {
      history.pushState(null, '', hash);
    }

    if (route === 'calendar') renderCalendar();
    if (route === 'notices') renderNotices();
    if (route === 'homework') renderHomework();
    if (route === 'accounts') renderAccountsPage();
    window.scrollTo(0, 0);
  }

  /* ---------------- 数据加载 ---------------- */
  async function loadData() {
    state.loading = { calendar: true, notices: true, homework: true };
    state.authErrors = {};
    state.errors = {};
    renderCalendarSkeleton();
    renderNoticesSkeleton();
    renderHomeworkSkeleton();

    // 先取数据源，确保服务端会话 Cookie 已建立，再并行抓取
    let sourceResult;
    try {
      sourceResult = { status: 'fulfilled', value: await Api.getSources() };
    } catch (error) {
      sourceResult = { status: 'rejected', reason: error };
    }

    if (sourceResult.status === 'fulfilled') {
      state.sources = sourceResult.value.sources || [];
    }

    const [calResult, timetableResult, examResult, noticeResult, hwResult] =
      await Promise.allSettled([
        Api.getCalendar(),
        Api.getTimetable(),
        Api.getExams(),
        Api.getNotices(),
        Api.getAssignments(),
      ]);

    if (calResult.status === 'fulfilled') {
      state.semester = calResult.value.semester;
      state.events = calResult.value.events || [];
      buildEventMap();
      state.ui.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      state.ui.selectedDate = todayKey();
    } else {
      state.semester = null;
      state.events = [];
      state.eventMap.clear();
      if (calResult.reason && calResult.reason.code === 'AUTH_REQUIRED') {
        state.authErrors.calendar = calResult.reason;
      } else if (calResult.reason) {
        state.errors.calendar = calResult.reason.message || '校历抓取失败';
      }
    }

    let timetableEvents = [];
    if (timetableResult.status === 'fulfilled') {
      timetableEvents = timetableResult.value.events || [];
      if (!state.semester && timetableResult.value.semester) {
        state.semester = timetableResult.value.semester;
        state.ui.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        state.ui.selectedDate = todayKey();
      }
    }
    if (state.semester && timetableEvents.length) {
      state.events = [...state.events, ...timetableEvents];
      buildEventMap();
    }

    if (examResult.status === 'fulfilled') {
      state.exams = examResult.value.exams || [];
      state.examPeriods = examResult.value.periods || [];
      if (state.semester && state.exams.length) {
        state.events = [...state.events, ...state.exams];
        buildEventMap();
      }
    } else {
      state.exams = [];
      state.examPeriods = [];
    }

    if (noticeResult.status === 'fulfilled') {
      state.notices = noticeResult.value.notices || [];
    } else {
      state.notices = [];
      if (noticeResult.reason && noticeResult.reason.code === 'AUTH_REQUIRED') {
        state.authErrors.notices = noticeResult.reason;
      } else if (noticeResult.reason) {
        state.errors.notices = noticeResult.reason.message || '通知抓取失败';
      }
    }

    if (hwResult.status === 'fulfilled') {
      state.assignments = hwResult.value.assignments || [];
      state.platforms = hwResult.value.platforms || [];
      state.lastSync = hwResult.value.lastSync || null;
    } else {
      state.assignments = [];
      state.platforms = [];
      state.lastSync = null;
    }

    // 只保留当前使用的分类，旧的教学/活动/事务不再展示
    state.events = state.events.filter((event) => Boolean(CAT_LABEL[event.category]));
    appendAssignmentDeadlines();
    buildEventMap();

    // getSources 与抓取并行，抓取失败后同步一下数据源状态
    const tongjiSource = state.sources.find((source) => source.id === 'tongji');
    if (tongjiSource && (state.authErrors.calendar || state.errors.calendar)) {
      tongjiSource.connected = false;
      tongjiSource.lastError = state.errors.calendar || null;
    }
    state.platforms.forEach((platform) => {
      if (!platform.connected && platform.error && platform.error !== '未登录') {
        const source = state.sources.find((item) => item.id === platform.id);
        if (source) {
          source.connected = false;
          source.lastError = platform.error;
        }
      }
    });

    state.loading = { calendar: false, notices: false, homework: false };
    renderAll();
    updateBadges();
    updateSourceIndicator();

    if (calResult.status === 'fulfilled' || noticeResult.status === 'fulfilled') {
      try {
        const latestSources = await Api.getSources();
        state.sources = latestSources.sources || state.sources;
        updateSourceIndicator();
      } catch (error) {
        /* 忽略状态刷新失败 */
      }
    }

    if (state.route === 'accounts') renderAccountsPage();

    const failures = [calResult, noticeResult, hwResult].filter(
      (result) => result.status === 'rejected' && !(result.reason && result.reason.code === 'AUTH_REQUIRED')
    );
    if (failures.length) {
      showToast(failures[0].reason?.message || '部分数据抓取失败，请检查数据源登录态。');
    }
  }

  function updateSourceIndicator() {
    const dot = $('#sourceDot');
    if (!dot) return;
    const total = state.sources.length;
    const connected = state.sources.filter((source) => source.connected).length;
    dot.classList.toggle('is-ok', total > 0 && connected === total);
    dot.classList.toggle('is-partial', connected > 0 && connected < total);
    dot.title = `${connected} / ${total} 个数据源已连接`;
  }

  function authGateHTML(sourceId, title, description) {
    const source = state.sources.find((item) => item.id === sourceId) || {
      id: sourceId,
      name: '数据源',
      loginUrl: '',
      hint: '',
    };
    return `
      <div class="auth-gate-inner">
        <p class="kicker">LOGIN REQUIRED</p>
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(description)}</p>
        <div class="auth-gate-actions">
          <button class="btn btn-primary" type="button" data-open-sources="${sourceId}">连接数据源</button>
          ${source.loginUrl ? `<button class="btn btn-outline" type="button" data-open-login="${sourceId}">打开登录页 ↗</button>` : ''}
        </div>
        <small>推荐一键登录；只有自动登录失败时才需要手动填写 Cookie / Token。</small>
      </div>`;
  }

  function homeworkGateHTML() {
    const platforms = state.sources.filter((source) => source.covers && source.covers.includes('homework'));
    return `
      <div class="auth-gate-inner">
        <p class="kicker">CONNECT A PLATFORM</p>
        <h2>先连接一个作业平台</h2>
        <p>课堂派、Educoder、Canvas 登录后，作业会自动汇总到这里。未登录时不会展示任何演示数据。</p>
        <div class="auth-gate-actions">
          ${platforms
            .map(
              (source) =>
                `<button class="btn btn-outline" type="button" data-open-sources="${source.id}">${escapeHTML(
                  source.name
                )}</button>`
            )
            .join('')}
        </div>
        <small>点击平台后优先使用一键登录；只有自动登录失败时才需要手动填写 Cookie / Token。</small>
      </div>`;
  }

  const SOURCE_GUIDES = {
    tongji: ['点击「一键登录」', '在打开的 Edge 窗口完成统一身份认证', '登录成功后自动回填并同步校历 / 课表'],
    ketangpai: ['点击「一键登录」', '在打开的 Edge 窗口登录课堂派', '登录成功后自动同步课程作业'],
    educoder: ['点击「一键登录」', '在打开的 Edge 窗口登录（账号密码或微信扫码）', '登录成功后自动同步各类型作业'],
    canvas: ['同济已登录时，Canvas 会自动补登录', '也可以手动点「一键登录」', '登录成功后自动同步大学物理作业'],
  };

  const MAIN_HINTS = {
    tongji: '推荐一键登录；登录成功后自动同步校历和课表。',
    ketangpai: '推荐一键登录；登录成功后自动同步课程作业。',
    educoder: '推荐一键登录；登录成功后自动同步各类型作业。',
    canvas: '未登录时会自动使用同济账号登录；登录后自动同步大学物理作业。',
  };

  const MANUAL_GUIDES = {
    tongji: ['打开 1.tongji.edu.cn 并完成登录', 'F12 → 网络 → 任意请求 → 复制 Cookie', '粘贴到下面，点「保存并抓取」'],
    canvas: ['打开 Canvas → 账户 → 设置 → 创建访问许可证', '复制生成的 Token', '粘贴到下面，点「保存并抓取」'],
    ketangpai: ['登录课堂派', 'F12 → 网络 → openapiv5.ketangpai.com 请求 → 复制 Cookie', '粘贴到下面并保存'],
    educoder: ['登录头歌课堂', 'F12 → 网络 → homework_commons 请求 → 复制 Cookie 或 cURL', '粘贴到下面并保存'],
  };

  function manualFieldsHTML(source) {
    const fields = [];

    if (source.id === 'tongji') {
      fields.push(`
        <div class="source-field">
          <label>自动重登（可选）</label>
          <input type="text" data-field="username" value="${escapeHTML(source.fields.username || '')}" placeholder="学号 / 工号">
          <input type="password" data-field="password" placeholder="${source.fields.hasPassword ? '已保存密码，留空则不修改' : '统一身份认证密码'}" style="margin-top:6px">
          <label class="source-check"><input type="checkbox" data-field="autoLogin" ${source.fields.autoLogin ? 'checked' : ''}> 登录过期时自动重登</label>
          <p class="source-warning">账号密码保存在本机 .data/credentials.json，仅建议个人电脑使用。</p>
        </div>`);
    }

    if (source.authType === 'token') {
      fields.push(`
        <div class="source-field">
          <label>API Token</label>
          <input type="password" data-field="token" placeholder="${source.fields.hasToken ? '已保存，留空则不修改' : '粘贴 Canvas 访问令牌'}">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>Canvas 地址</label>
          <input type="text" data-field="baseUrl" value="${escapeHTML(source.fields.baseUrl || 'https://canvas.tongji.edu.cn')}">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>只同步课程（名称或课程 ID）</label>
          <input type="text" data-field="courseFilter" value="${escapeHTML(source.fields.courseFilter || '大学物理A1')}">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>或者：粘贴 /api/v1/courses 的 cURL</label>
          <textarea data-field="curl" placeholder="DevTools → 网络 → api/v1/courses → 右键 Copy as cURL，粘贴到这里"></textarea>
        </div>`);
    } else {
      fields.push(`
        <div class="source-field">
          <label>Cookie</label>
          <textarea data-field="cookie" placeholder="${source.fields.hasCookie ? '已保存，留空则不修改' : '粘贴登录后的 Cookie 请求头'}"></textarea>
        </div>`);
    }

    if (source.id === 'tongji') {
      fields.push(`
        <div class="source-field">
          <label>或者：粘贴 currentTermCalendar 的 cURL（最稳）</label>
          <textarea data-field="curl" placeholder="DevTools → 网络 → currentTermCalendar → 右键 Copy as cURL，粘贴到这里"></textarea>
          <button class="btn btn-ghost" type="button" data-paste-curl style="margin-top:7px;height:31px;padding:0 10px;font-size:10px">从剪贴板粘贴 cURL</button>
        </div>`);
    }

    if (source.id === 'ketangpai') {
      fields.push(`
        <div class="source-field">
          <label>或者：粘贴 /CourseApi 请求的 cURL</label>
          <textarea data-field="curl" placeholder="DevTools → 网络 → CourseApi → 右键 Copy as cURL，粘贴到这里"></textarea>
        </div>`);
    }

    if (source.id === 'educoder') {
      fields.push(`
        <div class="source-field">
          <label>课程 ID</label>
          <input type="text" data-field="courseId" value="${escapeHTML(source.fields.courseId || '6ryliqfk')}">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>作业接口地址（可选，带 zzud 的完整 URL）</label>
          <input type="text" data-field="apiUrl" placeholder="https://data.educoder.net/api/courses/.../homework_commons.json?...">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>zzud（可选）</label>
          <input type="text" data-field="zzud" placeholder="页面接口里的 zzud 参数">
        </div>`);
      fields.push(`
        <div class="source-field">
          <label>最稳：粘贴原始 cURL（DevTools → 请求右键 → Copy → Copy as cURL）</label>
          <textarea data-field="curl" placeholder="curl 'https://data.educoder.net/api/courses/.../homework_commons.json?...' -H 'cookie: ...' -H 'pc-authorization: ...'"></textarea>
        </div>`);
    }

    return fields.join('');
  }

  function sourceCardHTML(source) {
    const meta = SOURCE_META[source.id] || { color: 'var(--blue)', short: '·' };
    const connected = source.connected;
    const steps = SOURCE_GUIDES[source.id] || [];
    const auto = ['tongji', 'ketangpai', 'educoder', 'canvas'].includes(source.id);

    return `
      <div class="source-card" data-source-card="${source.id}" data-connected="${connected}">
        <div class="source-card-head" style="--brand:${meta.color}">
          <span class="platform-logo">${meta.short}</span>
          <div class="source-card-name">
            <strong>${escapeHTML(source.name)}</strong>
            <span>${escapeHTML(source.desc)}</span>
          </div>
          <span class="source-status${connected ? ' is-on' : ''}">${connected ? '已连接' : '未连接'}</span>
        </div>
        <p class="source-hint">${escapeHTML(
          source.lastError ||
            (source.id === 'tongji' && source.fields.autoLogin
              ? '已开启账号密码自动重登；登录过期时会尝试后台登录。'
              : MAIN_HINTS[source.id] || source.hint || '')
        )}</p>
        <div class="source-guide">
          <p class="source-guide-title">推荐流程</p>
          <ol>${steps.map((step) => `<li>${escapeHTML(step)}</li>`).join('')}</ol>
        </div>
        <div class="source-actions">
          ${auto ? `<button class="btn btn-primary" type="button" data-auto-login="${source.id}">${connected ? '重新登录' : '一键登录'}</button>` : ''}
          <button class="btn btn-outline" type="button" data-manual-source="${source.id}">${
            source.id === 'canvas'
              ? '填写 API Token'
              : source.id === 'tongji'
                ? '账号密码 / 手动填写'
                : '手动填写 Cookie'
          }</button>
          ${source.loginUrl ? `<button class="btn btn-ghost" type="button" data-open-login="${source.id}">打开登录页 ↗</button>` : ''}
          ${connected ? `<button class="btn btn-ghost" type="button" data-disconnect-source="${source.id}">断开</button>` : ''}
        </div>
      </div>`;
  }

  function manualCardHTML(source) {
    const meta = SOURCE_META[source.id] || { color: 'var(--blue)', short: '·' };
    const connected = source.connected;
    const steps = MANUAL_GUIDES[source.id] || [];

    return `
      <div class="source-card" data-source-card="${source.id}" data-connected="${connected}">
        <div class="source-card-head" style="--brand:${meta.color}">
          <span class="platform-logo">${meta.short}</span>
          <div class="source-card-name">
            <strong>${escapeHTML(source.name)}</strong>
            <span>${escapeHTML(source.desc)}</span>
          </div>
          <span class="source-status${connected ? ' is-on' : ''}">${connected ? '已连接' : '未连接'}</span>
        </div>
        <p class="source-hint">${escapeHTML(source.lastError || source.hint || '')}</p>
        <div class="source-guide">
          <p class="source-guide-title">手动步骤</p>
          <ol>${steps.map((step) => `<li>${escapeHTML(step)}</li>`).join('')}</ol>
        </div>
        <div class="source-fields">${manualFieldsHTML(source)}</div>
        <div class="source-actions">
          <button class="btn btn-primary" type="button" data-save-source="${source.id}">保存并抓取</button>
          ${source.loginUrl ? `<button class="btn btn-outline" type="button" data-open-login="${source.id}">打开登录页 ↗</button>` : ''}
          ${connected ? `<button class="btn btn-ghost" type="button" data-disconnect-source="${source.id}">断开</button>` : ''}
        </div>
      </div>`;
  }

  function bindSourceSheetActions(sheet, options = {}) {
    sheet.querySelectorAll('[data-save-source]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-source-card]');
        const sourceId = button.dataset.saveSource;
        const payload = {};
        card.querySelectorAll('[data-field]').forEach((input) => {
          if (input.type === 'checkbox') {
            payload[input.dataset.field] = input.checked;
            return;
          }
          const value = input.value.trim();
          if (value) payload[input.dataset.field] = value;
        });
        if (!Object.keys(payload).length && card.dataset.connected !== 'true') {
          showToast('请先粘贴 Cookie 或 Token');
          return;
        }
        setBtnBusy(button, true, '保存中…');
        try {
          const result = await Api.saveCredentials(sourceId, payload);
          state.sources = result.sources || state.sources;
          closeSheet();
          showToast('已保存，正在抓取真实数据…');
          await loadData();
        } catch (error) {
          setBtnBusy(button, false);
          showToast(error.message || '保存失败');
        }
      });
    });

    sheet.querySelectorAll('[data-auto-login]').forEach((button) => {
      button.addEventListener('click', async () => {
        const sourceId = button.dataset.autoLogin;
        setBtnBusy(button, true, '正在打开浏览器…');
        try {
          const { id } = await Api.startLogin(sourceId);
          showToast('已打开登录窗口，请完成登录');
          const timer = setInterval(async () => {
            try {
              const result = await Api.getLoginStatus(sourceId, id);
              if (result.status === 'success') {
                clearInterval(timer);
                closeSheet();
                showToast('登录成功，Cookie 已自动回填');
                await loadData();
              } else if (result.status === 'failed') {
                clearInterval(timer);
                setBtnBusy(button, false);
                showToast(result.message || '登录失败');
              }
            } catch (error) {
              clearInterval(timer);
              setBtnBusy(button, false);
              showToast('登录状态查询失败');
            }
          }, 2000);
        } catch (error) {
          setBtnBusy(button, false);
          showToast(error.message || '无法启动登录');
        }
      });
    });

    sheet.querySelectorAll('[data-paste-curl]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          const textarea = button.closest('.source-field').querySelector('textarea[data-field="curl"]');
          if (!text.trim()) throw new Error('剪贴板为空');
          textarea.value = text.trim();
          showToast('已从剪贴板粘贴，请点保存并抓取');
        } catch (error) {
          showToast('读取剪贴板失败，请手动粘贴 cURL');
        }
      });
    });

    sheet.querySelectorAll('[data-disconnect-source]').forEach((button) => {
      button.addEventListener('click', async () => {
        const sourceId = button.dataset.disconnectSource;
        setBtnBusy(button, true, '断开中…');
        try {
          const result = await Api.disconnectSource(sourceId);
          state.sources = result.sources || state.sources;
          closeSheet();
          showToast('已断开数据源');
          await loadData();
        } catch (error) {
          setBtnBusy(button, false);
          showToast(error.message || '断开失败');
        }
      });
    });

    if (options.onManual) {
      sheet.querySelectorAll('[data-manual-source]').forEach((button) => {
        button.addEventListener('click', () => options.onManual(button.dataset.manualSource));
      });
    }
  }

  function openSourcesSheet(focusId) {
    state.settingsTab = 'accounts';
    setRoute('accounts');
    return;
    if (!state.sources.length) {
      showToast('数据源信息尚未加载，请稍后重试');
      return;
    }
    const ordered = state.sources.slice().sort((a, b) => {
      if (a.id === focusId) return -1;
      if (b.id === focusId) return 1;
      return 0;
    });
    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">DATA SOURCES</p>
          <h2 class="sheet-title">连接数据源</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <p class="sheet-sub">推荐使用一键登录，浏览器会自动回填 Cookie。手动填写只作为备用方案，已经移到单独页面。</p>
      <div class="source-list" style="margin-top:18px">
        ${ordered.map(sourceCardHTML).join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-outline" type="button" data-close>关闭</button>
      </div>`,
      {
        wide: true,
        onMount(sheet) {
          bindSourceSheetActions(sheet, { onManual: openManualSheet });
        },
      }
    );
  }

  function openManualSheet(sourceId) {
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) return;
    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">MANUAL LOGIN</p>
          <h2 class="sheet-title">${source.id === 'tongji' ? '登录设置' : '手动填写'} · ${escapeHTML(
            source.name
          )}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <p class="sheet-sub">一键登录不可用时使用。凭据只保存在本机，不会上传。</p>
      <div class="source-list" style="margin-top:18px">
        ${manualCardHTML(source)}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" type="button" data-back>← 返回数据源</button>
        <button class="btn btn-outline" type="button" data-close>关闭</button>
      </div>`,
      {
        wide: true,
        full: true,
        onMount(sheet) {
          bindSourceSheetActions(sheet);
          const back = sheet.querySelector('[data-back]');
          if (back) back.addEventListener('click', () => openSourcesSheet(sourceId));
        },
      }
    );
  }

  function filterAdjustedCourses() {
    const adjustDates = new Set(
      state.events.filter((event) => event.category === 'adjust').map((event) => event.date)
    );
    if (!adjustDates.size) return;
    state.events = state.events.filter(
      (event) => !(event.category === 'course' && adjustDates.has(event.date))
    );
  }

  function assignmentDeadlineEvents() {
    const events = [];
    for (const assignment of visibleAssignments()) {
      if (assignment.done || !assignment.dueAt) continue;
      const due = new Date(assignment.dueAt);
      if (Number.isNaN(due.getTime())) continue;

      const pad2 = (value) => String(value).padStart(2, '0');
      const dateKeyValue = `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`;
      const time = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
      const platform = state.platforms.find((item) => item.id === assignment.platform);

      let week = null;
      if (state.semester && state.semester.startDate) {
        const start = new Date(`${state.semester.startDate}T00:00:00`);
        const day = new Date(`${dateKeyValue}T00:00:00`);
        week = Math.floor((day - start) / 86400000 / 7) + 1;
      }

      events.push({
        id: `deadline-${assignment.id}`,
        date: dateKeyValue,
        ...(week ? { week } : {}),
        title: `DDL · ${assignment.title}`,
        category: 'deadline',
        time,
        location: platform?.name || assignment.platform,
        description: [platform?.name, assignment.course, '作业截止'].filter(Boolean).join(' · '),
        endDate: dateKeyValue,
        assignmentId: assignment.id,
      });
    }
    return events;
  }

  function appendAssignmentDeadlines() {
    state.events = state.events.filter((event) => !String(event.id || '').startsWith('deadline-'));
    state.events = [...state.events, ...assignmentDeadlineEvents()];
  }

  function refreshCalendarDeadlines() {
    appendAssignmentDeadlines();
    buildEventMap();
    renderCalendar();
  }

  function buildEventMap() {
    filterAdjustedCourses();
    state.eventMap.clear();
    state.events.forEach((event) => {
      if (!state.eventMap.has(event.date)) state.eventMap.set(event.date, []);
      state.eventMap.get(event.date).push(event);
    });
    state.eventMap.forEach((list) => list.sort(compareEvents));
  }

  function renderAll() {
    renderCalendar();
    renderNotices();
    renderHomework();
    updateBadges();
  }

  function updateBadges() {
    const unread = state.notices.filter((n) => n.unread).length;
    $$('[data-badge="notices"]').forEach((el) => {
      if (el.classList.contains('side-count')) {
        el.textContent = unread > 99 ? '99+' : String(unread);
        el.hidden = unread === 0;
      } else {
        el.hidden = unread === 0;
      }
    });

    const connected = new Set(state.platforms.filter((p) => p.connected).map((p) => p.id));
    const pending = state.assignments.filter(
      (a) => connected.has(a.platform) && !a.done
    ).length;
    $$('[data-badge="homework"]').forEach((el) => {
      if (el.classList.contains('side-count')) {
        el.textContent = pending > 99 ? '99+' : String(pending);
        el.hidden = pending === 0;
      } else {
        el.hidden = pending === 0;
      }
    });
  }

  /* ---------------- 校历 ---------------- */
  function renderCalendarSkeleton() {
    $('#calAuthGate').hidden = true;
    $('#calendarLayout').hidden = false;
    $('#calKicker').textContent = 'ACADEMIC CALENDAR';
    $('#calWeekInfo').textContent = '正在加载学期信息…';
    $('#monthLabel').textContent = `${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月`;
    $('#calWeekdays').innerHTML = `<span>W</span>${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}`;
    $('#calLegend').innerHTML = '';
    let html = '';
    for (let row = 0; row < 5; row += 1) {
      html += '<div class="cal-week"></div>';
      for (let col = 0; col < 7; col += 1) {
        html += `<div class="day"><span class="skeleton" style="display:block;width:18px;height:14px;margin:4px 0 12px"></span><span class="skeleton" style="display:block;width:70%;height:7px"></span></div>`;
      }
    }
    $('#calendarGrid').innerHTML = html;
    $('#dayCard').innerHTML = '<div class="skeleton" style="height:210px"></div>';
    $('#upcomingList').innerHTML = '<div class="skeleton" style="height:170px;margin-top:12px"></div>';
    $('#termTrack').innerHTML = '';
    $('#termProgressLabel').textContent = '第 — / 18 周';
  }

  function updateTermUI() {
    const semester = state.semester;
    if (!semester) return;

    const start = parseKey(semester.startDate);
    const end = parseKey(semester.endDate);
    const weekStart = addDays(start, (semester.currentWeek - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    const daysLeft = Math.max(0, Math.ceil((end - startOfDay(new Date())) / 86400000));

    $('#sideTerm').textContent = semester.name;
    $('#sideWeek').textContent = `第 ${semester.currentWeek} 周`;
    $('#sideDays').textContent = `剩余 ${daysLeft} 天`;
    $('#calKicker').textContent = `ACADEMIC CALENDAR / ${semester.academicYear}`;

    let extra = '';
    const exam = state.events.find((e) => e.title.includes('期末'));
    if (exam) {
      const examDate = parseKey(exam.date);
      const weeks = Math.ceil((examDate - startOfDay(new Date())) / 604800000);
      if (weeks > 0) extra = ` · 距离期末 ${weeks} 周`;
      else if (weeks > -3) extra = ' · 期末周进行中';
    }
    $('#calWeekInfo').textContent = `第 ${semester.currentWeek} 周 · ${fmtMD(weekStart)} — ${fmtMD(weekEnd)} · 共 ${semester.totalWeeks} 周${extra}`;

    $('#termProgressLabel').textContent = `第 ${semester.currentWeek} / ${semester.totalWeeks} 周`;
    $('#termTrack').innerHTML = Array.from({ length: semester.totalWeeks }, (_, index) => {
      const week = index + 1;
      let cls = 'term-seg';
      if (week < semester.currentWeek) cls += ' is-done';
      if (week === semester.currentWeek) cls += ' is-current';
      return `<span class="${cls}" title="第 ${week} 周"></span>`;
    }).join('');

    $('#calLegend').innerHTML = Object.entries(CAT_LABEL)
      .map(([key, label]) => `<span class="legend-item"><i class="legend-dot cat-${key}"></i>${label}</span>`)
      .join('');
  }

  function fallbackSemesterEvents(semester) {
    const start = parseKey(semester.startDate);
    const total = semester.totalWeeks;
    // 学校接口的 weekNum 会把寒假算进去，优先使用接口给出的考试周；缺失时再兜底
    const examWeek = semester.examWeekStart || Math.max(1, total - 6);
    const teachingEndWeek = semester.teachingWeekEnd || Math.max(1, examWeek - 1);
    const event = (id, date, week, title, category, description) => ({
      id,
      date,
      week,
      title,
      category,
      time: '全天',
      location: '—',
      description,
    });
    return [
      event('semester-open', semester.startDate, 1, '开学', 'teaching', '学期开始，按课表正常上课。'),
      event(
        'teaching-end',
        keyOf(addDays(start, (teachingEndWeek - 1) * 7 + 4)),
        teachingEndWeek,
        '教学周结束',
        'teaching',
        '本学期教学周结束，进入复习与考试阶段。'
      ),
      event(
        'exam-week',
        keyOf(addDays(start, (examWeek - 1) * 7)),
        examWeek,
        '考试周',
        'exam',
        '期末考试周开始，请留意各学院排考通知。'
      ),
      event('semester-end', semester.endDate, total, '学期结束', 'holiday', '本学期结束。')
    ];
  }

  function renderCalendar() {
    if (state.loading.calendar) {
      renderCalendarSkeleton();
      return;
    }
    const hasTimetable = state.events.some((event) => event.category === 'course');
    if (((state.authErrors.calendar || state.errors.calendar) && !hasTimetable) || !state.semester) {
      $('#calAuthGate').hidden = false;
      $('#calendarLayout').hidden = true;
      $('#calAuthGate').innerHTML = authGateHTML(
        'tongji',
        state.errors.calendar ? '校历抓取失败' : '登录同济大学统一身份认证',
        state.errors.calendar ||
          '校历和学校通知来自 1.tongji.edu.cn。完成登录后，把请求头里的 Cookie 粘贴到数据源面板，即可抓取真实校历。'
      );
      $('#sideTerm').textContent = '未连接学校门户';
      $('#sideWeek').textContent = '—';
      $('#sideDays').textContent = '—';
      $('#calWeekInfo').textContent = state.errors.calendar
        ? '抓取失败 · 请更新登录 Cookie 或 cURL'
        : '未连接学校门户 · 登录后抓取真实校历';
      return;
    }
    $('#calAuthGate').hidden = true;
    $('#calendarLayout').hidden = false;

    const hasFutureMilestone = state.events.some(
      (event) => event.category !== 'course' && event.date >= todayKey()
    );
    if (!hasFutureMilestone) {
      state.events = [...state.events, ...fallbackSemesterEvents(state.semester)];
      buildEventMap();
    }

    updateTermUI();

    const month = state.ui.month;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    $('#monthLabel').textContent = `${year} 年 ${monthIndex + 1} 月`;

    const first = new Date(year, monthIndex, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const gridStart = addDays(first, -offset);

    let html = '';
    for (let row = 0; row < totalCells / 7; row += 1) {
      const rowStart = addDays(gridStart, row * 7);
      const week = weekOf(rowStart);
      html += `<div class="cal-week">${week >= 1 && week <= state.semester.totalWeeks ? `W${pad(week)}` : ''}</div>`;
      for (let col = 0; col < 7; col += 1) {
        const date = addDays(rowStart, col);
        const key = keyOf(date);
        const events = state.eventMap.get(key) || [];
        const isOut = date.getMonth() !== monthIndex;
        const isToday = key === todayKey();
        const isSelected = key === state.ui.selectedDate;
        const classes = ['day'];
        if (isOut) classes.push('is-out');
        if (isToday) classes.push('is-today');
        if (isSelected) classes.push('is-selected');
        if (events.some((event) => event.category === 'holiday')) classes.push('has-holiday');
        if (events.some((event) => event.category === 'adjust')) classes.push('has-adjust');
        const label = `${date.getMonth() + 1} 月 ${date.getDate()} 日，${events.length} 项安排`;
        html += `<button type="button" class="${classes.join(' ')}" data-date="${key}" aria-label="${label}"${isSelected ? ' aria-current="date"' : ''}>`;
        html += `<span class="day-num">${date.getDate()}</span>`;
        if (events.length) {
          html += '<span class="day-events">';
          events.slice(0, 2).forEach((event) => {
            html += `<span class="cal-event cat-${event.category}"><i></i><span>${escapeHTML(event.title)}</span></span>`;
          });
          if (events.length > 2) html += `<span class="cal-event-more">+${events.length - 2}</span>`;
          html += '</span>';
        }
        html += '</button>';
      }
    }
    $('#calendarGrid').innerHTML = html;
    renderDayCard();
    renderUpcoming();
  }

  function openDayDrawer() {
    const drawer = $('#dayDrawer');
    if (!drawer) return;
    renderDayCard();
    drawer.hidden = false;
    document.body.classList.add('drawer-open');
  }

  function closeDayDrawer() {
    const drawer = $('#dayDrawer');
    if (!drawer) return;
    drawer.hidden = true;
    document.body.classList.remove('drawer-open');
  }

  function periodTimes() {
    const source = state.examPeriods || [];
    const map = new Map(
      source
        .filter((item) => Number(item.node) >= 1 && Number(item.node) <= 11)
        .map((item) => [Number(item.node), item])
    );

    return Array.from({ length: 11 }, (_, index) => {
      const node = index + 1;
      const item = map.get(node);
      return {
        node,
        start: item?.start || DEFAULT_PERIOD_TIMES[index][0],
        end: item?.end || DEFAULT_PERIOD_TIMES[index][1],
      };
    });
  }

  function periodRange(event) {
    const match = String(event.time || '').match(/第\s*(\d+)(?:\s*-\s*(\d+))?\s*节/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isFinite(start) || start < 1 || start > 11) return null;
    return { start, end: Math.min(11, Math.max(start, end)) };
  }

  function timeToPeriod(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return 1;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    let best = 1;
    for (const period of periodTimes()) {
      const [hour, minute] = period.start.split(':').map(Number);
      if (hour * 60 + minute <= minutes) best = period.node;
    }
    return best;
  }

  function renderDayCard() {
    if (!state.semester) return;
    const date = parseKey(state.ui.selectedDate);
    const events = state.eventMap.get(state.ui.selectedDate) || [];
    const isToday = state.ui.selectedDate === todayKey();
    const week = weekOf(date);
    const weekLabel = week >= 1 && week <= state.semester.totalWeeks ? `第 ${week} 周` : '假期';

    const alerts = events.filter(
      (event) => event.category !== 'course' && event.category !== 'exam'
    );
    const blocks = [];

    for (const event of events) {
      if (event.category === 'course') {
        const range = periodRange(event);
        if (range) {
          blocks.push({ event, ...range, kind: 'course' });
        } else {
          alerts.push(event);
        }
        continue;
      }

      if (event.category === 'exam') {
        const start = timeToPeriod(event.time);
        blocks.push({
          event,
          start,
          end: Math.min(11, start + 1),
          kind: 'exam',
        });
      }
    }

    alerts.sort((a, b) => compareEvents(a, b));
    blocks.sort((a, b) => a.start - b.start || a.end - b.end);

    const lanes = [];
    for (const block of blocks) {
      let lane = lanes.findIndex((end) => end <= block.start);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(block.end);
      } else {
        lanes[lane] = block.end;
      }
      block.lane = lane;
    }
    const laneCount = Math.max(1, lanes.length);

    const alertsHtml = alerts.length
      ? `<div class="day-alerts">${alerts
          .map(
            (event) => `
            <button class="day-alert cat-${event.category}" type="button" data-event="${event.id}">
              <span class="day-alert-cat">${CAT_LABEL[event.category] || '事项'}</span>
              <span class="day-alert-body">
                <strong>${escapeHTML(event.title)}</strong>
                <small>${escapeHTML(event.time)}${
                  event.location && event.location !== '—'
                    ? ` · ${escapeHTML(event.location)}`
                    : ''
                }</small>
              </span>
            </button>`
          )
          .join('')}</div>`
      : '';

    const periods = periodTimes();
    const rowMap = new Map();
    const rowTemplate = [];
    const sectionHtml = [];
    let rowIndex = 1;

    for (const section of PERIOD_SECTIONS) {
      sectionHtml.push(`
        <div class="day-section" style="grid-row:${rowIndex};grid-column:1 / -1">
          <span>${section.label}</span>
          <small>${section.start}–${section.end} 节</small>
        </div>`);
      rowTemplate.push('24px');
      rowIndex += 1;

      for (let node = section.start; node <= section.end; node += 1) {
        rowMap.set(node, rowIndex);
        rowTemplate.push('46px');
        rowIndex += 1;
      }
    }

    const periodHtml = periods
      .map(
        (period) => `
        <div class="day-period" style="grid-row:${rowMap.get(period.node)};grid-column:1">
          <strong>${period.node}</strong>
          <small>${period.start}<br>${period.end}</small>
        </div>`
      )
      .join('');

    const courseHtml = blocks
      .map((block) => {
        const startRow = rowMap.get(block.start);
        const endRow = rowMap.get(block.end);
        const isExam = block.kind === 'exam';
        const meta = isExam
          ? `${block.event.time}${block.event.location && block.event.location !== '—' ? ` · ${block.event.location}` : ''}`
          : block.event.location || '';
        return `
        <button
          class="day-course cat-${isExam ? 'exam' : 'course'}"
          type="button"
          data-event="${block.event.id}"
          style="grid-row:${startRow}/${endRow + 1};grid-column:${block.lane + 2}"
        >
          ${isExam ? '<span class="day-course-badge">考试</span>' : ''}
          <strong>${escapeHTML(block.event.title)}</strong>
          <small>${escapeHTML(meta)}</small>
        </button>`;
      })
      .join('');

    $('#dayCard').innerHTML = `
      <div class="day-head">
        <div>
          <p class="kicker">SELECTED DAY</p>
          <p class="day-big">${date.getDate()}</p>
          <p class="day-week">${MONTH_CN[date.getMonth()]} · ${WEEKDAY_FULL[(date.getDay() + 6) % 7]} · ${weekLabel}</p>
        </div>
        ${isToday ? '<span class="day-tag">TODAY</span>' : ''}
      </div>
      ${alertsHtml}
      <div class="day-timetable" style="grid-template-columns:66px repeat(${laneCount}, minmax(0, 1fr));grid-template-rows:${rowTemplate.join(' ')}">
        ${sectionHtml.join('')}
        ${periodHtml}
        ${courseHtml}
      </div>
    `;
  }

  function renderUpcoming() {
    const today = todayKey();
    const upcoming = state.events
      .filter((event) => event.date >= today && event.category !== 'course')
      .sort((a, b) => (a.date === b.date ? compareEvents(a, b) : a.date.localeCompare(b.date)))
      .slice(0, 5);

    if (!upcoming.length) {
      $('#upcomingList').innerHTML = `<div class="empty"><p>暂无后续节点</p><small>学期安排已全部结束</small></div>`;
      return;
    }

    $('#upcomingList').innerHTML = upcoming
      .map((event) => {
        const date = parseKey(event.date);
        return `
          <button class="milestone cat-${event.category}" type="button" data-event="${event.id}">
            <span class="milestone-date"><small>${MONTH_EN[date.getMonth()]}</small><strong>${pad(date.getDate())}</strong></span>
            <span class="milestone-title">${escapeHTML(event.title)}</span>
            <i class="milestone-cat"></i>
          </button>`;
      })
      .join('');
  }

  function jumpToEvent(id) {
    const event = state.events.find((item) => item.id === id);
    if (!event) return;
    const date = parseKey(event.date);
    state.ui.selectedDate = event.date;
    state.ui.month = new Date(date.getFullYear(), date.getMonth(), 1);
    renderCalendar();
  }

  function openEventSheet(id) {
    const event = state.events.find((item) => item.id === id);
    if (!event) return;
    openSheet(`
      <div class="sheet-head">
        <div>
          <p class="kicker">${CAT_LABEL[event.category] || '校历'}${
            event.week ? ` · 第 ${event.week} 周` : ''
          }</p>
          <h2 class="sheet-title">${escapeHTML(event.title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="sheet-meta">
        <span>${fmtFullDate(event.date)}</span>
        <span>${escapeHTML(event.time)}</span>
        ${event.location && event.location !== '—' ? `<span>${escapeHTML(event.location)}</span>` : ''}
      </div>
      <div class="sheet-body"><p>${escapeHTML(event.description)}</p></div>
      <div class="sheet-actions">
        <button class="btn btn-outline" type="button" data-close>关闭</button>
      </div>
    `);
  }

  function exportIcs() {
    if (!state.events.length) {
      showToast('校历尚未加载完成');
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const escapeIcs = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tongji Hub//Campus Ledger//CN',
      'CALSCALE:GREGORIAN',
    ];
    state.events.forEach((event) => {
      const start = parseKey(event.date);
      const end = addDays(start, 1);
      const startKey = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}`;
      const endKey = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${event.id}@tongji-hub`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${startKey}`,
        `DTEND;VALUE=DATE:${endKey}`,
        `SUMMARY:${escapeIcs(event.title)}`,
        `LOCATION:${escapeIcs(event.location)}`,
        `DESCRIPTION:${escapeIcs(event.description)}`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tongji-calendar.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast('校历已导出为 .ics 文件');
  }

  /* ---------------- 通知 ---------------- */
  function renderNoticesSkeleton() {
    $('#noticeAuthGate').hidden = true;
    $('#noticesToolbar').hidden = false;
    $('#noticesLayout').hidden = false;
    $('#noticeUnreadCount').textContent = '—';
    $('#noticeList').innerHTML = Array.from(
      { length: 5 },
      () => `
      <div class="notice-row">
        <span class="skeleton" style="width:16px;height:12px;margin-top:4px"></span>
        <div>
          <span class="skeleton" style="display:block;width:120px;height:9px"></span>
          <span class="skeleton" style="display:block;width:78%;height:15px;margin-top:10px"></span>
          <span class="skeleton" style="display:block;width:94%;height:9px;margin-top:9px"></span>
        </div>
      </div>`
    ).join('');
    $('#noticeDetail').innerHTML = `
      <div class="detail-empty">
        <span class="detail-empty-mark">02</span>
        <p>正在取回通知…</p>
        <small>来自统一身份认证门户</small>
      </div>`;
  }

  function filteredNotices() {
    const query = state.ui.noticeQuery.trim().toLowerCase();
    return state.notices.filter((notice) => {
      if (state.ui.unreadOnly && !notice.unread) return false;
      if (query) {
        const haystack = `${notice.title} ${notice.summary} ${notice.source}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function renderNotices() {
    if (state.loading.notices) {
      renderNoticesSkeleton();
      return;
    }
    if (state.authErrors.notices || state.errors.notices) {
      $('#noticeAuthGate').hidden = false;
      $('#noticesToolbar').hidden = true;
      $('#noticesLayout').hidden = true;
      $('#noticeAuthGate').innerHTML = authGateHTML(
        'tongji',
        state.errors.notices ? '通知抓取失败' : '登录后查看学校通知',
        state.errors.notices ||
          '学校通知来自统一身份认证门户的消息中心。登录并保存 Cookie 后，这里会展示真实通知，不再使用演示数据。'
      );
      return;
    }
    $('#noticeAuthGate').hidden = true;
    $('#noticesToolbar').hidden = false;
    $('#noticesLayout').hidden = false;

    const unread = state.notices.filter((n) => n.unread).length;
    $('#noticeUnreadCount').textContent = String(unread);
    const notices = filteredNotices();
    if (!notices.length) {
      $('#noticeList').innerHTML = `
        <div class="empty" style="padding:70px 20px">
          ${icon('search')}
          <p>没有匹配的通知</p>
          <small>试试调整分类，或换一个关键词</small>
        </div>`;
    } else {
      let html = '';
      let lastGroup = '';
      notices.forEach((notice, index) => {
        const group = noticeGroup(notice.publishedAt);
        if (group !== lastGroup) {
          html += `<div class="notice-group-label">${group}</div>`;
          lastGroup = group;
        }
        const active = state.ui.activeNotice === notice.id;
        html += `
          <article class="notice-row${notice.unread ? ' is-unread' : ''}${active ? ' is-active' : ''}" data-notice="${notice.id}" tabindex="0" role="button" aria-label="${escapeHTML(notice.title)}">
            <span class="notice-index">${pad(index + 1)}</span>
            <div>
              <div class="notice-top">
                <span>${escapeHTML(notice.source)}</span>
                <span>·</span>
                <time datetime="${notice.publishedAt}">${fmtRelativeTime(notice.publishedAt)}</time>
                ${notice.pinned ? `<span class="notice-pin">${icon('pin')}置顶</span>` : ''}
              </div>
              <h3 class="notice-title">${escapeHTML(notice.title)}</h3>
              <p class="notice-summary">${escapeHTML(notice.summary)}</p>
              ${notice.attachments && notice.attachments.length ? `<span class="notice-attach">${icon('file')}${notice.attachments.length} 个附件</span>` : ''}
            </div>
            <span class="notice-mark"></span>
          </article>`;
      });
      $('#noticeList').innerHTML = html;
    }

    renderNoticeDetail();
    const panel = $('#noticeDetail');
    panel.classList.toggle('is-open', state.ui.detailOpen);
  }

  function noticeGroup(isoStr) {
    const date = new Date(isoStr);
    const today = startOfDay(new Date());
    const day = startOfDay(date);
    const diff = Math.round((today - day) / 86400000);
    if (diff <= 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff < 7) return '本周';
    return '更早';
  }

  function renderNoticeDetail() {
    const panel = $('#noticeDetail');
    if (!state.ui.activeNotice) {
      panel.innerHTML = `
        <div class="detail-empty">
          <span class="detail-empty-mark">02</span>
          <p>选择一条通知</p>
          <small>在左侧列表中点击，即可在这里阅读全文与附件。</small>
        </div>`;
      return;
    }

    const notice = state.notices.find((n) => n.id === state.ui.activeNotice);
    if (!notice) {
      panel.innerHTML = `
        <div class="detail-empty">
          <span class="detail-empty-mark">02</span>
          <p>通知不存在</p>
          <small>它可能已被撤回，请选择其他通知。</small>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div class="detail-head">
        <button class="icon-btn detail-close" type="button" data-detail-close aria-label="关闭详情">${icon('close')}</button>
      </div>
      <h2 class="detail-title">${escapeHTML(notice.title)}</h2>
      <div class="detail-meta">
        <span>${escapeHTML(notice.source)}</span>
        <span>·</span>
        <time>${fmtDateTime(notice.publishedAt)}</time>
        ${notice.pinned ? `<span class="notice-pin">${icon('pin')}置顶</span>` : ''}
      </div>
      <div class="detail-body">
        ${notice.content.map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join('')}
      </div>
      ${
        notice.attachments && notice.attachments.length
          ? `<div class="detail-attachments">
              <p class="detail-attachments-label">附件 · ${notice.attachments.length}</p>
              ${notice.attachments
                .map(
                  (file) => `<div class="attachment">${icon('file')}<span>${escapeHTML(file.name)}</span><small>${escapeHTML(file.size)}</small></div>`
                )
                .join('')}
            </div>`
          : ''
      }
      <div class="detail-actions">
        <button class="btn btn-outline" type="button" data-copy-link>复制链接</button>
        <button class="btn btn-primary" type="button" data-open-source>打开原文 ${icon('external')}</button>
      </div>`;
  }

  async function openNotice(id) {
    const notice = state.notices.find((n) => n.id === id);
    if (!notice) return;

    state.ui.activeNotice = id;
    state.ui.detailOpen = true;

    if (notice.unread) {
      notice.unread = false;
      try {
        await Api.markNoticeRead(id);
      } catch (e) {
        /* 静默失败，下一次同步会恢复 */
      }
    }
    renderNotices();
    updateBadges();

    if (window.matchMedia('(max-width: 900px)').matches) {
      document.body.style.overflow = 'hidden';
      $('#noticeDetail').scrollTop = 0;
    }
  }

  function closeNoticeDetail() {
    state.ui.detailOpen = false;
    $('#noticeDetail').classList.remove('is-open');
    document.body.style.overflow = '';
  }

  async function markAllRead() {
    const unread = state.notices.filter((n) => n.unread);
    if (!unread.length) {
      showToast('没有未读通知');
      return;
    }
    unread.forEach((notice) => {
      notice.unread = false;
    });
    renderNotices();
    updateBadges();
    try {
      await Api.markAllNoticesRead();
      showToast(`已将 ${unread.length} 条通知标为已读`);
    } catch (e) {
      showToast('操作失败，请稍后重试');
    }
  }

  /* ---------------- 作业 ---------------- */
  function renderHomeworkSkeleton() {
    $('#hwAuthGate').hidden = true;
    $('#hwContent').hidden = false;
    $('#hwLastSync').textContent = '正在同步三平台作业…';
    $('#hwStats').innerHTML = Array.from(
      { length: 4 },
      () => `<div class="stat"><span class="skeleton" style="display:block;width:46px;height:34px;margin:4px 0 9px"></span><span class="skeleton" style="display:block;width:58px;height:8px"></span></div>`
    ).join('');
    $('#platformBar').innerHTML = Array.from(
      { length: 3 },
      () => `<div class="platform-card"><span class="skeleton" style="display:block;width:100%;height:10px"></span></div>`
    ).join('');
    $('#hwList').innerHTML = Array.from(
      { length: 4 },
      () => `<div class="hw-row"><span class="skeleton" style="width:18px;height:18px"></span><div><span class="skeleton" style="display:block;width:130px;height:8px"></span><span class="skeleton" style="display:block;width:56%;height:14px;margin-top:9px"></span><span class="skeleton" style="display:block;width:82%;height:8px;margin-top:8px"></span></div></div>`
    ).join('');
  }

  function connectedPlatforms() {
    return state.platforms.filter((p) => p.connected);
  }

  function visibleAssignments() {
    const connected = new Set(connectedPlatforms().map((p) => p.id));
    return state.assignments.filter((a) => connected.has(a.platform));
  }

  function renderHomework() {
    if (state.loading.homework) {
      renderHomeworkSkeleton();
      return;
    }

    refreshCalendarDeadlines();
    const connected = connectedPlatforms();
    if (!connected.length) {
      $('#hwAuthGate').hidden = false;
      $('#hwContent').hidden = true;
      $('#hwAuthGate').innerHTML = homeworkGateHTML();
      $('#hwLastSync').textContent = '未连接作业平台';
      updateBadges();
      return;
    }
    $('#hwAuthGate').hidden = true;
    $('#hwContent').hidden = false;

    const assignments = visibleAssignments();
    const pending = assignments.filter((a) => !a.done);
    const now = new Date();
    const endToday = atTime(addDays(now, 1), 0, 0);
    const weekEnd = addDays(now, 7);

    const overdue = pending.filter((a) => new Date(a.dueAt) < now);
    const today = pending.filter((a) => new Date(a.dueAt) >= now && new Date(a.dueAt) < endToday);
    const thisWeek = pending.filter((a) => new Date(a.dueAt) >= endToday && new Date(a.dueAt) < weekEnd);
    const later = pending.filter((a) => new Date(a.dueAt) >= weekEnd);
    const done = assignments.filter((a) => a.done);
    const percent = assignments.length ? Math.round((done.length / assignments.length) * 100) : 0;

    $('#hwLastSync').textContent = state.lastSync ? `上次同步 · ${fmtRelativeTime(state.lastSync)}` : '尚未同步';
    renderStats({ pending, overdue, thisWeek, percent, done, total: assignments.length });
    renderPlatformBar(connected);

    if (!assignments.length) {
      $('#hwList').innerHTML = `
        <div class="hw-empty">
          <h3>暂时没有作业</h3>
          <p>三个平台都很安静。点击右上角“同步作业”再检查一次。</p>
        </div>`;
      updateBadges();
      return;
    }

    const sections = [
      { key: 'overdue', title: '已逾期', items: overdue, overdue: true },
      { key: 'today', title: '今天', items: today },
      { key: 'week', title: '未来 7 天', items: thisWeek },
      { key: 'later', title: '更晚', items: later },
      { key: 'done', title: '已完成', items: done.slice().sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt)) },
    ].filter((section) => section.items.length);

    $('#hwList').innerHTML = sections
      .map((section) => {
        const rows = section.items
          .slice()
          .sort((a, b) =>
            section.key === 'done'
              ? new Date(b.dueAt) - new Date(a.dueAt)
              : new Date(a.dueAt) - new Date(b.dueAt)
          )
          .map((assignment) => homeworkRow(assignment, section.key))
          .join('');
        return `
          <section class="hw-section${section.overdue ? ' is-overdue' : ''}">
            <div class="hw-section-head">
              <h2>${section.title}</h2>
              <span>${String(section.items.length).padStart(2, '0')} ITEMS</span>
            </div>
            ${rows}
          </section>`;
      })
      .join('');

    updateBadges();
  }

  function renderStats({ pending, overdue, thisWeek, percent, done, total }) {
    $('#hwStats').innerHTML = `
      <div class="stat">
        <span class="stat-num">${pending.length}</span>
        <span class="stat-label">待完成</span>
        <span class="stat-note">来自 ${connectedPlatforms().length} 个平台</span>
      </div>
      <div class="stat${overdue.length ? ' is-alert' : ''}">
        <span class="stat-num">${overdue.length}</span>
        <span class="stat-label">已逾期</span>
        <span class="stat-note">${overdue.length ? '需要优先处理' : '没有拖欠'}</span>
      </div>
      <div class="stat">
        <span class="stat-num">${thisWeek.length}</span>
        <span class="stat-label">未来 7 天</span>
        <span class="stat-note">提前安排时间</span>
      </div>
      <div class="stat is-done">
        <span class="stat-num">${percent}%</span>
        <span class="stat-label">完成率</span>
        <span class="stat-note">已完成 ${done.length} / ${total} 项</span>
      </div>`;
  }

  function renderPlatformBar(connected) {
    $('#platformBar').innerHTML = state.platforms
      .map((platform) => {
        const meta = PLATFORM_META[platform.id] || { color: 'var(--muted)', short: '·' };
        const count = state.assignments.filter(
          (a) => a.platform === platform.id && platform.connected && !a.done
        ).length;
        const error = platform.error && platform.error !== '未登录' ? platform.error : '';
        return `
          <article class="platform-card${platform.connected ? '' : ' is-off'}" style="--brand:${meta.color}">
            <div class="platform-head">
              <span class="platform-logo">${meta.short}</span>
              <div class="platform-info">
                <strong>${escapeHTML(platform.name)}</strong>
                <span>${error ? escapeHTML(error.slice(0, 28)) : '课程作业与资料'}</span>
              </div>
            </div>
            <div class="platform-foot">
              <span class="platform-state${platform.connected ? '' : ' is-off'}"><i></i>${
                platform.connected ? `已连接 · ${count} 项待办` : error ? '抓取失败' : '未登录'
              }</span>
              ${
                platform.connected
                  ? '<span class="platform-sync">已同步</span>'
                  : `<button class="text-btn" type="button" data-open-sources="${platform.id}">连接 →</button>`
              }
            </div>
          </article>`;
      })
      .join('');
  }

  function homeworkRow(assignment, sectionKey) {
    const meta = PLATFORM_META[assignment.platform] || { color: 'var(--muted)' };
    const platform = state.platforms.find((p) => p.id === assignment.platform) || {
      name: assignment.platform,
    };
    const due = dueInfo(assignment);
    const status = statusInfo(assignment);
    const isDone = assignment.done;
    const isOverdue = !isDone && due.overdue;

    return `
      <article class="hw-row${isDone ? ' is-done' : ''}${isOverdue ? ' is-overdue' : ''}" data-assignment="${assignment.id}" tabindex="0" role="button" aria-label="${escapeHTML(assignment.title)}">
        <button class="hw-check${isDone ? ' is-checked' : ''}" type="button" role="checkbox" aria-checked="${isDone}" aria-label="${isDone ? '标记为未完成' : '标记为完成'}" data-check="${assignment.id}">
          ${isDone ? icon('check') : ''}
        </button>
        <div class="hw-main">
          <div class="hw-tags">
            <span class="hw-platform" style="--brand:${meta.color}"><i></i>${escapeHTML(platform.name)}</span>
            <span>${escapeHTML(assignment.course)}</span>
            <span class="hw-type">${escapeHTML(assignment.type)}</span>
          </div>
          <h3 class="hw-title">${escapeHTML(assignment.title)}</h3>
          <p class="hw-desc">${escapeHTML(assignment.description)}</p>
          <div class="hw-due">
            ${icon('clock')}
            <time datetime="${assignment.dueAt}">${due.text}</time>
            ${assignment.priority === 'high' && !isDone ? '<span class="hw-priority">优先</span>' : ''}
            ${assignment.status === 'graded' && assignment.score != null ? `<span class="hw-score">得分 ${assignment.score}</span>` : ''}
          </div>
        </div>
        <div class="hw-side">
          <span class="status ${status.cls}">${status.text}</span>
          <button class="hw-open" type="button" data-open-platform="${assignment.id}" aria-label="在 ${platform.name} 中打开">${icon('external')}</button>
        </div>
      </article>`;
  }

  async function toggleAssignment(id, next) {
    const assignment = state.assignments.find((a) => a.id === id);
    if (!assignment) return;
    const previous = assignment.done;
    assignment.done = next;
    renderHomework();

    try {
      await Api.setAssignmentDone(id, next);
      showToast(next ? '已标记为完成' : '已恢复为待完成', '撤销', () => {
        assignment.done = previous;
        renderHomework();
        Api.setAssignmentDone(id, previous).catch(() => {});
      });
    } catch (e) {
      assignment.done = previous;
      renderHomework();
      showToast('同步失败，请稍后重试');
    }
  }

  const ACCOUNT_HINTS = {
    tongji: '用于校历、通知，并作为 Canvas 的默认登录账号。',
    canvas: 'Canvas 使用同济统一身份认证；账号密码留空则复用同济账号。',
    ketangpai: '保存后后台会用无头浏览器登录课堂派并同步课程作业。',
    educoder: '保存后后台会用无头浏览器登录头歌并同步各类型作业。',
  };

  function accountCardHTML(source) {
    const meta = SOURCE_META[source.id] || { color: 'var(--blue)', short: '·' };
    const fields = source.fields || {};
    const status = source.connected
      ? '已连接'
      : fields.username
        ? '已配置，待登录'
        : '未配置';
    const statusClass = source.lastError ? 'is-error' : source.connected ? 'is-on' : '';

    return `
      <article class="panel account-card" data-account-card="${source.id}">
        <div class="source-card-head" style="--brand:${meta.color}">
          <span class="platform-logo">${meta.short}</span>
          <div class="source-card-name">
            <strong>${escapeHTML(source.name)}</strong>
            <span>${escapeHTML(source.desc || '')}</span>
          </div>
          <span class="source-status${source.connected ? ' is-on' : ''}">${status}</span>
        </div>
        <p class="source-hint">${escapeHTML(ACCOUNT_HINTS[source.id] || source.hint || '')}</p>
        <div class="source-fields">
          <div class="source-field">
            <label>账号</label>
            <input type="text" data-account-field="username" value="${escapeHTML(fields.username || '')}" placeholder="${
              source.id === 'canvas' ? '留空则使用同济账号' : '手机号 / 学号 / 邮箱'
            }">
          </div>
          <div class="source-field">
            <label>密码</label>
            <input type="password" data-account-field="password" placeholder="${
              fields.hasPassword
                ? '已保存，留空则不修改'
                : source.id === 'canvas'
                  ? '留空则使用同济密码'
                  : '请输入密码'
            }">
          </div>
        </div>
        <div class="source-actions">
          <button class="btn btn-primary" type="button" data-account-save>保存并登录</button>
          <button class="btn btn-outline" type="button" data-account-login>仅登录</button>
          <button class="btn btn-ghost" type="button" data-account-manual>手动填写</button>
          ${source.id === 'educoder' ? '<button class="btn btn-ghost" type="button" data-account-scan>扫码登录</button>' : ''}
          ${source.connected ? '<button class="btn btn-ghost" type="button" data-account-disconnect>断开</button>' : ''}
        </div>
        <p class="account-status ${statusClass}" data-account-status>${escapeHTML(
          source.lastError || status
        )}</p>
      </article>`;
  }

  function setAccountLoginBusy(busy) {
    state.loginBusy = Boolean(busy);
    $$('#accountsList [data-account-save], #accountsList [data-account-login], #accountsList [data-account-scan]').forEach(
      (button) => {
        button.disabled = Boolean(busy);
      }
    );
    const all = $('#loginAllAccounts');
    if (all) all.disabled = Boolean(busy);
  }

  function renderAccountsPage() {
    const list = $('#accountsList');
    if (!list) return;
    if (!state.sources.length) {
      list.innerHTML = '<div class="empty"><p>正在加载数据源…</p></div>';
      setAccountLoginBusy(Boolean(state.loginBusy));
      setSettingsTab(state.settingsTab);
      return;
    }
    list.innerHTML = state.sources.map(accountCardHTML).join('');
    setAccountLoginBusy(Boolean(state.loginBusy));
    setSettingsTab(state.settingsTab);
  }

  function accountCardPayload(card) {
    const payload = {};
    card.querySelectorAll('[data-account-field]').forEach((input) => {
      if (input.type === 'checkbox') {
        payload[input.dataset.accountField] = input.checked;
        return;
      }
      const value =
        input.dataset.accountField === 'password' ? input.value : input.value.trim();
      if (value) payload[input.dataset.accountField] = value;
    });
    // 账号配置页不再提供开关，保存时默认用于自动登录
    payload.autoLogin = true;
    return payload;
  }

  async function saveAccountCard(card, button) {
    if (state.loginBusy) {
      showToast('已有登录正在进行，请稍候');
      return;
    }

    const id = card.dataset.accountCard;
    const source = state.sources.find((item) => item.id === id);
    const payload = accountCardPayload(card);
    const passwordInput = card.querySelector('[data-account-field="password"]');
    if (
      !payload.username &&
      !(passwordInput && passwordInput.value.trim()) &&
      !(source && source.fields && source.fields.hasPassword)
    ) {
      showToast('请填写账号和密码');
      return;
    }

    state.loginBusy = true;
    setAccountLoginBusy(true);
    setBtnBusy(button, true, '保存中…');
    try {
      const saved = await Api.saveCredentials(id, payload);
      state.sources = saved.sources || state.sources;
      const result = await Api.loginAccount(id);
      state.sources = result.sources || state.sources;
      showToast(result.message || '已保存并登录');
      renderAccountsPage();
      await loadData();
    } catch (error) {
      setBtnBusy(button, false);
      renderAccountsPage();
      showToast(error.message || '保存或登录失败');
    } finally {
      state.loginBusy = false;
      setAccountLoginBusy(false);
    }
  }

  async function loginAccountCard(card, button) {
    if (state.loginBusy) {
      showToast('已有登录正在进行，请稍候');
      return;
    }

    const id = card.dataset.accountCard;
    state.loginBusy = true;
    setAccountLoginBusy(true);
    setBtnBusy(button, true, '登录中…');
    try {
      const result = await Api.loginAccount(id);
      state.sources = result.sources || state.sources;
      showToast(result.message || '登录成功');
      renderAccountsPage();
      await loadData();
    } catch (error) {
      setBtnBusy(button, false);
      renderAccountsPage();
      showToast(error.message || '登录失败');
    } finally {
      state.loginBusy = false;
      setAccountLoginBusy(false);
    }
  }

  async function scanLoginAccount(card, button) {
    if (state.loginBusy) {
      showToast('已有登录正在进行，请稍候');
      return;
    }

    const id = card.dataset.accountCard;
    state.loginBusy = true;
    setAccountLoginBusy(true);
    setBtnBusy(button, true, '等待扫码…');
    const finish = () => {
      state.loginBusy = false;
      setAccountLoginBusy(false);
    };

    try {
      const { id: jobId } = await Api.startLogin(id);
      showToast('已打开登录窗口，请扫码完成登录');
      const timer = setInterval(async () => {
        try {
          const result = await Api.getLoginStatus(id, jobId);
          if (result.status === 'success') {
            clearInterval(timer);
            showToast(result.message || '登录成功');
            const latest = await Api.getSources();
            state.sources = latest.sources || state.sources;
            renderAccountsPage();
            await loadData();
            finish();
          } else if (result.status === 'failed') {
            clearInterval(timer);
            setBtnBusy(button, false);
            showToast(result.message || '登录失败');
            finish();
          }
        } catch (error) {
          clearInterval(timer);
          setBtnBusy(button, false);
          showToast('登录状态查询失败');
          finish();
        }
      }, 2000);
    } catch (error) {
      setBtnBusy(button, false);
      showToast(error.message || '无法启动扫码登录');
      finish();
    }
  }

  async function disconnectAccountCard(card, button) {
    const id = card.dataset.accountCard;
    setBtnBusy(button, true, '断开中…');
    try {
      const result = await Api.disconnectSource(id);
      state.sources = result.sources || state.sources;
      showToast('已断开');
      renderAccountsPage();
      await loadData();
    } catch (error) {
      setBtnBusy(button, false);
      showToast(error.message || '断开失败');
    }
  }

  async function loginAllAccounts() {
    if (state.loginBusy) {
      showToast('已有登录正在进行，请稍候');
      return;
    }

    const button = $('#loginAllAccounts');
    const label = button && button.querySelector('.login-all-text');
    const fill = button && button.querySelector('.login-progress i');
    const setProgress = (text, percent) => {
      if (label) label.textContent = text;
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    };

    state.loginBusy = true;
    setAccountLoginBusy(true);
    setProgress('正在保存账号…', 0);
    try {
      const cards = [...$$('#accountsList [data-account-card]')];
      for (const card of cards) {
        const id = card.dataset.accountCard;
        const source = state.sources.find((item) => item.id === id);
        const payload = accountCardPayload(card);
        const passwordInput = card.querySelector('[data-account-field="password"]');
        const hasPasswordInput = Boolean(passwordInput && passwordInput.value.length > 0);
        const hasSavedPassword = Boolean(source && source.fields && source.fields.hasPassword);

        if (!payload.username && !hasPasswordInput && !hasSavedPassword) continue;
        if (payload.autoLogin && !hasPasswordInput && !hasSavedPassword) {
          payload.autoLogin = false;
        }

        const saved = await Api.saveCredentials(id, payload);
        state.sources = saved.sources || state.sources;
      }

      const sources = new Map(state.sources.map((source) => [source.id, source]));
      const hasAccount = (id) => {
        const source = sources.get(id);
        return Boolean(
          source && source.fields && source.fields.username && source.fields.hasPassword
        );
      };
      const tongjiReady = hasAccount('tongji');
      const targets = [];

      for (const id of ['tongji', 'canvas', 'ketangpai', 'educoder']) {
        const source = sources.get(id);
        if (!source) continue;
        const canLogin = id === 'canvas' ? hasAccount('canvas') || tongjiReady : hasAccount(id);
        if (canLogin) targets.push(source);
      }

      if (!targets.length) {
        showToast('请先填写至少一个平台的账号密码');
        return;
      }

      const failures = [];
      for (let index = 0; index < targets.length; index += 1) {
        const source = targets[index];
        const percent = (index / targets.length) * 100;
        setProgress(`正在登录 ${source.name} · ${index + 1}/${targets.length}`, percent);

        try {
          const result = await Api.loginAccount(source.id);
          state.sources = result.sources || state.sources;
          const latest = state.sources.find((item) => item.id === source.id);
          if (latest) sources.set(source.id, latest);
        } catch (error) {
          failures.push({
            id: source.id,
            name: source.name,
            message: error.message || '登录失败',
          });
        }

        setProgress(
          `正在登录 ${source.name} · ${index + 1}/${targets.length}`,
          ((index + 1) / targets.length) * 100
        );
      }

      renderAccountsPage();
      if (failures.length) {
        openSyncFailureDialog(failures, {
          title: '部分平台登录失败',
          subtitle: '以下平台没有完成自动登录，其他平台已更新。',
        });
      } else {
        showToast('全部平台登录完成');
      }

      setProgress('正在刷新数据…', 100);
      await loadData();
    } catch (error) {
      showToast(error.message || '登录失败');
    } finally {
      state.loginBusy = false;
      setAccountLoginBusy(false);
      setProgress('全部自动登录', 0);
      if (button) button.disabled = false;
    }
  }

  function bindAccountsPage() {
    const list = $('#accountsList');
    if (list) {
      list.addEventListener('click', (event) => {
        const card = event.target.closest('[data-account-card]');
        if (!card) return;

        const save = event.target.closest('[data-account-save]');
        if (save) {
          saveAccountCard(card, save);
          return;
        }
        const login = event.target.closest('[data-account-login]');
        if (login) {
          loginAccountCard(card, login);
          return;
        }
        const manual = event.target.closest('[data-account-manual]');
        if (manual) {
          openManualSheet(card.dataset.accountCard);
          return;
        }
        const scan = event.target.closest('[data-account-scan]');
        if (scan) {
          scanLoginAccount(card, scan);
          return;
        }
        const disconnect = event.target.closest('[data-account-disconnect]');
        if (disconnect) disconnectAccountCard(card, disconnect);
      });
    }

    const all = $('#loginAllAccounts');
    if (all) all.addEventListener('click', loginAllAccounts);

    $$('[data-settings-tab]').forEach((button) => {
      button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
    });

    const checkButton = $('#checkUpdateBtn');
    if (checkButton) {
      checkButton.addEventListener('click', async () => {
        if (checkButton.disabled) return;
        setBtnBusy(checkButton, true, '检查中…');
        try {
          await checkForUpdates({ manual: true });
        } finally {
          setBtnBusy(checkButton, false);
        }
      });
    }
  }

  function collectSyncFailures(result) {
    const failures = [];
    const configured = new Set(
      state.sources.filter((source) => source.connected).map((source) => source.id)
    );

    for (const platform of result.platforms || []) {
      if (platform.connected) continue;
      if (!configured.has(platform.id)) continue;
      failures.push({
        id: platform.id,
        name: platform.name || platform.id,
        message: platform.error || '同步失败',
      });
    }

    for (const warning of result.warnings || []) {
      const index = warning.indexOf(':');
      const id = index > 0 ? warning.slice(0, index).trim() : '';
      const source = state.sources.find((item) => item.id === id);
      failures.push({
        id,
        name: source?.name || id || '数据源',
        message: index > 0 ? warning.slice(index + 1).trim() : warning,
      });
    }

    const seen = new Set();
    return failures.filter((failure) => {
      const key = `${failure.id}|${failure.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function openSyncFailureDialog(failures, options = {}) {
    if (!failures.length) return;
    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">SYNC INCOMPLETE</p>
          <h2 class="sheet-title">${escapeHTML(options.title || '部分平台同步失败')}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <p class="sheet-sub">${escapeHTML(
        options.subtitle || '以下平台没有完成同步，其他平台的数据已经更新。'
      )}</p>
      <div class="sync-failures">
        ${failures
          .map(
            (failure) => `
          <div class="sync-failure">
            <strong>${escapeHTML(failure.name)}</strong>
            <p>${escapeHTML(failure.message)}</p>
          </div>`
          )
          .join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-outline" type="button" data-close>知道了</button>
        <button class="btn btn-primary" type="button" data-fix-sources>去处理</button>
      </div>`,
      {
        onMount(sheet) {
          const fix = sheet.querySelector('[data-fix-sources]');
          if (fix) {
            fix.addEventListener('click', () => openSourcesSheet(failures[0].id));
          }
        },
      }
    );
  }

  async function pollSyncStatus() {
    if (state.syncBusy) return;

    try {
      const status = await Api.getSyncStatus();
      const busy = Boolean(status && status.busy);
      const btn = $('#syncBtn');
      const label = btn && btn.querySelector('.sync-btn-text');
      const fill = btn && btn.querySelector('.sync-progress i');

      if (busy) {
        state.externalSyncBusy = true;
        if (btn) {
          btn.disabled = true;
          btn.classList.add('is-external-sync');
          if (label) label.textContent = '正在同步';
          btn.title = '托盘正在同步作业';
        }
        return;
      }

      if (!state.externalSyncBusy) return;

      state.externalSyncBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-external-sync');
        if (label) label.textContent = '同步作业';
        if (fill) fill.style.width = '0%';
        btn.title = '';
      }

      if (status && status.ok === false) {
        showToast(`托盘同步失败：${status.message || '请查看通知'}`);
      }

      try {
        const result = await Api.getAssignments();
        state.assignments = result.assignments || state.assignments;
        state.platforms = result.platforms || state.platforms;
        state.lastSync = result.lastSync || new Date().toISOString();
        renderHomework();
      } catch (error) {
        /* 忽略刷新失败 */
      }
    } catch (error) {
      /* 后端未启动时忽略 */
    }
  }

  function startSyncStatusPolling() {
    if (state.syncPollTimer) return;
    state.syncPollTimer = setInterval(pollSyncStatus, 1500);
    pollSyncStatus();
  }

  async function syncHomework() {
    if (state.syncBusy || state.externalSyncBusy) return;

    const btn = $('#syncBtn');
    if (btn) btn.classList.remove('is-external-sync');
    const label = btn && btn.querySelector('.sync-btn-text');
    const fill = btn && btn.querySelector('.sync-progress i');
    const setProgress = (text, percent) => {
      if (label) label.textContent = text;
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    };

    const targets = state.platforms.filter((platform) => platform.connected);
    if (!targets.length) {
      showToast('没有已连接的作业平台');
      return;
    }

    state.syncBusy = true;
    if (btn) btn.disabled = true;
    const failures = [];

    try {
      setProgress('正在同步', 0);
      if (btn) btn.title = '正在同步作业';

      for (let index = 0; index < targets.length; index += 1) {
        const platform = targets[index];
        if (btn) {
          btn.title = `正在同步 ${platform.name} · ${index + 1}/${targets.length}`;
        }
        setProgress('正在同步', (index / targets.length) * 100);
        try {
          const result = await Api.loginAccount(platform.id);
          state.sources = result.sources || state.sources;
        } catch (error) {
          failures.push({
            id: platform.id,
            name: platform.name,
            message: error.message || '同步失败',
          });
        }
        setProgress('正在同步', ((index + 1) / targets.length) * 100);
      }

      setProgress('正在同步', 100);
      if (btn) btn.title = '正在刷新作业…';
      const result = await Api.getAssignments();
      state.assignments = result.assignments || state.assignments;
      state.platforms = result.platforms || state.platforms;
      state.lastSync = result.lastSync || new Date().toISOString();
      renderHomework();

      const postFailures = collectSyncFailures(result).filter(
        (failure) => !failures.some((item) => item.id === failure.id)
      );
      const allFailures = [...failures, ...postFailures];

      if (allFailures.length) {
        openSyncFailureDialog(allFailures);
      } else {
        showToast('作业已同步');
      }
    } catch (error) {
      openSyncFailureDialog([
        { id: '', name: '同步请求', message: error.message || '同步失败，请稍后重试' },
      ]);
    } finally {
      state.syncBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.title = '';
      }
      setProgress('同步作业', 0);
    }
  }

  function openAssignmentSheet(id) {
    const assignment = state.assignments.find((a) => a.id === id);
    if (!assignment) return;
    const platform = state.platforms.find((p) => p.id === assignment.platform) || { name: assignment.platform };
    const due = dueInfo(assignment);
    const status = statusInfo(assignment);

    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">${escapeHTML(platform.name)} · ${escapeHTML(assignment.course)}</p>
          <h2 class="sheet-title">${escapeHTML(assignment.title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="sheet-meta">
        <span>${due.text}</span>
        <span>${escapeHTML(assignment.type)}</span>
        <span>${escapeHTML(assignment.points || '')}</span>
        <span class="status ${status.cls}">${status.text}</span>
      </div>
      <div class="sheet-body"><p>${escapeHTML(assignment.description)}</p></div>
      <div class="sheet-actions">
        <button class="btn btn-outline" type="button" data-sheet-done="${assignment.id}">${
          assignment.done ? '恢复为待完成' : '标记为完成'
        }</button>
        <button class="btn btn-primary" type="button" data-sheet-open="${assignment.id}">在 ${escapeHTML(platform.name)} 中打开 ${icon('external')}</button>
      </div>`,
      {
        wide: true,
        onMount(sheet) {
          sheet.querySelector('[data-sheet-done]').addEventListener('click', () => {
            const next = !assignment.done;
            closeSheet();
            toggleAssignment(assignment.id, next);
          });
          sheet.querySelector('[data-sheet-open]').addEventListener('click', () => {
            window.open(assignment.url, '_blank', 'noopener');
          });
        },
      }
    );
  }

  function openConnectSheet(platformId) {
    openSourcesSheet(platformId);
  }

  function openConnectSheetLegacy(platformId) {
    const platform = state.platforms.find((p) => p.id === platformId);
    if (!platform) return;
    if (platform.connected) {
      showToast(`${platform.name} 已连接`);
      return;
    }

    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">CONNECT PLATFORM</p>
          <h2 class="sheet-title">连接 ${escapeHTML(platform.name)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <p class="sheet-sub">通过学校统一身份认证（SSO）授权。同舟只读取课程与作业信息，不会保存你的密码。</p>
      <div class="connect-card" style="--brand:${platform.color}">
        <span class="connect-logo">${platform.short}</span>
        <div>
          <strong>${escapeHTML(platform.name)}</strong>
          <span>${escapeHTML(platform.note)}</span>
        </div>
      </div>
      <div class="connect-account">
        <span>授权账号</span>
        <strong>${escapeHTML(state.user ? state.user.studentId : '—')}</strong>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-outline" type="button" data-close>取消</button>
        <button class="btn btn-primary" type="button" data-connect-confirm>使用统一身份认证登录 →</button>
      </div>`,
      {
        onMount(sheet) {
          const confirm = sheet.querySelector('[data-connect-confirm]');
          confirm.addEventListener('click', async () => {
            setBtnBusy(confirm, true, '正在认证…');
            try {
              await wait(700);
              await Api.setPlatformConnected(platform.id, true);
              platform.connected = true;
              const result = await Api.syncAssignments();
              state.assignments = result.assignments || state.assignments;
              state.platforms = result.platforms || state.platforms;
              state.lastSync = result.lastSync || new Date().toISOString();
              closeSheet();
              renderHomework();
              showToast(`${platform.name} 已连接，作业已同步`);
            } catch (e) {
              setBtnBusy(confirm, false);
              showToast(`连接失败：${e.message}`);
            }
          });
        },
      }
    );
  }

  /* ---------------- 账户面板 ---------------- */
  function versionParts(value) {
    const text = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^ver[.\-]?/, '')
      .replace(/^v/, '');
    const parts = text
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
    return parts.length ? parts : [text];
  }

  function isNewerVersion(latest, current) {
    const next = versionParts(latest);
    const now = versionParts(current);
    if (typeof next[0] === 'string' || typeof now[0] === 'string') {
      return String(latest) !== String(current);
    }

    const length = Math.max(next.length, now.length);
    for (let index = 0; index < length; index += 1) {
      const nextPart = next[index] || 0;
      const nowPart = now[index] || 0;
      if (nextPart !== nowPart) return nextPart > nowPart;
    }
    return false;
  }

  function openUpdateDialog(latest, manifest) {
    const notes = String(manifest.notes || '暂无更新说明').trim();
    const rawUrl = String(manifest.url || '');
    const releaseUrl = /^https:\/\/github\.com\//.test(rawUrl)
      ? rawUrl
      : 'https://github.com/Entiesci/TongjiAssignmentHelper/releases';

    openSheet(`
      <div class="sheet-head">
        <div>
          <p class="kicker">UPDATE AVAILABLE</p>
          <h2 class="sheet-title">发现新版本 ${escapeHTML(latest)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="sheet-body update-sheet">
        <p class="update-meta">当前版本 ${escapeHTML(APP_VERSION)}</p>
        <pre class="update-notes">${escapeHTML(notes)}</pre>
        <div class="update-actions">
          <a class="btn btn-primary" href="${escapeHTML(releaseUrl)}" target="_blank" rel="noreferrer">查看 Release</a>
          <button class="btn btn-outline" type="button" data-close>稍后再说</button>
        </div>
      </div>
    `);
  }

  function setUpdateStatus(text) {
    const status = $('#updateStatus');
    if (status) status.textContent = text;
  }

  function setSettingsTab(tab) {
    const next = ['accounts', 'update', 'about'].includes(tab) ? tab : 'accounts';
    state.settingsTab = next;
    $$('[data-settings-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.settingsTab === next);
    });
    $$('[data-settings-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== next;
    });

    const version = $('#currentVersion');
    if (version) version.textContent = APP_VERSION;
  }

  async function fetchUpdateManifest(url, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkForUpdates(options = {}) {
    const manual = Boolean(options.manual);
    if (manual) setUpdateStatus('正在检查…');

    try {
      let manifest = null;
      for (const url of UPDATE_MANIFEST_URLS) {
        manifest = await fetchUpdateManifest(url);
        if (manifest) break;
      }

      if (!manifest) {
        if (manual) setUpdateStatus('检查失败，请稍后重试');
        return null;
      }

      const latest = String(manifest.version || '').trim();
      if (!latest) {
        if (manual) setUpdateStatus('检查失败：版本信息为空');
        return null;
      }

      if (!isNewerVersion(latest, APP_VERSION)) {
        setUpdateStatus(`已是最新版本（${APP_VERSION}）`);
        return { latest, newer: false };
      }

      // 每次页面启动都提示；不写入已读状态，切换设置页不会重复触发
      setUpdateStatus(`发现新版本 ${latest}`);
      openUpdateDialog(latest, manifest);
      return { latest, newer: true };
    } catch (error) {
      if (manual) setUpdateStatus('检查失败，请稍后重试');
      return null;
    }
  }

  function openCredits() {
    openSheet(`
      <div class="sheet-head">
        <div>
          <p class="kicker">CREDITS</p>
          <h2 class="sheet-title">致谢</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="sheet-body about-sheet">
        <p>感谢开发者 <strong>entiesci</strong>，把校历、学校通知和作业收进同一个安静的页面。</p>
        <a class="btn btn-outline" href="${DEVELOPER_GITHUB}" target="_blank" rel="noreferrer">github.com/entiesci</a>
        <p>也感谢 <strong>大肥鱼</strong> 的支持与帮助。</p>
        <p class="about-note">感谢同济大学提供的算力支持。</p>
      </div>
    `);
  }

  function openAccountSheet() {
    if (!state.user) return;
    const modeLabel = Api.getMode() === 'server' ? 'Node 模拟后端' : '浏览器本地演示数据';

    openSheet(
      `
      <div class="sheet-head">
        <div>
          <p class="kicker">ACCOUNT</p>
          <h2 class="sheet-title">账户与偏好</h2>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
      </div>

      <div class="account-section" style="border-top:0;padding-top:16px">
        <div class="account-head">
          <span class="avatar">${escapeHTML(state.user.initials || state.user.name.slice(0, 1))}</span>
          <div>
            <strong>${escapeHTML(state.user.name)}</strong>
            <span>${escapeHTML(state.user.studentId)} · ${escapeHTML(state.user.college)}</span>
          </div>
        </div>
      </div>

      ${
        THEME_TOGGLE_ENABLED
          ? `<div class="account-section">
        <p class="account-label">外观</p>
        <div class="theme-options">
          <button class="theme-option${state.theme === 'light' ? ' is-active' : ''}" type="button" data-theme-mode="light">浅色</button>
          <button class="theme-option${state.theme === 'dark' ? ' is-active' : ''}" type="button" data-theme-mode="dark">深色</button>
          <button class="theme-option${state.theme === 'system' ? ' is-active' : ''}" type="button" data-theme-mode="system">跟随系统</button>
        </div>
      </div>`
          : ''
      }

      <div class="account-section">
        <p class="account-label">作业平台</p>
        ${state.platforms
          .map(
            (platform) => `
            <div class="platform-row" style="--brand:${platform.color}">
              <span class="platform-logo">${platform.short}</span>
              <div class="platform-row-info">
                <strong>${escapeHTML(platform.name)}</strong>
                <small>${platform.connected ? '已连接 · 自动同步作业' : '未连接'}</small>
              </div>
              <button class="mini-switch${platform.connected ? ' is-on' : ''}" type="button" data-toggle-platform="${platform.id}">
                ${platform.connected ? '已连接' : '连接'}
              </button>
            </div>`
          )
          .join('')}
      </div>

      <div class="account-section">
        <p class="account-label">数据来源</p>
        <p style="margin-top:7px;font-size:10.5px;line-height:1.7;color:var(--muted)">
          当前使用 ${modeLabel}。校历与通知来自统一身份认证门户，作业来自课堂派、Educoder 与 Canvas。
        </p>
      </div>

      <button class="account-logout" type="button" data-logout>${icon('logout')} 退出登录</button>
      `,
      {
        onMount(sheet) {
          sheet.querySelectorAll('[data-theme-mode]').forEach((btn) => {
            btn.addEventListener('click', () => applyTheme(btn.dataset.themeMode));
          });

          sheet.querySelectorAll('[data-toggle-platform]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const platform = state.platforms.find((p) => p.id === btn.dataset.togglePlatform);
              if (!platform) return;
              if (!platform.connected) {
                closeSheet();
                openConnectSheet(platform.id);
                return;
              }
              btn.disabled = true;
              try {
                await Api.setPlatformConnected(platform.id, false);
                platform.connected = false;
                closeSheet();
                renderHomework();
                showToast(`${platform.name} 已断开连接`);
              } catch (e) {
                btn.disabled = false;
                showToast('断开失败，请稍后重试');
              }
            });
          });

          sheet.querySelector('[data-logout]').addEventListener('click', logout);
        },
      }
    );
  }

  /* ---------------- 弹层 ---------------- */
  function openSheet(html, options) {
    const opts = options || {};
    const root = $('#dialogRoot');
    root.innerHTML = `<div class="scrim" data-scrim><div class="sheet${opts.wide ? ' sheet-wide' : ''}${opts.full ? ' sheet-full' : ''}" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`;
    document.body.style.overflow = 'hidden';
    const sheet = root.querySelector('.sheet');
    sheet.focus({ preventScroll: true });
    if (opts.onMount) opts.onMount(sheet);
  }

  function closeSheet() {
    $('#dialogRoot').innerHTML = '';
    const drawer = $('#dayDrawer');
    document.body.style.overflow = drawer && !drawer.hidden ? 'hidden' : '';
  }

  function renderArtCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    $('#artMonth').textContent = MONTH_EN[month];
    $('#artYear').textContent = String(year);
    $('#artWeek').innerHTML = WEEKDAYS.map((day) => `<span>${day}</span>`).join('');

    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const weekStart = mondayOnOrBefore(now);
    const markStart = weekStart.getDate();
    const markEnd = Math.min(days, markStart + 4);

    let html = '';
    for (let i = 0; i < offset; i += 1) html += '<span></span>';
    for (let day = 1; day <= days; day += 1) {
      const classes = [];
      if (day >= markStart && day <= markEnd) classes.push('is-marked');
      if (day === today) classes.push('is-today');
      html += `<span class="${classes.join(' ')}">${day}</span>`;
    }
    $('#artCalGrid').innerHTML = html;

    let semesterStart;
    if (month >= 7) semesterStart = mondayOnOrBefore(new Date(year, 8, 7));
    else if (month === 0) semesterStart = mondayOnOrBefore(new Date(year - 1, 8, 7));
    else semesterStart = mondayOnOrBefore(new Date(year, 1, 22));
    const week = Math.floor((startOfDay(now) - semesterStart) / 86400000 / 7) + 1;
    $('#artCalNote').textContent = `第 ${week} 周 · ${fmtMD(weekStart)} — ${fmtMD(addDays(weekStart, 6))}`;
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $$('[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => setRoute(btn.dataset.route));
    });

    bindAccountsPage();
    startSyncStatusPolling();

    window.addEventListener('popstate', () => {
      const route = currentHash();
      if (ROUTES.includes(route)) setRoute(route, { replace: true });
    });

    if (!THEME_TOGGLE_ENABLED) {
      ['#themeToggle', '#themeToggleMobile'].forEach((selector) => {
        const button = $(selector);
        if (button) button.hidden = true;
      });
    }
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#themeToggleMobile').addEventListener('click', toggleTheme);
    $('#accountBtn').addEventListener('click', () => openSourcesSheet());
    $('#accountBtnMobile').addEventListener('click', () => openSourcesSheet());
    $('#aboutBtn')?.addEventListener('click', openCredits);
    $('#aboutBtnMobile')?.addEventListener('click', openCredits);
    $('#sourcesBtnMobile').addEventListener('click', () => openSourcesSheet());

    $('#prevMonth').addEventListener('click', () => {
      closeDayDrawer();
      state.ui.month = new Date(state.ui.month.getFullYear(), state.ui.month.getMonth() - 1, 1);
      renderCalendar();
    });
    $('#nextMonth').addEventListener('click', () => {
      closeDayDrawer();
      state.ui.month = new Date(state.ui.month.getFullYear(), state.ui.month.getMonth() + 1, 1);
      renderCalendar();
    });
    $('#calToday').addEventListener('click', () => {
      const now = new Date();
      state.ui.month = new Date(now.getFullYear(), now.getMonth(), 1);
      state.ui.selectedDate = todayKey();
      renderCalendar();
      openDayDrawer();
    });
    $('#calExport').addEventListener('click', exportIcs);

    $$('[data-close-drawer]').forEach((element) => {
      element.addEventListener('click', closeDayDrawer);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDayDrawer();
    });

    $('#calendarGrid').addEventListener('click', (event) => {
      const day = event.target.closest('.day');
      if (!day) return;
      const key = day.dataset.date;
      const date = parseKey(key);
      state.ui.selectedDate = key;
      if (date.getMonth() !== state.ui.month.getMonth() || date.getFullYear() !== state.ui.month.getFullYear()) {
        state.ui.month = new Date(date.getFullYear(), date.getMonth(), 1);
      }
      renderCalendar();
      openDayDrawer();
    });

    $('#dayCard').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-event]');
      if (btn) openEventSheet(btn.dataset.event);
    });

    $('#upcomingList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-event]');
      if (btn) jumpToEvent(btn.dataset.event);
    });

    $('#noticeSearch').addEventListener(
      'input',
      debounce((event) => {
        state.ui.noticeQuery = event.target.value;
        renderNotices();
      }, 150)
    );

    $('#unreadOnly').addEventListener('click', () => {
      state.ui.unreadOnly = !state.ui.unreadOnly;
      $('#unreadOnly').setAttribute('aria-checked', String(state.ui.unreadOnly));
      renderNotices();
    });

    $('#markAllRead').addEventListener('click', markAllRead);

    $('#noticeList').addEventListener('click', (event) => {
      const row = event.target.closest('[data-notice]');
      if (row) openNotice(row.dataset.notice);
    });

    $('#noticeList').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-notice]');
      if (!row) return;
      event.preventDefault();
      openNotice(row.dataset.notice);
    });

    $('#noticeDetail').addEventListener('click', (event) => {
      if (event.target.closest('[data-detail-close]')) {
        closeNoticeDetail();
        return;
      }
      const notice = state.notices.find((n) => n.id === state.ui.activeNotice);
      if (!notice) return;
      if (event.target.closest('[data-open-source]')) {
        window.open(notice.url, '_blank', 'noopener');
      }
      if (event.target.closest('[data-copy-link]')) {
        const done = () => showToast('原文链接已复制');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(notice.url).then(done).catch(() => showToast('复制失败，请手动打开原文'));
        } else {
          showToast('当前环境不支持自动复制');
        }
      }
    });

    $('#syncBtn').addEventListener('click', syncHomework);

    $('#hwList').addEventListener('click', (event) => {
      const check = event.target.closest('[data-check]');
      if (check) {
        event.stopPropagation();
        const assignment = state.assignments.find((a) => a.id === check.dataset.check);
        if (assignment) toggleAssignment(assignment.id, !assignment.done);
        return;
      }
      const open = event.target.closest('[data-open-platform]');
      if (open) {
        event.stopPropagation();
        const assignment = state.assignments.find((a) => a.id === open.dataset.openPlatform);
        if (assignment) window.open(assignment.url, '_blank', 'noopener');
        return;
      }
      const row = event.target.closest('[data-assignment]');
      if (row) openAssignmentSheet(row.dataset.assignment);
    });

    $('#hwList').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-assignment]');
      if (!row) return;
      event.preventDefault();
      openAssignmentSheet(row.dataset.assignment);
    });

    document.addEventListener('click', (event) => {
      const login = event.target.closest('[data-open-login]');
      if (login) {
        const source = state.sources.find((item) => item.id === login.dataset.openLogin);
        if (source && source.loginUrl) window.open(source.loginUrl, '_blank', 'noopener');
      }
      const open = event.target.closest('[data-open-sources]');
      if (open) openSourcesSheet(open.dataset.openSources);
    });

    $('#dialogRoot').addEventListener('click', (event) => {
      if (event.target.closest('[data-close]') || event.target.hasAttribute('data-scrim')) {
        closeSheet();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if ($('#dialogRoot').children.length) {
        closeSheet();
      } else if (state.ui.detailOpen && window.matchMedia('(max-width: 900px)').matches) {
        closeNoticeDetail();
      }
    });

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    systemTheme.addEventListener('change', () => {
      if (state.theme === 'system') applyTheme('system');
    });
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    applyTheme(THEME_TOGGLE_ENABLED ? storedTheme() : 'light');
    renderArtCalendar();
    bindEvents();

    try {
      await Api.init();
    } catch (error) {
      $('#loginView').hidden = true;
      $('#shell').hidden = false;
      openSheet(`
        <div class="sheet-head">
          <div>
            <p class="kicker">SERVER OFFLINE</p>
            <h2 class="sheet-title">后端未启动</h2>
          </div>
          <button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="sheet-body">
          <p>实时抓取需要本地 Node 服务。请在 <code>tongji-hub</code> 目录运行：</p>
          <p><strong>npm start</strong></p>
          <p>然后刷新 <code>http://127.0.0.1:4173</code>。</p>
        </div>
        <div class="sheet-actions">
          <button class="btn btn-outline" type="button" data-close>知道了</button>
        </div>
      `);
      return;
    }

    state.user = {
      name: '校园用户',
      studentId: '—',
      college: '统一身份认证',
      initials: '同',
    };
    await enterApp(false);
    setTimeout(checkForUpdates, 1200);
  }

  init();
})();
