/* ============================================================
 * 同舟 · 更新替换脚本
 * ------------------------------------------------------------
 * 由 server.mjs 以分离进程启动：
 *   node desktop/apply-update.mjs <appDir> <stageDir> <version>
 *
 * 1. 等旧服务退出
 * 2. 用暂存目录里的文件覆盖应用目录（跳过 .data / node_modules 等）
 * 3. 缺依赖时补装
 * 4. 重新启动托盘
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const [appDir, stageDir, version] = process.argv.slice(2);

const PROTECTED = new Set([
  '.data',
  'node_modules',
  'releases',
  'web',
  'installer',
  '.git',
  '.probe-map',
]);

const LOG = path.join(appDir, '.data', 'update', 'apply.log');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (error) {
    /* ignore */
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function serverDown() {
  try {
    const response = await fetch('http://127.0.0.1:4173/api/health', {
      signal: AbortSignal.timeout(800),
    });
    return !response.ok;
  } catch (error) {
    return true;
  }
}

function copyEntry(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
}

async function copyWithRetry(src, dst, name) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      copyEntry(src, dst);
      return true;
    } catch (error) {
      log(`copy ${name} failed (${attempt + 1}): ${error.code || error.message}`);
      await wait(400 * (attempt + 1));
    }
  }
  return false;
}

async function ensureDependencies() {
  if (fs.existsSync(path.join(appDir, 'node_modules', 'playwright-core'))) return;
  log('installing dependencies');
  await new Promise((resolve) => {
    const child = spawn('npm.cmd', ['install'], {
      cwd: appDir,
      stdio: 'ignore',
      windowsHide: true,
      shell: true,
    });
    child.on('error', resolve);
    child.on('exit', resolve);
  });
}

function restart() {
  const vbs = path.join(appDir, '启动同舟.vbs');
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');

  if (fs.existsSync(vbs)) {
    const child = spawn(wscript, [vbs], {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return 'tray';
  }

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: appDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return 'server';
}

async function main() {
  log(`update start -> ${version || 'unknown'}`);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverDown()) break;
    await wait(250);
  }
  await wait(500);

  const entries = fs.readdirSync(stageDir);
  let copied = 0;
  let failed = [];

  for (const entry of entries) {
    if (PROTECTED.has(entry)) continue;
    const src = path.join(stageDir, entry);
    const dst = path.join(appDir, entry);
    if (await copyWithRetry(src, dst, entry)) copied += 1;
    else failed.push(entry);
  }

  log(`copied ${copied}/${entries.length}${failed.length ? ` failed: ${failed.join(',')}` : ''}`);

  await ensureDependencies();

  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.rmSync(path.join(appDir, '.data', 'update', 'payload.bin'), { force: true });
    fs.rmSync(path.join(appDir, '.data', 'update', 'payload.zip'), { force: true });
  } catch (error) {
    /* ignore */
  }

  if (process.env.TONGJI_UPDATE_NO_RESTART === '1') {
    log('skip restart (TONGJI_UPDATE_NO_RESTART=1)');
    return;
  }

  const mode = restart();
  log(`restarted via ${mode}`);
}
main().catch((error) => {
  log(`update failed: ${error.stack || error.message}`);
});
