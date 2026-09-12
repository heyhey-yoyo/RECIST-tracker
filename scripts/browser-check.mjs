import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import assert from 'node:assert/strict';
import { saveBlankStatuses, assertRestoredAndQuotaRollback, injectLegacyEmptyStatuses, assertLegacyRecovery } from './browser-scenarios.mjs';

// 使用 Chromium 自带的调试管道；保持项目零 npm 依赖。
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const candidates = [process.env.BROWSER_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ...(process.env.PATH || '').split(delimiter).flatMap(dir => ['chromium', 'chromium-browser', 'google-chrome'].map(name => join(dir, name))),
].filter(Boolean);
const executable = candidates.find(path => existsSync(path));
assert.ok(executable, '需要本机 Chrome/Chromium/Edge；或设置 BROWSER_EXECUTABLE 指向浏览器可执行文件。');
const profile = await mkdtemp(join(tmpdir(), 'recist-browser-check-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': `${mime[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(executable, ['--headless', '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let sequence = 0;
let buffered = '';
const decoder = new StringDecoder('utf8');
let pageLoadCount = 0;
const pending = new Map();
const failures = [];
const dialogs = [];
const rejectPending = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
browser.on('error', rejectPending);
browser.on('exit', () => rejectPending(new Error('测试浏览器提前退出')));
browser.stdio[4].on('data', chunk => {
  buffered += decoder.write(chunk);
  let end;
  while ((end = buffered.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffered.slice(0, end));
    buffered = buffered.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
    if (message.method === 'Page.loadEventFired') pageLoadCount += 1;
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params.message);
      send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(error => failures.push(error.message));
    }
    const item = pending.get(message.id);
    if (!item) continue;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`浏览器命令超时：${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const navigate = async () => {
    const previousLoads = pageLoadCount;
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/#/patients` }, sessionId);
    for (let i = 0; i < 100; i += 1) {
      if (pageLoadCount > previousLoads && await evaluate('document.readyState === "complete" && !!document.querySelector("[data-action]")')) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('页面未完成初始化');
  };
  const reload = async () => {
    const previousLoads = pageLoadCount;
    await send('Page.reload', { ignoreCache: true }, sessionId);
    for (let i = 0; i < 100; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (pageLoadCount > previousLoads && await evaluate('document.readyState === "complete" && document.querySelectorAll("[data-action=edit-visit]").length === 3')) return;
    }
    throw new Error('刷新后未恢复随访界面');
  };
  await navigate();
  assert.deepEqual(await evaluate(`(${saveBlankStatuses})()`), { patients: 1, visits: 3, newLesions: 1 });
  await reload();
  assert.equal((await evaluate(`(${assertRestoredAndQuotaRollback})()`)).memoryRolledBack, true);
  assert.ok(dialogs.some(message => message.includes('改动未保存')), '应向用户明确提示存储失败');
  await evaluate(`(${injectLegacyEmptyStatuses})()`);
  await reload();
  assert.equal((await evaluate(`(${assertLegacyRecovery})()`)).normalizedAfterSave, true);
  assert.deepEqual(failures, []);
  console.log('浏览器回归通过：空状态保存重载、病灶与随访保留、存储失败回滚、旧空字符串恢复。');
} finally {
  browser.kill();
  await new Promise(resolve => { if (browser.exitCode !== null || browser.signalCode !== null) resolve(); else browser.once('exit', resolve); });
  await new Promise(resolve => server.close(resolve));
  assert.ok(resolve(profile).startsWith(join(resolve(tmpdir()), 'recist-browser-check-')), '仅清理本次创建的临时浏览器目录');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
