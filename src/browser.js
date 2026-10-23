// Finding, installing and launching Chrome, plus a Page that renders frames.
import { existsSync, mkdirSync, readdirSync, statSync, chmodSync, createWriteStream, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform, arch, tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { launchChrome } from './cdp.js';

export const CACHE_DIR = process.env.MOTIONWRIGHT_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'motionwright');
const CFT_JSON = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

function cftPlatform() {
  const p = platform(), a = arch();
  if (p === 'linux') return 'linux64';
  if (p === 'darwin') return a === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (p === 'win32') return a === 'ia32' ? 'win32' : 'win64';
  return null;
}
function shellBinaryName() { return platform() === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'; }

function findInDir(dir, name, depth = 4) {
  if (depth < 0 || !existsSync(dir)) return null;
  let entries;
  try { entries = readdirSync(dir); } catch { return null; }
  for (const e of entries) {
    const p = join(dir, e);
    if (e === name) { try { if (statSync(p).isFile()) return p; } catch {} }
  }
  for (const e of entries.sort().reverse()) {
    const p = join(dir, e);
    try { if (statSync(p).isDirectory()) { const r = findInDir(p, name, depth - 1); if (r) return r; } } catch {}
  }
  return null;
}

/** Returns { path, kind: 'shell' | 'chrome' } or null. */
export function findChrome(explicit) {
  const env = explicit || process.env.MOTIONWRIGHT_CHROME || process.env.CHROME_PATH;
  if (env) return { path: env, kind: /headless[-_]shell/i.test(env) || process.env.MOTIONWRIGHT_CHROME_KIND === 'shell' ? 'shell' : (process.env.MOTIONWRIGHT_CHROME_KIND || 'chrome') };
  const own = findInDir(join(CACHE_DIR, 'chrome-headless-shell'), shellBinaryName());
  if (own) return { path: own, kind: 'shell' };
  const pup = findInDir(join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell'), shellBinaryName(), 5);
  if (pup) return { path: pup, kind: 'shell' };
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'],
    linux: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    win32: [join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'), join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'), join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')],
  }[platform()] || [];
  for (const c of candidates) if (c && existsSync(c)) return { path: c, kind: 'chrome' };
  return null;
}

/** Download chrome-headless-shell (Chrome for Testing, stable) into the cache. */
export async function installChrome({ log = console.error } = {}) {
  const plat = cftPlatform();
  if (!plat) throw new Error(`No Chrome build for ${platform()}/${arch()}. Set MOTIONWRIGHT_CHROME to a Chrome or Chromium binary.`);
  log(`Downloading chrome-headless-shell for ${plat}…`);
  const res = await fetch(CFT_JSON);
  if (!res.ok) throw new Error(`Could not reach ${CFT_JSON} (${res.status}).`);
  const json = await res.json();
  const stable = json.channels.Stable;
  const dl = (stable.downloads['chrome-headless-shell'] || []).find((d) => d.platform === plat);
  if (!dl) throw new Error(`No chrome-headless-shell download for ${plat}.`);
  const dir = join(CACHE_DIR, 'chrome-headless-shell', `${plat}-${stable.version}`);
  mkdirSync(dir, { recursive: true });
  const zip = join(tmpdir(), `mw-chrome-${process.pid}.zip`);
  const r = await fetch(dl.url);
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${dl.url}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
  log(`Extracting Chrome ${stable.version}…`);
  if (platform() === 'win32') execFileSync('tar', ['-xf', zip, '-C', dir]);
  else execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  rmSync(zip, { force: true });
  const bin = findInDir(dir, shellBinaryName());
  if (!bin) throw new Error('Extracted Chrome but could not find the binary.');
  if (platform() !== 'win32') chmodSync(bin, 0o755);
  log(`Chrome ready: ${bin}`);
  return { path: bin, kind: 'shell', version: stable.version };
}

export async function ensureChrome(opts = {}) {
  const found = findChrome(opts.chrome);
  if (found) return found;
  if (opts.install === false) throw new Error('Chrome not found. Run `npx motionwright install` or set MOTIONWRIGHT_CHROME.');
  return installChrome(opts);
}

function hasGPU() {
  if (platform() !== 'linux') return true;
  return existsSync('/dev/dri') && !process.env.MOTIONWRIGHT_NO_GPU;
}

export function chromeArgs({ kind, beginFrame, gl = 'auto' }) {
  const args = [
    kind === 'shell' ? '--headless=old' : '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-extensions-with-background-pages',
    '--disable-background-networking', '--disable-sync', '--disable-translate', '--disable-default-apps', '--disable-breakpad',
    '--disable-client-side-phishing-detection', '--disable-component-update', '--disable-domain-reliability', '--disable-hang-monitor',
    '--disable-ipc-flooding-protection', '--disable-popup-blocking', '--disable-prompt-on-repost', '--metrics-recording-only',
    '--mute-audio', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text',
    '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--password-store=basic', '--use-mock-keychain',
    '--disable-features=Translate,MediaRouter,OptimizationHints,PaintHolding,BackForwardCache,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions',
    '--enable-features=SharedArrayBuffer',
  ];
  if (platform() === 'linux' && (process.getuid && process.getuid() === 0 || process.env.MOTIONWRIGHT_NO_SANDBOX)) args.push('--no-sandbox');
  const mode = gl === 'auto' ? (hasGPU() ? 'gpu' : 'swiftshader') : gl;
  if (mode === 'swiftshader') args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  else if (mode === 'none') args.push('--disable-gpu');
  else args.push('--ignore-gpu-blocklist', '--enable-gpu-rasterization');
  if (beginFrame) {
    args.push('--deterministic-mode', '--enable-begin-frame-control', '--disable-threaded-animation', '--disable-threaded-scrolling',
      '--disable-checker-imaging', '--disable-new-content-rendering-timeout', '--run-all-compositor-stages-before-draw', '--disable-image-animation-resync');
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A browser + one page, driving the motionwright runtime.
 */
export class FramePage {
  constructor(opts) {
    this.opts = opts; // { chrome:{path,kind}, width, height, scale, capture:'auto'|'beginframe'|'screenshot', gl, transparent, timeoutMs }
    this.errors = [];
    this.ticks = 1000;
    this.interval = 1000 / 30;
  }
  async start() {
    const { chrome } = this.opts;
    let want = this.opts.capture || 'auto';
    if (want === 'auto') want = chrome.kind === 'shell' && platform() !== 'darwin' ? 'beginframe' : 'screenshot';
    try {
      await this._launch(want);
    } catch (e) {
      if (want !== 'beginframe' || this.opts.capture === 'beginframe') throw e;
      await this.close();
      await this._launch('screenshot');
    }
  }
  async _launch(mode) {
    const { chrome, width, height } = this.opts;
    this.mode = mode;
    this.browser = launchChrome(chrome.path, [...chromeArgs({ kind: chrome.kind, beginFrame: mode === 'beginframe', gl: this.opts.gl }), `--window-size=${width},${height}`, 'about:blank']);
    const b = this.browser;
    const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', width, height, ...(mode === 'beginframe' ? { enableBeginFrameControl: true } : {}) });
    const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    const s = (m, p) => b.send(m, p, sessionId);
    this.s = s;
    b.on('Runtime.exceptionThrown', (p) => this._err('script-error', (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text), sessionId);
    b.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning' || (this.opts.verbose && p.type === 'log')) {
        const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
        if (this.opts.onConsole) this.opts.onConsole(p.type, text);
        if (p.type === 'error') this._err('console-error', text);
      }
    }, sessionId);
    b.on('Network.responseReceived', (p) => { if (p.response.status >= 400 && !/favicon\.ico/.test(p.response.url)) this._err('http-' + p.response.status, `${p.response.status} for ${p.response.url}`); }, sessionId);
    b.on('Network.loadingFailed', (p) => { if (!p.canceled) this._err('load-failed', `${p.errorText} for request ${p.requestId}${p.type ? ' (' + p.type + ')' : ''}`); }, sessionId);
    await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Network.enable')]);
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: this.opts.scale || 1, mobile: false });
    if (this.opts.transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    if (mode === 'beginframe') {
      // Prime the compositor; fails fast on platforms without BeginFrameControl.
      await Promise.race([this._beginFrame(false), sleep(4000).then(() => { throw new Error('beginFrame did not respond'); })]);
    }
  }
  _err(code, message) {
    if (this.errors.length < 200) this.errors.push({ code, message: String(message).slice(0, 500) });
  }
  async _beginFrame(screenshot, format = 'jpeg', quality = 92) {
    this.ticks += this.interval;
    const params = { frameTimeTicks: this.ticks, interval: this.interval };
    if (screenshot) params.screenshot = { format, ...(format === 'jpeg' ? { quality } : {}) };
    else params.noDisplayUpdates = true;
    return this.s('HeadlessExperimental.beginFrame', params);
  }
  /** Evaluate and await a promise; keeps the compositor ticking in beginFrame mode so loads can finish. */
  async evaluate(expression, { timeoutMs = this.opts.timeoutMs || 60000 } = {}) {
    const p = this.s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    let done = false, result, error;
    p.then((r) => { done = true; result = r; }, (e) => { done = true; error = e; });
    const t0 = Date.now();
    // fast path
    await new Promise((r) => setImmediate(r));
    while (!done) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms evaluating: ${expression.slice(0, 80)}`);
      if (this.mode === 'beginframe') { try { await this._beginFrame(false); } catch {} await sleep(2); }
      else await sleep(5);
    }
    if (error) throw error;
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text);
    }
    return result.result.value;
  }
  async open(url, config) {
    const s = this.s;
    this.interval = 1000 / (config.fps || 30);
    await s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__MW_CONFIG = ${JSON.stringify(config)};` });
    const loaded = this.browser.once('Page.loadEventFired', this.sessionId, this.opts.timeoutMs || 60000);
    const nav = await s('Page.navigate', { url });
    if (nav.errorText) throw new Error(`Could not open ${url}: ${nav.errorText}`);
    if (this.mode === 'beginframe') {
      let done = false;
      loaded.then(() => (done = true), () => (done = true));
      const t0 = Date.now();
      while (!done) {
        await this._beginFrame(false);
        await sleep(2);
        if (Date.now() - t0 > (this.opts.timeoutMs || 60000)) throw new Error('Timed out loading page');
      }
    } else await loaded;
    const hasRuntime = await this.evaluate('!!(window.mw && window.mw.__runtime)');
    if (!hasRuntime) throw new Error('The motionwright runtime did not load in the page.');
    return this.evaluate('mw.ready()');
  }
  async setViewport(width, height) {
    await this.s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: this.opts.scale || 1, mobile: false });
  }
  /** Seek to time t (seconds). Returns {dirty, needsReload}. */
  async seek(t) {
    return this.evaluate(`mw.seek(${t})`);
  }
  /** Capture the current frame. format: 'jpeg' | 'png' */
  async capture(format = 'jpeg', quality = 92) {
    if (this.mode === 'beginframe') {
      for (let i = 0; i < 3; i++) {
        const r = await this._beginFrame(true, format, quality);
        if (r.screenshotData) return Buffer.from(r.screenshotData, 'base64');
      }
      throw new Error('Chrome returned no frame.');
    }
    const r = await this.s('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false });
    return Buffer.from(r.data, 'base64');
  }
  async close() {
    if (this.browser) { const b = this.browser; this.browser = null; await b.close(); }
  }
}

export function chromeVersion(path) {
  try {
    const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 10000 });
    return (r.stdout || r.stderr || '').trim();
  } catch { return null; }
}
