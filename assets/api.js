/* ============================================================
 * 同舟 · 实时 API 层
 * ------------------------------------------------------------
 * 只连接本地 Node 服务，不再回退演示数据。
 * 所有校园请求由后端携带用户提供的 Cookie / Token 完成。
 * ============================================================ */
(function (global) {
  'use strict';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error((payload && payload.message) || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = payload && payload.code;
      error.source = payload && payload.source;
      error.loginUrl = payload && payload.loginUrl;
      throw error;
    }
    return payload;
  }

  async function init() {
    const health = await request('/api/health');
    if (!health || !health.ok) throw new Error('后端服务未启动');
    return 'live';
  }

  const getSources = () => request('/api/sources');

  const startLogin = (source) =>
    request(`/api/auth/${encodeURIComponent(source)}/start`, { method: 'POST' });

  const getLoginStatus = (source, id) =>
    request(
      `/api/auth/${encodeURIComponent(source)}/status/${encodeURIComponent(id)}`
    );

  const loginAccount = (source) =>
    request(`/api/accounts/${encodeURIComponent(source)}/login`, { method: 'POST' });

  const loginAllAccounts = () =>
    request('/api/accounts/login-all', { method: 'POST' });

  const startTongjiLogin = () => startLogin('tongji');

  const getTongjiLoginStatus = (id) => getLoginStatus('tongji', id);

  const saveCredentials = (id, payload) =>
    request(`/api/sources/${encodeURIComponent(id)}/credentials`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  const disconnectSource = (id) =>
    request(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });

  const getCalendar = () => request('/api/calendar');
  const getTimetable = () => request('/api/timetable');
  const getNotices = () => request('/api/notices');
  const getAssignments = () => request('/api/assignments');
  const syncAssignments = () => request('/api/assignments/sync', { method: 'POST' });
  const getSyncStatus = () => request('/api/sync/status');

  const markNoticeRead = (id) =>
    request(`/api/notices/${encodeURIComponent(id)}/read`, { method: 'POST' });

  const markAllNoticesRead = () => request('/api/notices/read-all', { method: 'POST' });

  const setAssignmentDone = (id, done) =>
    request(`/api/assignments/${encodeURIComponent(id)}/done`, {
      method: 'POST',
      body: JSON.stringify({ done: Boolean(done) }),
    });

  global.TongjiApi = {
    init,
    getSources,
    loginAccount,
    loginAllAccounts,
    startLogin,
    getLoginStatus,
    startTongjiLogin,
    getTongjiLoginStatus,
    saveCredentials,
    disconnectSource,
    getCalendar,
    getTimetable,
    getNotices,
    getAssignments,
    syncAssignments,
    getSyncStatus,
    markNoticeRead,
    markAllNoticesRead,
    setAssignmentDone,
  };
})(window);
