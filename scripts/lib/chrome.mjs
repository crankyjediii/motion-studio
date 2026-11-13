import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UserError, fail, which } from './util.mjs';

/** Locate an installed Chromium-family browser. CHROME_PATH overrides. */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [];
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser']) {
      candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
      candidates.push(join(process.env.HOME || '', `Applications/${app}.app/Contents/MacOS/${app}`));
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) {
      candidates.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      candidates.push(join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else {
    for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const p = which(c);
      if (p) candidates.push(p);
    }
  }
  return candidates.find((p) => existsSync(p)) || null;
}

/** Headless browser driven over the DevTools protocol with Node's built-in WebSocket (no npm deps). */
export async function openBrowser() {
  const exe = findChrome();
  if (!exe) fail('No Chrome, Edge or Chromium found. Run the setup check, or set CHROME_PATH.');
  if (typeof WebSocket === 'undefined') fail('Node 22 or newer is required (built-in WebSocket).');
  const profile = await mkdtemp(join(tmpdir(), 'motion-studio-chrome-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--force-color-profile=srgb', '--enable-unsafe-swiftshader',
    '--disable-extensions', '--disable-breakpad', '--disable-crash-reporter', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise((ok) => {
        const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 3000);
        proc.once('exit', () => { clearTimeout(timer); ok(); });
        proc.kill();
      });
    }
    proc.stderr.destroy();
    proc.unref();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  };
  let wsUrl;
  try { wsUrl = await new Promise((ok, no) => {
    let err = '';
    const finish = (error, value) => { clearTimeout(timer); error ? no(error) : ok(value); };
    const timer = setTimeout(() => finish(new UserError('Chrome did not start within 20s.\n' + err.slice(-800))), 20000);
    proc.stderr.on('data', (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) finish(null, m[1]);
    });
    proc.once('error', (e) => finish(new UserError(`Could not launch Chrome: ${e.message}`)));
    proc.once('exit', (code) => finish(new UserError(`Chrome exited (${code}) before starting.\n` + err.slice(-800))));
  }); } catch (e) { await stop(); throw e; }

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((ok, no) => {
      const timer = setTimeout(() => no(new UserError('Chrome DevTools connection timed out.')), 10000);
      ws.onopen = () => { clearTimeout(timer); ok(); };
      ws.onerror = () => { clearTimeout(timer); no(new UserError('Could not connect to Chrome DevTools.')); };
    });
  } catch (e) { ws.close(); await stop(); throw e; }
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map(); // sessionId -> fn(method, params)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      if (msg.error) p.no(new Error(`${p.method}: ${msg.error.message}`));
      else p.ok(msg.result);
    } else if (msg.sessionId) listeners.get(msg.sessionId)?.(msg.method, msg.params);
  };
  const disconnected = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.no(new UserError(`Chrome disconnected during ${p.method}.`));
    }
    pending.clear();
  };
  ws.onclose = disconnected;
  ws.onerror = disconnected;
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    if (ws.readyState !== WebSocket.OPEN) return no(new UserError('Chrome DevTools is disconnected.'));
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); no(new UserError(`Chrome timed out during ${method}.`)); }, 30000);
    pending.set(id, { ok, no, method, timer });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function newPage({ width, height, scale = 1, transparent = false, mobile = false }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const problems = [];
    let onLoad = null;
    listeners.set(sessionId, (method, p) => {
      if (method === 'Page.loadEventFired') onLoad?.();
      else if (method === 'Runtime.exceptionThrown') problems.push('Uncaught: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
      else if (method === 'Runtime.consoleAPICalled' && p.type === 'error') problems.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
      else if (method === 'Network.responseReceived' && p.response.status >= 400) problems.push(`HTTP ${p.response.status}: ${p.response.url}`);
      else if (method === 'Network.loadingFailed' && !p.canceled) problems.push(`Load failed (${p.errorText})`);
    });
    await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Network.enable')]);
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    if (transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    return {
      problems,
      send: s,
      async goto(url) {
        let timer;
        const loaded = new Promise((ok, no) => {
          onLoad = ok;
          timer = setTimeout(() => no(new UserError(`Page did not load within 30s: ${url}`)), 30000);
        });
        try {
          const nav = await s('Page.navigate', { url });
          if (nav.errorText) fail(`Could not open ${url}: ${nav.errorText}`);
          await loaded;
        } finally { clearTimeout(timer); onLoad = null; }
      },
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async screenshot({ format = 'png', quality, clip } = {}) {
        const r = await s('Page.captureScreenshot', { format, quality, clip, captureBeyondViewport: !!clip, optimizeForSpeed: format === 'jpeg' });
        return Buffer.from(r.data, 'base64');
      },
      close: async () => { listeners.delete(sessionId); await send('Target.closeTarget', { targetId }).catch(() => {}); },
    };
  }

  return {
    newPage,
    async close() {
      await send('Browser.close').catch(() => {});
      try { ws.close(); } catch {}
      disconnected();
      await stop();
    },
  };
}
