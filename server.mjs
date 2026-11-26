/* ============================================================
 * 同舟 · 实时数据服务
 * ------------------------------------------------------------
 * 零依赖 Node 服务：
 *  - 静态页面
 *  - 数据源登录态（Cookie / Token）
 *  - 真实抓取 1.tongji.edu.cn / Canvas / Educoder / 课堂派
 *
 * 未登录时返回 401 + loginUrl，前端引导用户去登录页。
 * 不再自动回退演示数据。
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AuthError,
  ScrapeError,
  scrapeTongjiCalendar,
  scrapeTongjiNotices,
  scrapeAll,
} from './scrapers.mjs';
import { startLogin, getLoginJob, refreshSnapshot, autoLoginTongji } from './auth-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL = 24 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '.data');
const CREDS_FILE = path.join(DATA_DIR, 'credentials.json');
const UPDATE_DIR = path.join(DATA_DIR, 'update');

let appVersion = '';
try {
  appVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version || '';
} catch (error) {
  appVersion = '';
}

const UPDATE_HOSTS = [
  'entiesci.github.io',
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'cdn.jsdelivr.net',
  '127.0.0.1',
  'localhost',
];

let updateState = {
  state: 'idle',
  progress: 0,
  message: '',
  version: null,
  error: null,
  startedAt: 0,
  finishedAt: 0,
};

let savedCreds = {};
try {
  savedCreds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
} catch (error) {
  savedCreds = {};
}

let ketangpaiSnapshot = null;
try {
  ketangpaiSnapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ketangpai.json'), 'utf8'));
} catch (error) {
  ketangpaiSnapshot = null;
}

let educoderSnapshot = null;
try {
  educoderSnapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'educoder.json'), 'utf8'));
} catch (error) {
  educoderSnapshot = null;
}

let canvasSnapshot = null;
try {
  canvasSnapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'canvas.json'), 'utf8'));
} catch (error) {
  canvasSnapshot = null;
}

let accountLoginBusy = null;
let oneClickLoginId = null;
let desktopSyncState = {
  busy: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
  pending: null,
  message: null,
};

function activeOneClickJob() {
  if (!oneClickLoginId) return null;
  const job = getLoginJob(oneClickLoginId);
  if (!job || job.status !== 'waiting') {
    oneClickLoginId = null;
    return null;
  }
  return job;
}

function assertLoginIdle() {
  if (accountLoginBusy) {
    const error = new Error('已有登录正在进行，请稍后再试');
    error.code = 'LOGIN_BUSY';
    throw error;
  }
  if (activeOneClickJob()) {
    const error = new Error('已有登录窗口正在进行，请先完成或关闭它');
    error.code = 'LOGIN_BUSY';
    throw error;
  }
}

async function withAccountLoginLock(label, task) {
  assertLoginIdle();
  accountLoginBusy = label;
  try {
    return await task();
  } finally {
    accountLoginBusy = null;
  }
}

function persistCreds(creds) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), 'utf8');
  } catch (error) {
    console.error('[creds] 保存失败', error.message);
  }
}

const SOURCES = {
  tongji: {
    id: 'tongji',
    name: '同济大学门户',
    desc: '校历 + 学校通知',
    loginUrl: 'https://1.tongji.edu.cn/',
    authType: 'cookie',
    covers: ['calendar', 'notices'],
    hint: '登录后按 F12 → 网络 → 任意请求 → 复制请求头里的 Cookie。',
  },
  canvas: {
    id: 'canvas',
    name: 'Canvas',
    desc: '课程作业',
    loginUrl: 'https://canvas.tongji.edu.cn/',
    authType: 'token',
    covers: ['homework'],
    hint: '在 Canvas「账户 → 设置 → 新建访问令牌」生成 Token，或复制已登录请求的 Cookie。',
  },
  educoder: {
    id: 'educoder',
    name: 'Educoder / 头歌',
    desc: '课后作业、图文作业、编程作业',
    loginUrl: 'https://www.educoder.net/classrooms/6ryliqfk/common_homework',
    authType: 'cookie',
    covers: ['homework'],
    hint: '登录后复制 Cookie；如接口带 zzud，请把完整作业接口地址一起粘贴。',
  },
  ketangpai: {
    id: 'ketangpai',
    name: '课堂派',
    desc: '课程作业',
    loginUrl: 'https://prepc.ketangpai.com/#/login',
    authType: 'cookie',
    covers: ['homework'],
    hint: '登录后复制 Cookie。',
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** @type {Map<string, any>} */
const sessions = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index > -1) acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return acc;
  }, {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createSession(res) {
  const id = crypto.randomUUID();
  const session = {
    id,
    creds: JSON.parse(JSON.stringify(savedCreds)),
    read: new Set(),
    done: new Map(),
    lastError: {},
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  res.setHeader('Set-Cookie', `sid=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  return session;
}

function getSession(req, res) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) {
    const existing = sessions.get(sid);
    if (existing && Date.now() - existing.createdAt < SESSION_TTL) return existing;
    if (existing) sessions.delete(sid);
  }
  return createSession(res);
}

function hasCreds(session, id) {
  const creds = session.creds[id] || {};
  // 快照型数据源即使没有 Cookie，也应视为已连接
  if (id === 'ketangpai' && ketangpaiSnapshot) return true;
  if (id === 'educoder' && educoderSnapshot) return true;
  if (id === 'canvas') return Boolean(creds.token || creds.curl || creds.cookie || canvasSnapshot);
  if (id === 'tongji') {
    return Boolean(
      creds.cookie ||
        creds.curl ||
        (creds.autoLogin && creds.username && creds.password)
    );
  }
  return Boolean(creds.cookie || creds.curl);
}

function publicSources(session) {
  return Object.values(SOURCES).map((source) => {
    const creds = session.creds[source.id] || {};
    return {
      ...source,
      connected: hasCreds(session, source.id) && !session.lastError[source.id],
      lastError: session.lastError[source.id] || null,
      fields: {
        hasCookie: Boolean(creds.cookie),
        hasToken: Boolean(creds.token),
        baseUrl: creds.baseUrl || '',
        courseId: creds.courseId || '',
        hasApiUrl: Boolean(creds.apiUrl),
        hasZzud: Boolean(creds.zzud),
        hasCurl: Boolean(creds.curl),
        courseFilter: creds.courseFilter || '',
        username: creds.username || '',
        hasPassword: Boolean(creds.password),
        autoLogin: Boolean(creds.autoLogin),
      },
    };
  });
}

function loginRequired(res, source) {
  return json(res, 401, {
    code: 'AUTH_REQUIRED',
    source,
    loginUrl: SOURCES[source]?.loginUrl || '',
    message: `请先登录${SOURCES[source]?.name || '数据源'}`,
  });
}

async function tryAutoLoginTongji(session) {
  const creds = session.creds.tongji || {};
  if (!creds.autoLogin || !creds.username || !creds.password) return false;
  if (accountLoginBusy || activeOneClickJob()) return false;
  if (session.autoLoginBlockedUntil && Date.now() < session.autoLoginBlockedUntil) return false;

  if (session.tongjiLoginPromise) {
    try {
      await session.tongjiLoginPromise;
      return true;
    } catch (error) {
      return false;
    }
  }

  session.tongjiLoginPromise = (async () => {
    try {
      console.log('[tongji-auto-login] trying');
      const cookie = await autoLoginTongji({
        username: creds.username,
        password: creds.password,
        dataDir: DATA_DIR,
      });
      session.creds.tongji = { ...creds, cookie };
      session.lastError.tongji = null;
      savedCreds = JSON.parse(JSON.stringify(session.creds));
      persistCreds(savedCreds);
      console.log('[tongji-auto-login] success');
      return true;
    } catch (error) {
      session.lastError.tongji = `登录已过期，自动重登失败：${error.message}`;
      session.autoLoginBlockedUntil = Date.now() + 5 * 60 * 1000;
      console.error('[tongji-auto-login]', error.message);
      throw error;
    } finally {
      session.tongjiLoginPromise = null;
    }
  })();

  try {
    await session.tongjiLoginPromise;
    return true;
  } catch (error) {
    return false;
  }
}

async function autoLoginCanvas(session) {
  if (!hasCreds(session, 'tongji')) return false;
  if (accountLoginBusy || activeOneClickJob()) return false;
  if (session.canvasAutoLoginBlockedUntil && Date.now() < session.canvasAutoLoginBlockedUntil) {
    return false;
  }
  if (session.canvasLoginPromise) return session.canvasLoginPromise;

  session.canvasLoginPromise = (async () => {
    try {
      console.log('[canvas-auto-login] trying');
      const snapshot = await refreshSnapshot('canvas', DATA_DIR, savedCreds);
      if (!snapshot || !Array.isArray(snapshot.assignments) || !snapshot.assignments.length) {
        throw new Error('没有提取到 Canvas 作业');
      }
      canvasSnapshot = snapshot;
      session.lastError.canvas = null;
      session.canvasAutoLoginBlockedUntil = 0;
      console.log('[canvas-auto-login] success', snapshot.assignments.length);
      return true;
    } catch (error) {
      session.canvasAutoLoginBlockedUntil = Date.now() + 5 * 60 * 1000;
      session.lastError.canvas = error.message;
      console.warn('[canvas-auto-login]', error.message);
      return false;
    } finally {
      session.canvasLoginPromise = null;
    }
  })();

  return session.canvasLoginPromise;
}

async function loginSource(session, source) {
  const creds = session.creds[source] || {};

  if (source === 'tongji') {
    if (!creds.username || !creds.password) throw new Error('请先填写同济账号和密码');
    const cookie = await autoLoginTongji({
      username: creds.username,
      password: creds.password,
      dataDir: DATA_DIR,
    });
    session.creds.tongji = { ...creds, cookie };
    session.lastError.tongji = null;
    savedCreds = JSON.parse(JSON.stringify(session.creds));
    persistCreds(savedCreds);
    return { ok: true, message: '同济登录成功' };
  }

  if (!['canvas', 'ketangpai', 'educoder'].includes(source)) {
    throw new Error('不支持的数据源');
  }

  const snapshot = await refreshSnapshot(source, DATA_DIR, savedCreds);
  if (source === 'canvas') canvasSnapshot = snapshot;
  if (source === 'ketangpai') ketangpaiSnapshot = snapshot;
  if (source === 'educoder') educoderSnapshot = snapshot;
  session.lastError[source] = null;
  return {
    ok: true,
    message: `登录成功，已同步 ${snapshot.assignments?.length || 0} 项作业`,
  };
}

async function syncDesktopNotices() {
  const creds = savedCreds.tongji || {};
  const canAutoLogin = Boolean(creds.autoLogin && creds.username && creds.password);

  try {
    let data;
    try {
      data = await scrapeTongjiNotices(creds);
    } catch (error) {
      if (!(error instanceof AuthError) || !canAutoLogin) throw error;

      const cookie = await autoLoginTongji({
        username: creds.username,
        password: creds.password,
        dataDir: DATA_DIR,
      });
      savedCreds.tongji = { ...creds, cookie, autoLogin: true };
      persistCreds(savedCreds);
      data = await scrapeTongjiNotices(savedCreds.tongji);
    }

    const snapshot = { generatedAt: new Date().toISOString(), ...data };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, 'notices.json'),
      JSON.stringify(snapshot, null, 2),
      'utf8'
    );

    return {
      ok: true,
      count: Array.isArray(data.notices) ? data.notices.length : 0,
      unread: Array.isArray(data.notices)
        ? data.notices.filter((notice) => notice.unread).length
        : 0,
    };
  } catch (error) {
    console.warn('[tongji-notices]', error.message);
    return { ok: false, error: error.message };
  }
}

async function runDesktopSync() {
  return withAccountLoginLock('desktop-sync', async () => {
    const warnings = [];

    for (const source of ['ketangpai', 'educoder', 'canvas']) {
      const sessionLike = { creds: savedCreds };
      if (!hasCreds(sessionLike, source)) continue;
      try {
        const snapshot = await refreshSnapshot(source, DATA_DIR, savedCreds);
        if (source === 'ketangpai') ketangpaiSnapshot = snapshot;
        if (source === 'educoder') educoderSnapshot = snapshot;
        if (source === 'canvas') canvasSnapshot = snapshot;
      } catch (error) {
        warnings.push(`${SOURCES[source]?.name || source}: ${error.message}`);
      }
    }

    const creds = { ...savedCreds };
    if (ketangpaiSnapshot) {
      creds.ketangpai = { ...(creds.ketangpai || {}), snapshot: ketangpaiSnapshot };
    }
    if (educoderSnapshot) {
      creds.educoder = { ...(creds.educoder || {}), snapshot: educoderSnapshot };
    }
    if (canvasSnapshot) {
      creds.canvas = { ...(creds.canvas || {}), snapshot: canvasSnapshot };
    }

    let data;
    try {
      data = await scrapeAll(creds);
    } catch (error) {
      if (error instanceof AuthError) {
        const notices = await syncDesktopNotices();
        return {
          ok: false,
          pending: 0,
          total: 0,
          failures: [...warnings, `${SOURCES[error.source]?.name || error.source}: 未登录`],
          message: '有平台尚未登录，请先在账号配置中登录',
          notices,
          syncedAt: new Date().toISOString(),
        };
      }
      throw error;
    }

    const failures = [...warnings];
    data.platforms.forEach((platform) => {
      if (!platform.connected && platform.error && platform.error !== '未登录') {
        failures.push(`${platform.name}: ${platform.error}`);
      }
    });

    const pending = data.assignments.filter((assignment) => !assignment.done);
    const notices = await syncDesktopNotices();
    return {
      ok: true,
      pending: pending.length,
      total: data.assignments.length,
      pendingTitles: pending.map((assignment) => assignment.title).slice(0, 3),
      failures: [...new Set(failures)],
      notices,
      syncedAt: new Date().toISOString(),
    };
  });
}

async function fetchTongjiWithAutoLogin(session, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    const creds = session.creds.tongji || {};
    if (!creds.autoLogin || !creds.username || !creds.password) throw error;

    const ok = await tryAutoLoginTongji(session);
    if (!ok) {
      throw new AuthError(
        'tongji',
        session.lastError.tongji || '登录已过期，自动重登失败，请手动一键登录'
      );
    }
    return fetcher();
  }
}

function fail(res, error) {
  if (error instanceof AuthError) {
    return json(res, 401, {
      code: 'AUTH_REQUIRED',
      source: error.source,
      loginUrl: SOURCES[error.source]?.loginUrl || '',
      message: error.message || `请先登录${SOURCES[error.source]?.name || '数据源'}`,
    });
  }
  if (error instanceof ScrapeError) {
    return json(res, 502, { code: 'SCRAPE_FAILED', source: error.source, message: error.message });
  }
  console.error('[scrape]', error);
  return json(res, 500, { code: 'INTERNAL', message: error.message || '抓取失败' });
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(__dirname, relative);
  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return json(res, 200, {
      ok: true,
      mode: 'live',
      version: appVersion,
      now: new Date().toISOString(),
    });
  }

  if (pathname === '/api/update/status' && method === 'GET') {
    return json(res, 200, { ...updateState, currentVersion: appVersion });
  }

  if (pathname === '/api/update/apply' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { message: error.message });
    }

    if (updateState.state === 'downloading' || updateState.state === 'extracting' || updateState.state === 'applying') {
      return json(res, 409, { message: '已有更新正在进行' });
    }

    const url = String(body.url || '').trim();
    const version = String(body.version || '').trim();
    if (!url) return json(res, 400, { message: '缺少更新地址' });

    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return json(res, 400, { message: '更新地址无效' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return json(res, 400, { message: '更新地址无效' });
    }
    if (!UPDATE_HOSTS.includes(parsed.hostname)) {
      return json(res, 400, { message: '不允许从该地址更新' });
    }

    runUpdate(url, version).catch((error) => {
      console.error('[update]', error);
    });

    return json(res, 200, { ok: true, version });
  }

  if (pathname === '/api/sync/status' && method === 'GET') {
    if (desktopSyncState.busy && Date.now() - desktopSyncState.startedAt > 300000) {
      desktopSyncState = {
        ...desktopSyncState,
        busy: false,
        finishedAt: Date.now(),
        ok: false,
        message: '同步超时',
      };
    }
    return json(res, 200, desktopSyncState);
  }

  if (pathname === '/api/desktop/sync' && method === 'POST') {
    if (desktopSyncState.busy) {
      return json(res, 409, { ok: false, message: '已有同步正在进行' });
    }

    desktopSyncState = {
      busy: true,
      startedAt: Date.now(),
      finishedAt: null,
      ok: null,
      pending: null,
      message: null,
    };

    try {
      const result = await runDesktopSync();
      desktopSyncState = {
        busy: false,
        startedAt: desktopSyncState.startedAt,
        finishedAt: Date.now(),
        ok: result.ok !== false,
        pending: result.pending ?? null,
        message: result.message || null,
      };
      return json(res, 200, result);
    } catch (error) {
      desktopSyncState = {
        busy: false,
        startedAt: desktopSyncState.startedAt,
        finishedAt: Date.now(),
        ok: false,
        pending: null,
        message: error.message || '同步失败',
      };
      return json(res, error.code === 'LOGIN_BUSY' ? 409 : 500, {
        ok: false,
        message: error.message || '同步失败',
      });
    }
  }

  const session = getSession(req, res);

  const authStart = pathname.match(/^\/api\/auth\/([^/]+)\/start$/);
  if (authStart && method === 'POST') {
    const source = authStart[1];
    if (!['tongji', 'ketangpai', 'educoder', 'canvas'].includes(source)) {
      return json(res, 404, { message: '不支持的数据源' });
    }
    try {
      assertLoginIdle();
      const job = startLogin(source, DATA_DIR, savedCreds);
      oneClickLoginId = job.id;
      return json(res, 200, { id: job.id, status: job.status, message: job.message, source });
    } catch (error) {
      return json(res, 409, { message: error.message });
    }
  }

  const authStatus = pathname.match(/^\/api\/auth\/([^/]+)\/status\/([^/]+)$/);
  if (authStatus && method === 'GET') {
    const source = authStatus[1];
    const job = getLoginJob(authStatus[2]);
    if (!job) return json(res, 404, { status: 'failed', message: '登录任务不存在或已过期' });

    if (oneClickLoginId === job.id && job.status !== 'waiting') {
      oneClickLoginId = null;
    }

    if (job.status === 'success' && job.cookie) {
      const cookie = job.cookie;
      job.cookie = null;
      session.creds[source] = { ...(session.creds[source] || {}), cookie };
      if (source === 'ketangpai' && job.snapshot) {
        ketangpaiSnapshot = job.snapshot;
      }
      if (source === 'educoder' && job.snapshot) {
        educoderSnapshot = job.snapshot;
      }
      if (source === 'canvas' && job.snapshot) {
        canvasSnapshot = job.snapshot;
      }
      savedCreds = JSON.parse(JSON.stringify(session.creds));
      persistCreds(savedCreds);
    }

    return json(res, 200, { status: job.status, message: job.message, source });
  }

  if (pathname === '/api/sources' && method === 'GET') {
    return json(res, 200, { sources: publicSources(session) });
  }

  if (pathname === '/api/accounts/login-all' && method === 'POST') {
    try {
      const payload = await withAccountLoginLock('all', async () => {
        const results = [];
        const tongji = session.creds.tongji || {};

        for (const source of ['tongji', 'canvas', 'ketangpai', 'educoder']) {
          const creds = session.creds[source] || {};
          const canLogin =
            source === 'canvas'
              ? Boolean((creds.username && creds.password) || (tongji.username && tongji.password))
              : Boolean(creds.username && creds.password);

          if (!canLogin) {
            results.push({
              id: source,
              name: SOURCES[source]?.name || source,
              ok: false,
              message: '未配置账号密码',
            });
            continue;
          }

          try {
            const result = await loginSource(session, source);
            results.push({
              id: source,
              name: SOURCES[source]?.name || source,
              ...result,
            });
          } catch (error) {
            results.push({
              id: source,
              name: SOURCES[source]?.name || source,
              ok: false,
              message: error.message || '登录失败',
            });
          }
        }

        return { results };
      });

      return json(res, 200, { ...payload, sources: publicSources(session) });
    } catch (error) {
      return json(res, error.code === 'LOGIN_BUSY' ? 409 : 502, {
        message: error.message || '登录失败',
      });
    }
  }

  const accountLogin = pathname.match(/^\/api\/accounts\/([^/]+)\/login$/);
  if (accountLogin && method === 'POST') {
    const source = accountLogin[1];
    try {
      const result = await withAccountLoginLock(source, () => loginSource(session, source));
      return json(res, 200, { ...result, sources: publicSources(session) });
    } catch (error) {
      return json(res, error.code === 'LOGIN_BUSY' ? 409 : 502, {
        message: error.message || '登录失败',
      });
    }
  }

  if (pathname === '/api/timetable' && method === 'GET') {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'timetable.json'), 'utf8');
      return json(res, 200, JSON.parse(raw));
    } catch (error) {
      return json(res, 200, { semester: null, events: [] });
    }
  }

  if (pathname === '/api/exams' && method === 'GET') {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, 'exams.json'), 'utf8');
      return json(res, 200, JSON.parse(raw));
    } catch (error) {
      return json(res, 200, { exams: [], undated: [], periods: [] });
    }
  }

  const credentialsMatch = pathname.match(/^\/api\/sources\/([^/]+)\/credentials$/);
  if (credentialsMatch && method === 'POST') {
    const id = credentialsMatch[1];
    if (!SOURCES[id]) return json(res, 404, { message: '未知数据源' });
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { message: error.message });
    }
    const creds = { ...(session.creds[id] || {}) };
    if (body.cookie !== undefined) {
      creds.cookie = String(body.cookie || '')
        .replace(/^cookie\s*:\s*/i, '')
        .replace(/\r?\n/g, ' ')
        .trim();
    }
    if (body.token !== undefined) creds.token = String(body.token || '').trim();
    if (body.baseUrl !== undefined) creds.baseUrl = String(body.baseUrl || '').trim();
    if (body.courseId !== undefined) creds.courseId = String(body.courseId || '').trim();
    if (body.apiUrl !== undefined) creds.apiUrl = String(body.apiUrl || '').trim();
    if (body.zzud !== undefined) creds.zzud = String(body.zzud || '').trim();
    if (body.curl !== undefined) creds.curl = String(body.curl || '').trim();
    if (body.courseFilter !== undefined) creds.courseFilter = String(body.courseFilter || '').trim();
    if (body.username !== undefined) creds.username = String(body.username || '').trim();
    if (body.password !== undefined) creds.password = String(body.password || '');
    if (body.autoLogin !== undefined) creds.autoLogin = Boolean(body.autoLogin);

    if (creds.autoLogin && id === 'canvas') {
      const tongji = session.creds.tongji || {};
      const hasCanvasAccount = creds.username && creds.password;
      const hasTongjiAccount = tongji.username && tongji.password;
      if (!hasCanvasAccount && !hasTongjiAccount) {
        return json(res, 400, { message: 'Canvas 自动登录需要填写 Canvas 账号，或先配置同济账号' });
      }
    } else if (creds.autoLogin && (!creds.username || !creds.password)) {
      return json(res, 400, { message: '开启自动登录需要填写账号和密码' });
    }

    session.creds[id] = creds;
    session.lastError[id] = null;
    session.autoLoginBlockedUntil = 0;
    savedCreds = JSON.parse(JSON.stringify(session.creds));
    persistCreds(savedCreds);
    return json(res, 200, { ok: true, sources: publicSources(session) });
  }

  const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && method === 'DELETE') {
    const id = sourceMatch[1];
    delete session.creds[id];
    delete session.lastError[id];

    // 快照型数据源必须同时清掉内存快照和磁盘快照，否则下次请求又会自动接上
    if (id === 'ketangpai') {
      ketangpaiSnapshot = null;
      try {
        fs.rmSync(path.join(DATA_DIR, 'ketangpai.json'), { force: true });
      } catch (error) {
        /* ignore */
      }
    }
    if (id === 'educoder') {
      educoderSnapshot = null;
      try {
        fs.rmSync(path.join(DATA_DIR, 'educoder.json'), { force: true });
      } catch (error) {
        /* ignore */
      }
    }
    if (id === 'canvas') {
      canvasSnapshot = null;
      try {
        fs.rmSync(path.join(DATA_DIR, 'canvas.json'), { force: true });
      } catch (error) {
        /* ignore */
      }
    }

    savedCreds = JSON.parse(JSON.stringify(session.creds));
    persistCreds(savedCreds);
    return json(res, 200, { ok: true, sources: publicSources(session) });
  }

  if (pathname === '/api/calendar' && method === 'GET') {
    if (!hasCreds(session, 'tongji')) return loginRequired(res, 'tongji');
    try {
      const data = await fetchTongjiWithAutoLogin(session, () =>
        scrapeTongjiCalendar(session.creds.tongji)
      );
      session.lastError.tongji = null;
      return json(res, 200, data);
    } catch (error) {
      session.lastError.tongji = error.message;
      return fail(res, error);
    }
  }

  if (pathname === '/api/notices' && method === 'GET') {
    if (!hasCreds(session, 'tongji')) return loginRequired(res, 'tongji');
    try {
      const data = await fetchTongjiWithAutoLogin(session, () =>
        scrapeTongjiNotices(session.creds.tongji)
      );
      data.notices = data.notices.map((notice) => ({
        ...notice,
        unread: Boolean(notice.unread) && !session.read.has(notice.id),
      }));
      session.lastError.tongji = null;
      return json(res, 200, data);
    } catch (error) {
      session.lastError.tongji = error.message;
      return fail(res, error);
    }
  }

  if (pathname === '/api/notices/read-all' && method === 'POST') {
    // 只做本地已读标记，不代用户操作学校系统
    try {
      const data = await scrapeTongjiNotices(session.creds.tongji || {});
      data.notices.forEach((notice) => session.read.add(notice.id));
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 200, { ok: true });
    }
  }

  const noticeRead = pathname.match(/^\/api\/notices\/([^/]+)\/read$/);
  if (noticeRead && method === 'POST') {
    session.read.add(decodeURIComponent(noticeRead[1]));
    return json(res, 200, { ok: true });
  }

  if ((pathname === '/api/assignments' || pathname === '/api/assignments/sync') && (method === 'GET' || method === 'POST')) {
    try {
      const warnings = [];
      if (!hasCreds(session, 'canvas') && hasCreds(session, 'tongji')) {
        await autoLoginCanvas(session);
      }

      if (pathname === '/api/assignments/sync') {
        for (const source of ['ketangpai', 'educoder', 'canvas']) {
          if (!hasCreds(session, source)) continue;
          try {
            const snapshot = await refreshSnapshot(source, DATA_DIR, savedCreds);
            if (snapshot) {
              if (source === 'ketangpai') ketangpaiSnapshot = snapshot;
              if (source === 'educoder') educoderSnapshot = snapshot;
              if (source === 'canvas') canvasSnapshot = snapshot;
            }
          } catch (error) {
            warnings.push(`${source}: ${error.message}`);
          }
        }
      }

      if (ketangpaiSnapshot) {
        session.creds.ketangpai = { ...(session.creds.ketangpai || {}), snapshot: ketangpaiSnapshot };
      }
      if (educoderSnapshot) {
        session.creds.educoder = { ...(session.creds.educoder || {}), snapshot: educoderSnapshot };
      }
      if (canvasSnapshot) {
        session.creds.canvas = { ...(session.creds.canvas || {}), snapshot: canvasSnapshot };
      }
      let data = await scrapeAll(session.creds);
      const canvasPlatform = data.platforms.find((platform) => platform.id === 'canvas');
      if (canvasPlatform && !canvasPlatform.connected && hasCreds(session, 'tongji')) {
        const ok = await autoLoginCanvas(session);
        if (ok) {
          if (canvasSnapshot) {
            session.creds.canvas = { ...(session.creds.canvas || {}), snapshot: canvasSnapshot };
          }
          data = await scrapeAll(session.creds);
        }
      }

      data.assignments = data.assignments.map((assignment) => ({
        ...assignment,
        done: session.done.has(assignment.id) ? session.done.get(assignment.id) : assignment.done,
      }));
      data.platforms.forEach((platform) => {
        if (platform.error && platform.error !== '未登录') session.lastError[platform.id] = platform.error;
        if (platform.connected) session.lastError[platform.id] = null;
      });
      data.lastSync = new Date().toISOString();
      data.warnings = warnings;
      return json(res, 200, data);
    } catch (error) {
      console.error('[assignments]', error);
      return json(res, 500, { message: error.message || '作业抓取失败' });
    }
  }

  const assignmentDone = pathname.match(/^\/api\/assignments\/([^/]+)\/done$/);
  if (assignmentDone && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return json(res, 400, { message: error.message });
    }
    session.done.set(decodeURIComponent(assignmentDone[1]), Boolean(body.done));
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { message: '接口不存在' });
}

/* ---------------- 自动更新 ---------------- */

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
}

async function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const command = `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destDir)} -Force`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true }
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`解压失败（退出码 ${code}）`));
    });
  });
}

// 安装程序同时是更新包：带 --extract 时会静默解包自身
async function extractInstaller(exePath, destDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, ['--extract', destDir], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      let detail = '';
      try {
        detail = fs.readFileSync(path.join(destDir, 'extract-error.txt'), 'utf8').trim();
      } catch (error) {
        /* ignore */
      }
      reject(new Error(detail || `解包失败（退出码 ${code}）`));
    });
  });
}

function spawnUpdater(stageDir, version) {
  const script = path.join(__dirname, 'desktop', 'apply-update.mjs');
  if (!fs.existsSync(script)) throw new Error('缺少更新脚本 apply-update.mjs');

  const child = spawn(process.execPath, [script, __dirname, stageDir, version], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  setTimeout(() => {
    try {
      server.close();
    } catch (error) {
      /* ignore */
    }
    process.exit(0);
  }, 700);
}

async function runUpdate(url, version) {
  updateState = {
    state: 'downloading',
    progress: 0,
    message: '正在下载更新包',
    version: version || null,
    error: null,
    startedAt: Date.now(),
    finishedAt: 0,
  };

  try {
    fs.rmSync(UPDATE_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPDATE_DIR, { recursive: true });

    const zipPath = path.join(UPDATE_DIR, 'payload.bin');
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error('更新包内容异常');
    fs.writeFileSync(zipPath, buffer);
    setUpdateState({ progress: 100 });

    setUpdateState({ state: 'extracting', progress: 100, message: '正在解压更新包' });
    const stageDir = path.join(UPDATE_DIR, 'stage');
    fs.rmSync(stageDir, { recursive: true, force: true });

    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
    const isExe = buffer[0] === 0x4d && buffer[1] === 0x5a;
    if (isZip) {
      await extractZip(zipPath, stageDir);
    } else if (isExe) {
      await extractInstaller(zipPath, stageDir);
    } else {
      throw new Error('更新包格式无法识别');
    }

    if (
      !fs.existsSync(path.join(stageDir, 'index.html')) ||
      !fs.existsSync(path.join(stageDir, 'server.mjs'))
    ) {
      throw new Error('更新包内容不完整');
    }

    setUpdateState({ state: 'applying', progress: 100, message: '正在替换文件并重启' });
    spawnUpdater(stageDir, version);
  } catch (error) {
    setUpdateState({
      state: 'error',
      progress: 0,
      message: error.message,
      error: error.message,
      finishedAt: Date.now(),
    });
    console.error('[update]', error.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      console.error('[api]', error);
      if (!res.headersSent) json(res, 500, { message: '服务器内部错误' });
    }
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`同舟 · 实时校园数据 已启动：http://${HOST}:${PORT}`);
  console.log('打开页面后，在「数据源」中登录并粘贴 Cookie / Token。');
});
