/* motionwright runtime — injected into every composition page.
 * Turns a normal HTML page into a seekable, deterministic video timeline.
 * Exposes window.mw. MIT License.
 */
(function () {
  'use strict';
  if (window.mw && window.mw.__runtime) return;

  const CONFIG = Object.assign({ mode: 'preview', seed: 1, data: null }, window.__MW_CONFIG || {});
  const MODE = CONFIG.mode; // 'render' | 'preview' | 'check'

  // ---------------------------------------------------------------------------
  // Keep real browser APIs before we replace them.
  // ---------------------------------------------------------------------------
  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    raf: window.requestAnimationFrame.bind(window),
    caf: window.cancelAnimationFrame.bind(window),
    perfNow: performance.now.bind(performance),
    Date: window.Date,
    random: Math.random,
    animate: Element.prototype.animate,
  };

  // ---------------------------------------------------------------------------
  // Virtual clock. All time in this page is driven by mw.seek().
  // ---------------------------------------------------------------------------
  const EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);
  let now = 0; // seconds
  let usedRAF = false;
  let stateful = false; // true once code has run that depends on history (rAF, timers)
  let timerSeq = 0, timerIdCounter = 1;
  const timers = new Map();
  const rafs = new Map();
  let rafId = 0;

  performance.now = () => now * 1000;
  function VDate(...args) {
    if (!new.target) return new real.Date(EPOCH + now * 1000).toString();
    return args.length ? new real.Date(...args) : new real.Date(EPOCH + now * 1000);
  }
  VDate.prototype = real.Date.prototype;
  VDate.now = () => EPOCH + now * 1000;
  VDate.parse = real.Date.parse;
  VDate.UTC = real.Date.UTC;
  window.Date = VDate;

  function addTimer(fn, ms, args, interval) {
    if (typeof fn === 'string') { const code = fn; fn = () => (0, eval)(code); }
    if (typeof fn !== 'function') return 0;
    const id = timerIdCounter++;
    const delay = Math.max(0, Number(ms) || 0) / 1000;
    timers.set(id, { due: now + delay, delay, fn, args, interval: interval ? Math.max(delay, 0.001) : 0, seq: timerSeq++ });
    return id;
  }
  window.setTimeout = (fn, ms, ...args) => addTimer(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => addTimer(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (fn) => { usedRAF = true; rafs.set(++rafId, fn); return rafId; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };

  // Deterministic Math.random (mulberry32)
  function makeRandom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  Math.random = makeRandom(CONFIG.seed);
  function hashSeed(x) {
    if (typeof x === 'number' && Number.isFinite(x)) x = String(x);
    let h = 2166136261 >>> 0;
    for (const ch of String(x)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h || 1;
  }

  function runTimersUntil(T) {
    let guard = 0;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) {
        if (t.due <= T + 1e-9 && (!next || t.due < next.t.due || (t.due === next.t.due && t.seq < next.t.seq))) next = { id, t };
      }
      if (!next) break;
      if (++guard > 100000) { report('error', 'timer-loop', 'Timers keep scheduling themselves without advancing time.', null, 'Avoid setTimeout/setInterval loops with 0 delay.'); break; }
      stateful = true;
      const { id, t } = next;
      now = Math.max(now, t.due);
      if (t.interval) { t.due += t.interval; t.seq = timerSeq++; } else timers.delete(id);
      try { t.fn(...(t.args || [])); } catch (e) { pageError(e); }
      flushAnimations(now, 'event');
    }
  }
  // While the page is still loading (waiting on mw.wait promises), libraries often poll with short
  // timers (fonts, Lottie, model loaders). The video clock is paused then, so run those short timers
  // for real. Long timers (likely meant as video events) still wait for their video time.
  function loadPump() {
    let ran = 0;
    const due = [...timers.entries()].filter(([, t]) => t.delay <= 0.25).sort((a, b) => a[1].due - b[1].due || a[1].seq - b[1].seq);
    for (const [id, t] of due) {
      if (!timers.has(id)) continue;
      if (t.interval) { t.due += t.interval; t.seq = timerSeq++; } else timers.delete(id);
      try { t.fn(...(t.args || [])); } catch (e) { pageError(e); }
      if (++ran > 200) break;
    }
    if (rafs.size) { const list = [...rafs.values()]; rafs.clear(); for (const fn of list) { try { fn(now * 1000); } catch (e) { pageError(e); } } }
  }
  function runRAF(T) {
    if (!rafs.size) return;
    stateful = true;
    const list = [...rafs.values()];
    rafs.clear();
    for (const fn of list) { try { fn(T * 1000); } catch (e) { pageError(e); } }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics collected for `motionwright check`
  // ---------------------------------------------------------------------------
  const issues = [];
  const issueKeys = new Set();
  function report(severity, code, message, el, fix, time) {
    const sel = el ? selectorOf(el) : null;
    const key = code + '|' + sel + '|' + message;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({ severity, code, message, selector: sel, fix: fix || null, time: time == null ? null : round(time) });
  }
  function pageError(e) { report('error', 'script-error', String(e && e.stack || e).split('\n').slice(0, 3).join(' | '), null, null, now); setTimeoutReal(() => { throw e; }); }
  const setTimeoutReal = real.setTimeout;
  function round(x) { return Math.round(x * 1000) / 1000; }
  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 4) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      const cls = [...cur.classList].filter((c) => !c.startsWith('mw-')).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(s);
      cur = parent;
      if (cur === document.body || cur === document.documentElement) break;
    }
    return parts.join(' > ');
  }

  // ---------------------------------------------------------------------------
  // Time parsing: "1.5", "1.5s", "500ms", "45f", "1:02.5"
  // ---------------------------------------------------------------------------
  let FPS = 30;
  function parseTime(v, el, attr) {
    if (v == null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    let m;
    if ((m = /^(-?[\d.]+)\s*ms$/.exec(s))) return parseFloat(m[1]) / 1000;
    if ((m = /^(-?[\d.]+)\s*s?$/.exec(s))) return parseFloat(m[1]);
    if ((m = /^(-?[\d.]+)\s*f$/.exec(s))) return parseFloat(m[1]) / FPS;
    if ((m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s))) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
    report('error', 'bad-time', `Cannot read time "${v}" in ${attr}.`, el, 'Use seconds like "1.5", "1.5s", "500ms", or frames like "45f".');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Easing
  // ---------------------------------------------------------------------------
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6) break; if (Math.abs(d) < 1e-6) break; t -= e / d; }
      let lo = 0, hi = 1;
      if (Math.abs(sx(t) - x) > 1e-5) { t = x; for (let i = 0; i < 30; i++) { const v = sx(t); if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
      return sy(t);
    };
  }
  function springFn(opts = {}) {
    const k = opts.stiffness ?? 170, c = opts.damping ?? 26, m = opts.mass ?? 1, v0 = opts.velocity ?? 0;
    const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m));
    return (t) => {
      if (t <= 0) return 0;
      if (z < 1) {
        const wd = w0 * Math.sqrt(1 - z * z);
        return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 - v0) / wd) * Math.sin(wd * t));
      }
      return 1 - Math.exp(-w0 * t) * (1 + (w0 - v0) * t);
    };
  }
  const BEZ = {
    'linear': [0, 0, 1, 1], 'ease': [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
    'in-sine': [0.12, 0, 0.39, 0], 'out-sine': [0.61, 1, 0.88, 1], 'in-out-sine': [0.37, 0, 0.63, 1],
    'in-quad': [0.11, 0, 0.5, 0], 'out-quad': [0.5, 1, 0.89, 1], 'in-out-quad': [0.45, 0, 0.55, 1],
    'in-cubic': [0.32, 0, 0.67, 0], 'out-cubic': [0.33, 1, 0.68, 1], 'in-out-cubic': [0.65, 0, 0.35, 1],
    'in-quart': [0.5, 0, 0.75, 0], 'out-quart': [0.25, 1, 0.5, 1], 'in-out-quart': [0.76, 0, 0.24, 1],
    'in-quint': [0.64, 0, 0.78, 0], 'out-quint': [0.22, 1, 0.36, 1], 'in-out-quint': [0.83, 0, 0.17, 1],
    'in-expo': [0.7, 0, 0.84, 0], 'out-expo': [0.16, 1, 0.3, 1], 'in-out-expo': [0.87, 0, 0.13, 1],
    'in-circ': [0.55, 0, 1, 0.45], 'out-circ': [0, 0.55, 0.45, 1], 'in-out-circ': [0.85, 0, 0.15, 1],
    'in-back': [0.36, 0, 0.66, -0.56], 'out-back': [0.34, 1.56, 0.64, 1], 'in-out-back': [0.68, -0.6, 0.32, 1.6],
  };
  const SPRINGS = { spring: { stiffness: 170, damping: 26, T: 0.71 }, bouncy: { stiffness: 180, damping: 12, T: 1.14 }, snappy: { stiffness: 400, damping: 30, T: 0.4 }, gentle: { stiffness: 120, damping: 20, T: 0.58 } };
  // Curves that are not cubic-beziers. Each takes x in [0,1].
  function bounceOut(x) {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  }
  function elasticOut(amp = 1, period = 0.3) {
    const a = Math.max(1, amp), s = (period / (2 * Math.PI)) * Math.asin(1 / a);
    return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : a * Math.pow(2, -10 * x) * Math.sin(((x - s) * (2 * Math.PI)) / period) + 1);
  }
  function backOut(o = 1.7) { return (x) => 1 + (o + 1) * Math.pow(x - 1, 3) + o * Math.pow(x - 1, 2); }
  const inv = (f) => (x) => 1 - f(1 - x);
  const inOut = (fOut) => (x) => (x < 0.5 ? (1 - fOut(1 - 2 * x)) / 2 : (1 + fOut(2 * x - 1)) / 2);
  const FUNCS = {
    'out-bounce': () => bounceOut, 'in-bounce': () => inv(bounceOut), 'in-out-bounce': () => inOut(bounceOut),
    'out-elastic': (p) => elasticOut(p[0], p[1]), 'in-elastic': (p) => inv(elasticOut(p[0], p[1])), 'in-out-elastic': (p) => inOut(elasticOut(p[0], p[1] ?? 0.45)),
    'out-back': (p) => backOut(p[0]), 'in-back': (p) => inv(backOut(p[0])), 'in-out-back': (p) => inOut(backOut(p[0] ?? 2.5)),
  };
  // GSAP-style names ("power2.out", "back.out(1.7)", "sine.inOut", "none") are accepted because models write them by habit.
  const GS_KIND = { power0: 'linear', none: 'linear', linear: 'linear', power1: 'quad', quad: 'quad', power2: 'cubic', cubic: 'cubic', power3: 'quart', quart: 'quart', power4: 'quint', quint: 'quint', strong: 'quint', sine: 'sine', expo: 'expo', circ: 'circ', back: 'back', elastic: 'elastic', bounce: 'bounce' };
  function normEase(name) {
    let s = String(name || 'linear').trim();
    let params = [];
    const pm = /^([\w.-]+)\(([^)]*)\)$/.exec(s);
    if (pm && !/^(cubic-bezier|linear|steps)$/.test(pm[1])) { s = pm[1]; params = pm[2].split(',').map((x) => parseFloat(x)).filter((x) => isFinite(x)); }
    if (BEZ[s] || SPRINGS[s]) return { key: s, params };
    const g = /^([a-z]+\d?)(?:\.(in|out|inOut|in-out))?$/i.exec(s);
    if (g && GS_KIND[g[1].toLowerCase()] && (g[2] || /^(power\d|none|strong|bounce|elastic)$/i.test(g[1]))) {
      const kind = GS_KIND[g[1].toLowerCase()];
      if (kind === 'linear') return { key: 'linear', params };
      const dir = !g[2] ? 'out' : /^in-?out$/i.test(g[2]) ? 'in-out' : g[2].toLowerCase();
      return { key: dir + '-' + kind, params };
    }
    s = s.replace(/^ease-(?=(in|out|spring|bouncy|snappy|gentle))/, '');
    s = s.replace(/^ease(In|Out|InOut)(\w+)$/, (_, d, k) => (d === 'InOut' ? 'in-out' : d.toLowerCase()) + '-' + k.toLowerCase()); // easeOutCubic
    s = s.replace(/^(in|out|inOut)([A-Z]\w*)$/, (_, d, k) => (d === 'inOut' ? 'in-out' : d) + '-' + k.toLowerCase()); // outCubic
    return { key: s, params };
  }
  const easeCache = new Map();
  function easing(name) {
    if (typeof name === 'function') return name;
    const ck = String(name);
    if (easeCache.has(ck)) return easeCache.get(ck);
    const { key, params } = normEase(name);
    let fn;
    let m;
    if (FUNCS[key] && (params.length || !BEZ[key])) fn = FUNCS[key](params);
    else if (BEZ[key]) fn = cubicBezier(...BEZ[key]);
    else if (SPRINGS[key]) { const s = SPRINGS[key], f = springFn(s); fn = (x) => (x >= 1 ? 1 : f(x * s.T)); }
    else if ((m = /^cubic-bezier\(([^)]+)\)$/.exec(key))) fn = cubicBezier(...m[1].split(',').map(Number));
    else if ((m = /^steps\((\d+)\)$/.exec(key))) { const n = +m[1]; fn = (x) => (x >= 1 ? 1 : Math.floor(x * n) / n); }
    else if ((m = /^linear\((.+)\)$/.exec(key))) { const pts = m[1].split(',').map((v) => parseFloat(v)); fn = (x) => { if (x <= 0) return pts[0]; if (x >= 1) return pts[pts.length - 1]; const f = x * (pts.length - 1), i = Math.floor(f); return pts[i] + (pts[i + 1] - pts[i]) * (f - i); }; }
    else fn = (x) => x;
    easeCache.set(ck, fn);
    return fn;
  }
  function cssEasing(name) {
    if (typeof name === 'function') return sampleLinear(name);
    const { key, params } = normEase(name || 'out-expo');
    if (BEZ[key] && !params.length) return 'cubic-bezier(' + BEZ[key].join(',') + ')';
    if (FUNCS[key] || SPRINGS[key] || /^steps\(/.test(key)) return sampleLinear(easing(name));
    if (/^(cubic-bezier|linear)\(/.test(key)) return key;
    return 'linear';
  }
  function sampleLinear(fn, n = 60) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(Math.round(fn(i / n) * 10000) / 10000);
    return 'linear(' + pts.join(', ') + ')';
  }
  function isEasingName(tok) {
    if (/^(cubic-bezier|linear|steps)\(/.test(tok)) return true;
    const { key } = normEase(tok);
    return !!(BEZ[key] || SPRINGS[key] || FUNCS[key]);
  }

  // ---------------------------------------------------------------------------
  // Composition settings
  // ---------------------------------------------------------------------------
  const root = document.documentElement;
  function rootAttr(name) {
    return root.getAttribute('data-' + name) ?? (document.body && document.body.getAttribute('data-' + name));
  }
  const comp = { width: 1920, height: 1080, fps: 30, duration: 0, background: null };

  // ---------------------------------------------------------------------------
  // Timeline: clips, sequences
  // ---------------------------------------------------------------------------
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'BR']);
  const TRANSITIONS = {
    'fade': { enter: 'fade' },
    'crossfade': { enter: 'fade' },
    'slide-left': { enter: 'slide-left', exit: 'slide-left', ease: 'in-out-cubic' },
    'slide-right': { enter: 'slide-right', exit: 'slide-right', ease: 'in-out-cubic' },
    'slide-up': { enter: 'slide-up', exit: 'slide-up', ease: 'in-out-cubic' },
    'slide-down': { enter: 'slide-down', exit: 'slide-down', ease: 'in-out-cubic' },
    'push-left': { enter: 'slide-left', exit: 'slide-left', ease: 'in-out-quart' },
    'push-right': { enter: 'slide-right', exit: 'slide-right', ease: 'in-out-quart' },
    'push-up': { enter: 'slide-up', exit: 'slide-up', ease: 'in-out-quart' },
    'push-down': { enter: 'slide-down', exit: 'slide-down', ease: 'in-out-quart' },
    'cover-left': { enter: 'slide-left', ease: 'in-out-quart' }, 'cover-right': { enter: 'slide-right', ease: 'in-out-quart' },
    'cover-up': { enter: 'slide-up', ease: 'in-out-quart' }, 'cover-down': { enter: 'slide-down', ease: 'in-out-quart' },
    'whip-left': { enter: 'whip-left', exit: 'whip-left', ease: 'in-out-expo' },
    'whip-right': { enter: 'whip-right', exit: 'whip-right', ease: 'in-out-expo' },
    'whip-up': { enter: 'whip-up', exit: 'whip-up', ease: 'in-out-expo' },
    'whip-down': { enter: 'whip-down', exit: 'whip-down', ease: 'in-out-expo' },
    'wipe-left': { enter: 'wipe-left', ease: 'in-out-cubic' }, 'wipe-right': { enter: 'wipe-right', ease: 'in-out-cubic' },
    'wipe-up': { enter: 'wipe-up', ease: 'in-out-cubic' }, 'wipe-down': { enter: 'wipe-down', ease: 'in-out-cubic' },
    'diagonal': { enter: 'diagonal', ease: 'in-out-cubic' },
    'clock': { enter: 'clock', ease: 'in-out-cubic' },
    'zoom': { enter: 'zoom', exit: 'fade' },
    'zoom-through': { enter: 'zoom-near', exit: 'zoom-past', ease: 'in-out-cubic' },
    'flip': { enter: 'flip-in', exit: 'flip-out', ease: 'in-out-cubic' },
    'dip': { enter: 'dip-in', exit: 'dip-out', ease: 'linear' },
    'blur': { enter: 'blur' },
    'iris': { enter: 'iris', ease: 'in-out-cubic' },
    'fade-up': { enter: 'fade-up', exit: 'fade-up' },
    'morph': { enter: 'fade', ease: 'in-out-cubic', morph: true },
  };
  let clips = []; // {el, start, end, parent}
  let morphPairs = []; // shared-element transitions: {from, to, dur, ease}
  let hasRemap = false;
  const clipOf = new WeakMap();
  let timelineDirty = true;

  function isClipEl(el) {
    if (SKIP_TAGS.has(el.tagName) || el === document.documentElement || el === document.body) return false;
    if (el.hasAttribute('data-start') || el.hasAttribute('data-duration') || el.hasAttribute('data-end')) return true;
    const p = el.parentElement;
    return !!(p && p.hasAttribute('data-sequence'));
  }
  function parseTransition(v) {
    if (!v) return null;
    const toks = v.trim().split(/\s+/);
    const name = toks[0];
    let dur = 0.6;
    for (const t of toks.slice(1)) { if (isEasingName(t)) continue; const n = parseTime(t, null, 'data-transition'); if (n != null) dur = n; }
    if (!TRANSITIONS[name]) { report('error', 'bad-transition', `Unknown transition "${name}".`, null, 'Use one of: ' + Object.keys(TRANSITIONS).join(', ')); return null; }
    return { name, dur, ease: toks.find(isEasingName) || null };
  }

  let transitionList = [];
  function buildTimeline() {
    morphPairs = [];
    transitionList = [];
    const els = [...document.querySelectorAll('[data-start],[data-duration],[data-end],[data-sequence] > *')].filter(isClipEl);
    const info = new Map();
    for (const el of els) info.set(el, null);
    const seqCache = new Map();
    function parentClip(el) {
      let p = el.parentElement;
      while (p && !info.has(p)) p = p.parentElement;
      return p || null;
    }
    function seqLayout(container) {
      if (seqCache.has(container)) return seqCache.get(container);
      const tr = parseTransition(container.getAttribute('data-transition'));
      const gap = parseTime(container.getAttribute('data-gap'), container, 'data-gap') || 0;
      const kids = [...container.children].filter((c) => !SKIP_TAGS.has(c.tagName));
      // data-cuts="0 2.13 4.27": when each child starts (e.g. on music beats); durations follow from them.
      const cutsAttr = container.getAttribute('data-cuts');
      const cuts = cutsAttr ? cutsAttr.trim().split(/[\s,]+/).map((x) => parseTime(x, container, 'data-cuts')).filter((x) => x != null) : null;
      if (cuts && cuts.length) {
        const map = new Map(), trs = [];
        let end = 0;
        kids.forEach((k, i) => {
          const own = i > 0 ? parseTransition(k.getAttribute('data-transition')) : null;
          const t = i > 0 ? (own || tr) : null;
          trs.push(t);
          // data-cut-align: is the cut time the start (default), middle or end of the transition into this child?
          const align = container.getAttribute('data-cut-align') || 'start';
          const shift = t ? (align === 'middle' ? t.dur / 2 : align === 'end' ? t.dur : 0) : 0;
          const start = cuts[i] != null ? Math.max(0, cuts[i] - shift) : end;
          const nextT = i + 1 < kids.length ? (parseTransition(kids[i + 1].getAttribute('data-transition')) || tr) : null;
          let d;
          const nshift = nextT ? (align === 'middle' ? nextT.dur / 2 : align === 'end' ? nextT.dur : 0) : 0;
          if (cuts[i + 1] != null) d = cuts[i + 1] - nshift - start + (nextT ? nextT.dur : 0);
          else {
            // the last child runs to the end of the video when <html data-duration> is set
            const own = parseTime(k.getAttribute('data-duration'), k, 'data-duration');
            const total = parseTime(rootAttr('duration'), root, 'data-duration');
            let nested = container.hasAttribute('data-start') || container.hasAttribute('data-duration');
            for (let an = container.parentElement; an && an !== document.body && an !== root; an = an.parentElement) if (an.hasAttribute('data-start') || an.hasAttribute('data-duration')) nested = true;
            d = own ?? (total != null && !nested && total > start ? total - start : 3);
          }
          if (cuts[i] == null && i < kids.length) report('warning', 'cuts-short', `data-cuts has ${cuts.length} times for ${kids.length} children; the rest follow one after another.`, container);
          map.set(k, { start, dur: d, index: i, count: kids.length });
          end = start + d;
        });
        const res = { map, length: end, tr, trs };
        seqCache.set(container, res);
        return res;
      }
      let cursor = 0;
      const map = new Map();
      const trs = [];
      kids.forEach((k, i) => {
        let d = parseTime(k.getAttribute('data-duration'), k, 'data-duration');
        if (d == null) {
          const e = parseTime(k.getAttribute('data-end'), k, 'data-end');
          if (e != null) d = e;
        }
        if (d == null) {
          report('error', 'sequence-missing-duration', 'Every child of a data-sequence needs data-duration.', k, 'Add data-duration="3" (seconds) to this element.');
          d = 0;
        }
        // How this child comes in: its own data-transition, else the container's.
        const own = i > 0 ? parseTransition(k.getAttribute('data-transition')) : null;
        const t = i > 0 ? (own || tr) : null;
        trs.push(t);
        if (t) cursor -= t.dur;
        const offset = parseTime(k.getAttribute('data-start'), k, 'data-start') || 0; // extra shift inside sequence
        map.set(k, { start: cursor + offset, dur: d, index: i, count: kids.length });
        cursor += d + gap;
      });
      const res = { map, length: cursor - gap, tr, trs };
      seqCache.set(container, res);
      return res;
    }
    function compute(el, total) {
      const cur = info.get(el);
      if (cur) return cur;
      const pEl = parentClip(el);
      const P = pEl ? compute(pEl, total) : { start: 0, end: total };
      const parent = el.parentElement;
      let start, dur;
      if (parent && parent.hasAttribute('data-sequence')) {
        // The sequence's own clip (if any) is P when parent is a clip; else the clip enclosing the container.
        const base = info.has(parent) ? compute(parent, total) : P;
        const lay = seqLayout(parent);
        const slot = lay.map.get(el);
        start = base.start + slot.start;
        dur = slot.dur;
        const r = { start, end: Math.min(start + dur, base.end), parent: pEl, seq: lay, slot };
        info.set(el, r);
        return r;
      }
      start = P.start + (parseTime(el.getAttribute('data-start'), el, 'data-start') || 0);
      dur = parseTime(el.getAttribute('data-duration'), el, 'data-duration');
      if (dur == null) {
        const e = parseTime(el.getAttribute('data-end'), el, 'data-end');
        if (e != null) dur = P.start + e - start;
      }
      // A sequence container without explicit duration lasts as long as its children.
      if (dur == null && el.hasAttribute('data-sequence')) dur = seqLayout(el).length;
      const end = dur == null ? P.end : Math.min(start + dur, P.end);
      const r = { start, end, parent: pEl };
      info.set(el, r);
      return r;
    }
    // Pass 1: unknown total → find the natural end of the composition.
    let total = parseTime(rootAttr('duration'), root, 'data-duration');
    if (total == null) {
      let maxEnd = 0;
      for (const el of els) { const r = compute(el, Infinity); if (isFinite(r.end)) maxEnd = Math.max(maxEnd, r.end); }
      // Top-level sequences without clip attributes
      for (const s of document.querySelectorAll('[data-sequence]')) {
        if (!info.has(s) && !parentClip(s)) maxEnd = Math.max(maxEnd, seqLayout(s).length);
      }
      for (const k of info.keys()) info.set(k, null);
      seqCache.clear();
      total = maxEnd;
    }
    for (const el of els) compute(el, total);
    comp.duration = total;
    clips = els.map((el) => Object.assign({ el }, info.get(el)));
    clips.forEach((c) => clipOf.set(c.el, c));
    // Time remapping: data-loop, data-freeze, data-speed change the time seen by a clip's content.
    hasRemap = false;
    for (const c of clips) {
      const el = c.el;
      const loop = parseTime(el.getAttribute('data-loop'), el, 'data-loop');
      const freeze = parseTime(el.getAttribute('data-freeze'), el, 'data-freeze');
      const speed = el.hasAttribute('data-speed') ? parseFloat(el.getAttribute('data-speed')) : null;
      if (loop != null || freeze != null || (speed != null && speed !== 1)) {
        c.remap = { loop: loop > 0 ? loop : null, freeze, speed: speed != null && isFinite(speed) ? speed : 1 };
        hasRemap = true;
      }
    }
    for (const c of clips) {
      const chain = [];
      let p = c;
      while (p) { if (p.remap) chain.unshift(p); p = p.parent ? clipOf.get(p.parent) : null; }
      c.chain = chain; // outer → inner, includes c itself if it remaps
      c.outer = chain[chain.length - 1] === c ? chain.slice(0, -1) : chain;
    }
    // Apply sequence transitions to children that do not define their own enter/exit.
    for (const [container, lay] of seqCache) {
      const kids = [...lay.map.keys()];
      kids.forEach((k, i) => {
        const t = lay.trs[i];
        if (!t) return;
        const def = TRANSITIONS[t.name];
        const ez = t.ease || def.ease;
        const tail = `${t.dur}s${ez ? ' ' + ez : ''}`;
        if (def.morph) morphPairs.push({ from: kids[i - 1], to: k, dur: t.dur, ease: ez || 'in-out-cubic' });
        const kc = clipOf.get(k);
        if (kc) transitionList.push({ name: t.name, start: round(kc.start), end: round(kc.start + t.dur) });
        if (def.enter && !k.hasAttribute('data-enter')) k.setAttribute('data-enter', `${def.enter} ${tail}`);
        const prev = kids[i - 1];
        if (prev && def.exit && !prev.hasAttribute('data-exit')) prev.setAttribute('data-exit', `${def.exit} ${tail}`);
      });
    }
    // Lint: clips that never show
    for (const c of clips) {
      if (c.end <= c.start && !(c.el.tagName === 'AUDIO')) report('warning', 'empty-clip', `Element is never visible (start ${round(c.start)}s, end ${round(c.end)}s).`, c.el, 'Check data-start / data-duration against its parent clip.');
      if (c.start >= total && total > 0) report('warning', 'clip-after-end', `Element starts at ${round(c.start)}s, after the video ends (${round(total)}s).`, c.el, 'Increase data-duration on <html> or move this clip earlier.');
    }
    timelineDirty = false;
  }

  function applyChain(chain, T) {
    for (const R of chain) {
      const r = R.remap;
      let lt = T - R.start;
      if (r.freeze != null) lt = r.freeze;
      else { lt *= r.speed; if (r.loop) lt = lt >= 0 ? lt % r.loop : lt; }
      T = R.start + lt;
    }
    return T;
  }
  // The time an element's content sees (after loop/freeze/speed of its clips).
  function mapT(el, T) {
    if (!hasRemap || !el) return T;
    const c = nearestClip(el);
    return c && c.chain.length ? applyChain(c.chain, T) : T;
  }
  function nearestClip(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = clipOf.get(cur);
      if (c) return c;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return null;
  }
  function beatGrid() {
    const h = document.documentElement;
    const bpm = parseFloat(h.getAttribute('data-bpm'));
    if (!(bpm > 0)) report('warning', 'no-bpm', 'mw.beat()/mw.bar() need <html data-bpm="…">: using 120 BPM.', null, 'Run `npx motionwright audio music.mp3`: it prints the data-bpm, data-beat-offset and data-bar-offset to copy.');
    const period = 60 / (bpm > 0 ? bpm : 120);
    const offset = parseFloat(h.getAttribute('data-beat-offset')) || 0;
    const barOffset = h.hasAttribute('data-bar-offset') ? parseFloat(h.getAttribute('data-bar-offset')) || 0 : offset;
    const perBar = parseInt(h.getAttribute('data-beats-per-bar'), 10) || 4;
    return { period, offset, barOffset, perBar };
  }
  function clipStartOf(el) { const c = nearestClip(el); return c ? c.start : 0; }
  function clipEndOf(el) { const c = nearestClip(el); return c ? c.end : comp.duration; }

  let lastVisible = '';
  function updateVisibility(T) {
    let sig = '';
    for (const c of clips) {
      const tt = hasRemap && c.outer.length ? applyChain(c.outer, T) : T;
      const on = tt >= c.start - 1e-9 && tt < c.end - 1e-9;
      sig += on ? '1' : '0';
      if (on) { if (c.el.hasAttribute('data-mw-hidden')) c.el.removeAttribute('data-mw-hidden'); }
      else if (!c.el.hasAttribute('data-mw-hidden')) c.el.setAttribute('data-mw-hidden', '');
    }
    const changed = sig !== lastVisible;
    lastVisible = sig;
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Animation registry: every CSS animation, CSS transition and WAAPI animation
  // is paused and driven from the virtual clock.
  // ---------------------------------------------------------------------------
  const known = new Set();
  const origin = new WeakMap(); // animation -> seconds
  const ownAnim = new WeakSet();

  const preInit = [];
  let pendingInit = true;
  Element.prototype.animate = function (...args) {
    const a = real.animate.apply(this, args);
    if (!origin.has(a)) {
      origin.set(a, pendingInit ? 0 : Math.max(now, clipStartOf(this)));
      known.add(a);
      if (pendingInit) preInit.push(a);
    }
    try { a.pause(); a.currentTime = Math.max(0, (now - origin.get(a)) * 1000); } catch (e) {}
    return a;
  };

  function targetOf(a) {
    const eff = a.effect;
    return eff && eff.target ? eff.target : null;
  }
  // mode: 'clip' → origin = start of the target's clip (animations that exist because a clip is visible)
  //       'event' → origin = the time of the event that created it (timer, script)
  function flushAnimations(t, mode) {
    let list;
    try { list = document.getAnimations(); } catch (e) { return; }
    for (const a of list) {
      if (known.has(a)) continue;
      known.add(a);
      const tg = targetOf(a);
      const cs = tg ? clipStartOf(tg) : 0;
      origin.set(a, mode === 'clip' ? cs : Math.max(t, cs));
      if (inFrameCallbacks && mode !== 'clip') {
        report('warning', 'non-seekable-animation', 'A CSS animation/transition started inside mw.onFrame(). It will not seek correctly when rendering in parallel.', tg, 'Inside onFrame, set styles directly from t (use mw.interpolate). To start a CSS animation at a time, use data-start on the element instead.', t);
      }
    }
  }
  let inFrameCallbacks = false;

  function seekAnimations(T) {
    let active = false;
    for (const a of known) {
      const ps = a.playState;
      const isCss = (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) || (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition);
      if (isCss && ps === 'idle') { known.delete(a); continue; }
      const tg = targetOf(a);
      if (tg && !tg.isConnected) { known.delete(a); continue; }
      if (!isCss && ps === 'idle' && !ownAnim.has(a)) continue;
      const o = origin.get(a) || 0;
      const rate = a.playbackRate || 1;
      try {
        if (ps !== 'paused') a.pause();
        a.currentTime = ((hasRemap ? mapT(tg, T) : T) - o) * 1000 * rate;
      } catch (e) { continue; }
      if (!active) {
        try {
          const ct = a.effect && a.effect.getComputedTiming();
          if (ct && ct.progress != null) {
            const at = ct.localTime, d = ct.delay || 0, ad = ct.activeDuration;
            if (at > d && at < d + ad) active = true; // inside active phase → frame changes
          }
        } catch (e) { active = true; }
      }
    }
    return active;
  }

  // ---------------------------------------------------------------------------
  // data-enter / data-exit
  // ---------------------------------------------------------------------------
  // 1 unit = 1px when the short side of the frame is 1080px (so 1080p, 1080x1920 and 1080x1080 all use the same sizes).
  const PX = () => Math.min(comp.width, comp.height) / 1080;
  const B = (n) => `blur(${n * PX()}px)`;
  const MASK_OUT = 'inset(-30% -10% -18% -10%)';
  const PRESETS = {
    'fade': () => [{ opacity: 0 }, { opacity: 1 }],
    'fade-up': () => [{ opacity: 0, translate: `0 ${48 * PX()}px` }, { opacity: 1, translate: '0 0' }],
    'fade-down': () => [{ opacity: 0, translate: `0 ${-48 * PX()}px` }, { opacity: 1, translate: '0 0' }],
    'fade-left': () => [{ opacity: 0, translate: `${48 * PX()}px 0` }, { opacity: 1, translate: '0 0' }],
    'fade-right': () => [{ opacity: 0, translate: `${-48 * PX()}px 0` }, { opacity: 1, translate: '0 0' }],
    'rise': () => [{ opacity: 0, translate: `0 ${90 * PX()}px`, filter: B(10) }, { opacity: 1, translate: '0 0', filter: B(0) }],
    'scale': () => [{ opacity: 0, scale: '0.85' }, { opacity: 1, scale: '1' }],
    'pop': () => [{ opacity: 0, scale: '0.4', offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1, scale: '1', offset: 1 }],
    'zoom': () => [{ opacity: 0, scale: '1.25' }, { opacity: 1, scale: '1' }],
    'blur': () => [{ opacity: 0, filter: B(18) }, { opacity: 1, filter: B(0) }],
    'slide-up': () => [{ translate: '0 100%' }, { translate: '0 0' }],
    'slide-down': () => [{ translate: '0 -100%' }, { translate: '0 0' }],
    'slide-left': () => [{ translate: '100% 0' }, { translate: '0 0' }],
    'slide-right': () => [{ translate: '-100% 0' }, { translate: '0 0' }],
    'whip-left': () => [{ translate: '100% 0', filter: B(28) }, { translate: '0 0', filter: B(0) }],
    'whip-right': () => [{ translate: '-100% 0', filter: B(28) }, { translate: '0 0', filter: B(0) }],
    'whip-up': () => [{ translate: '0 100%', filter: B(28) }, { translate: '0 0', filter: B(0) }],
    'whip-down': () => [{ translate: '0 -100%', filter: B(28) }, { translate: '0 0', filter: B(0) }],
    'wipe-right': () => [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
    'wipe-left': () => [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)' }],
    'wipe-down': () => [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }],
    'wipe-up': () => [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }],
    'diagonal': () => [{ clipPath: 'polygon(0% 0%, 0% 0%, -40% 100%, -40% 100%)' }, { clipPath: 'polygon(0% 0%, 140% 0%, 100% 100%, -40% 100%)' }],
    'clock': () => [{ '--mw-clock': '0%' }, { '--mw-clock': '100%' }],
    'iris': () => [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }],
    'zoom-near': () => [{ opacity: 0, scale: '0.55' }, { opacity: 1, scale: '1' }],
    'flip-in': () => [{ transform: 'perspective(2400px) rotateY(90deg)', opacity: 0, offset: 0 }, { transform: 'perspective(2400px) rotateY(90deg)', opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5001 }, { transform: 'perspective(2400px) rotateY(0deg)', opacity: 1, offset: 1 }],
    'dip-in': () => [{ opacity: 0, filter: 'brightness(0)', offset: 0 }, { opacity: 0, filter: 'brightness(0)', offset: 0.5 }, { opacity: 1, filter: 'brightness(0)', offset: 0.5001 }, { opacity: 1, filter: 'brightness(1)', offset: 1 }],
    'draw': () => [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
    // handwriting: the text appears left to right at pen speed (pairs with a hand font and data-split="lines")
    'write': () => [{ clipPath: 'inset(-40% 100% -40% -4%)' }, { clipPath: 'inset(-40% -4% -40% -4%)' }],
    // Text and object entrances
    'mask-up': () => [{ translate: '0 100%', clipPath: 'inset(-30% -10% 100% -10%)' }, { translate: '0 0', clipPath: MASK_OUT }],
    'mask-down': () => [{ translate: '0 -100%', clipPath: 'inset(100% -10% -18% -10%)' }, { translate: '0 0', clipPath: MASK_OUT }],
    'mask-left': () => [{ translate: '100% 0', clipPath: 'inset(-30% 100% -18% -10%)' }, { translate: '0 0', clipPath: MASK_OUT }],
    'mask-right': () => [{ translate: '-100% 0', clipPath: 'inset(-30% -10% -18% 100%)' }, { translate: '0 0', clipPath: MASK_OUT }],
    'flip-up': () => [{ opacity: 0, rotate: '1 0 0 -95deg', transformOrigin: '50% 100%' }, { opacity: 1, rotate: '1 0 0 0deg', transformOrigin: '50% 100%' }],
    'drop': () => [{ opacity: 0, translate: `0 ${-160 * PX()}px` }, { opacity: 1, offset: 0.25 }, { opacity: 1, translate: '0 0' }],
    'swing': () => [{ opacity: 0, rotate: '-28deg', transformOrigin: '0% 100%' }, { opacity: 1, rotate: '0deg', transformOrigin: '0% 100%' }],
    'stretch': () => [{ opacity: 0, scale: '1.9 0.35', filter: B(8) }, { opacity: 1, scale: '1 1', filter: B(0) }],
    'tilt': () => [{ opacity: 0, translate: `0 ${70 * PX()}px`, rotate: '7deg' }, { opacity: 1, translate: '0 0', rotate: '0deg' }],
    'spin-in': () => [{ opacity: 0, scale: '0', rotate: '-200deg' }, { opacity: 1, scale: '1', rotate: '0deg' }],
    'elastic': () => [{ scale: '0' }, { scale: '1' }],
    'grow': () => [{ scale: '0' }, { scale: '1' }],
    'grow-x': () => [{ scale: '0 1', transformOrigin: '0% 50%' }, { scale: '1 1', transformOrigin: '0% 50%' }],
    'grow-y': () => [{ scale: '1 0', transformOrigin: '50% 100%' }, { scale: '1 1', transformOrigin: '50% 100%' }],
    'typewriter': () => [{ opacity: 0 }, { opacity: 1 }],
    'none': () => null,
  };
  // Default duration and easing per preset (data-enter="name [duration] [delay] [easing]" overrides).
  const PRESET_DEFAULTS = {
    'drop': { ease: 'bouncy', dur: 1 }, 'swing': { ease: 'bouncy', dur: 1 }, 'elastic': { ease: 'out-elastic', dur: 1.1 },
    'spin-in': { ease: 'out-back', dur: 0.8 }, 'grow': { ease: 'out-back', dur: 0.6 }, 'grow-x': { ease: 'out-expo', dur: 0.9 }, 'grow-y': { ease: 'out-expo', dur: 0.9 },
    'mask-up': { ease: 'out-expo', dur: 0.8 }, 'mask-down': { ease: 'out-expo', dur: 0.8 }, 'mask-left': { ease: 'out-expo', dur: 0.8 }, 'mask-right': { ease: 'out-expo', dur: 0.8 },
    'flip-up': { ease: 'out-back', dur: 0.8 }, 'stretch': { ease: 'out-expo', dur: 0.8 }, 'tilt': { ease: 'out-expo', dur: 0.8 },
    'typewriter': { ease: 'steps(1)', dur: 0.02 }, 'write': { ease: 'in-out-sine', dur: 0.8 }, 'draw': { ease: 'in-out-sine', dur: 1 },
  };
  // Exit motion keeps going in the named direction (fade-up exit moves up).
  const EXIT_PRESETS = {
    'fade': () => [{ opacity: 1 }, { opacity: 0 }],
    'fade-up': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${-48 * PX()}px` }],
    'fade-down': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${48 * PX()}px` }],
    'fade-left': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `${-48 * PX()}px 0` }],
    'fade-right': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `${48 * PX()}px 0` }],
    'rise': () => [{ opacity: 1, translate: '0 0', filter: B(0) }, { opacity: 0, translate: `0 ${-90 * PX()}px`, filter: B(10) }],
    'scale': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.85' }],
    'pop': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.4' }],
    'zoom': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.25' }],
    'blur': () => [{ opacity: 1, filter: B(0) }, { opacity: 0, filter: B(18) }],
    'slide-up': () => [{ translate: '0 0' }, { translate: '0 -100%' }],
    'slide-down': () => [{ translate: '0 0' }, { translate: '0 100%' }],
    'slide-left': () => [{ translate: '0 0' }, { translate: '-100% 0' }],
    'slide-right': () => [{ translate: '0 0' }, { translate: '100% 0' }],
    'whip-left': () => [{ translate: '0 0', filter: B(0) }, { translate: '-100% 0', filter: B(28) }],
    'whip-right': () => [{ translate: '0 0', filter: B(0) }, { translate: '100% 0', filter: B(28) }],
    'whip-up': () => [{ translate: '0 0', filter: B(0) }, { translate: '0 -100%', filter: B(28) }],
    'whip-down': () => [{ translate: '0 0', filter: B(0) }, { translate: '0 100%', filter: B(28) }],
    'wipe-right': () => [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }],
    'wipe-left': () => [{ clipPath: 'inset(0 0% 0 0)' }, { clipPath: 'inset(0 100% 0 0)' }],
    'wipe-down': () => [{ clipPath: 'inset(0% 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }],
    'wipe-up': () => [{ clipPath: 'inset(0 0 0% 0)' }, { clipPath: 'inset(0 0 100% 0)' }],
    'iris': () => [{ clipPath: 'circle(75% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)' }],
    'zoom-past': () => [{ opacity: 1, scale: '1', filter: B(0) }, { opacity: 0, scale: '2.4', filter: B(14) }],
    'flip-out': () => [{ transform: 'perspective(2400px) rotateY(0deg)', opacity: 1, offset: 0 }, { transform: 'perspective(2400px) rotateY(-90deg)', opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5001 }, { transform: 'perspective(2400px) rotateY(-90deg)', opacity: 0, offset: 1 }],
    'dip-out': () => [{ filter: 'brightness(1)', offset: 0 }, { filter: 'brightness(0)', offset: 0.5 }, { filter: 'brightness(0)', offset: 1 }],
    'draw': () => [{ strokeDasharray: '1 1', strokeDashoffset: 0 }, { strokeDasharray: '1 1', strokeDashoffset: -1 }],
    'mask-up': () => [{ translate: '0 0', clipPath: MASK_OUT }, { translate: '0 -100%', clipPath: 'inset(100% -10% -18% -10%)' }],
    'mask-down': () => [{ translate: '0 0', clipPath: MASK_OUT }, { translate: '0 100%', clipPath: 'inset(-30% -10% 100% -10%)' }],
    'mask-left': () => [{ translate: '0 0', clipPath: MASK_OUT }, { translate: '-100% 0', clipPath: 'inset(-30% -10% -18% 100%)' }],
    'mask-right': () => [{ translate: '0 0', clipPath: MASK_OUT }, { translate: '100% 0', clipPath: 'inset(-30% 100% -18% -10%)' }],
    'flip-up': () => [{ opacity: 1, rotate: '1 0 0 0deg', transformOrigin: '50% 0%' }, { opacity: 0, rotate: '1 0 0 95deg', transformOrigin: '50% 0%' }],
    'drop': () => [{ opacity: 1, translate: '0 0' }, { opacity: 1, offset: 0.7 }, { opacity: 0, translate: `0 ${200 * PX()}px` }],
    'swing': () => [{ opacity: 1, rotate: '0deg', transformOrigin: '100% 100%' }, { opacity: 0, rotate: '28deg', transformOrigin: '100% 100%' }],
    'stretch': () => [{ opacity: 1, scale: '1 1', filter: B(0) }, { opacity: 0, scale: '1.9 0.35', filter: B(8) }],
    'tilt': () => [{ opacity: 1, translate: '0 0', rotate: '0deg' }, { opacity: 0, translate: `0 ${-70 * PX()}px`, rotate: '-7deg' }],
    'spin-in': () => [{ opacity: 1, scale: '1', rotate: '0deg' }, { opacity: 0, scale: '0', rotate: '200deg' }],
    'elastic': () => [{ scale: '1' }, { scale: '0' }],
    'grow': () => [{ scale: '1' }, { scale: '0' }],
    'grow-x': () => [{ scale: '1 1', transformOrigin: '100% 50%' }, { scale: '0 1', transformOrigin: '100% 50%' }],
    'grow-y': () => [{ scale: '1 1', transformOrigin: '50% 100%' }, { scale: '1 0', transformOrigin: '50% 100%' }],
    'typewriter': () => [{ opacity: 1 }, { opacity: 0 }],
    'none': () => null,
  };
  const EXIT_DEFAULTS = { 'elastic': { ease: 'in-back', dur: 0.5 }, 'grow': { ease: 'in-back', dur: 0.5 }, 'spin-in': { ease: 'in-back', dur: 0.6 }, 'typewriter': { ease: 'steps(1)', dur: 0.02 }, 'drop': { ease: 'in-cubic', dur: 0.6 } };
  function parseMotion(v, el, attr, defDur, defEase) {
    const toks = String(v).trim().split(/\s+/).filter(Boolean);
    const out = { name: toks[0] || 'fade', dur: defDur, delay: 0, ease: defEase };
    const nums = [];
    for (const t of toks.slice(1)) {
      if (isEasingName(t)) out.ease = t;
      else { const n = parseTime(t, el, attr); if (n != null) nums.push(n); }
    }
    if (nums[0] != null) out.dur = nums[0];
    if (nums[1] != null) out.delay = nums[1];
    return out;
  }
  function applyEnterExit() {
    for (const el of document.querySelectorAll('[data-enter],[data-exit]')) {
      if (el.__mwEE) continue;
      el.__mwEE = true;
      const stagger = parseTime(el.getAttribute('data-stagger'), el, 'data-stagger');
      let targets = [el];
      if (stagger != null) {
        targets = splitTargets.get(el) || [...el.children].filter((c) => !SKIP_TAGS.has(c.tagName));
      }
      const base = nearestClip(el);
      const cStart = base ? base.start : 0;
      const cEnd = base ? base.end : comp.duration;
      const en = el.getAttribute('data-enter');
      const ex = el.getAttribute('data-exit');
      targets.forEach((tg, i) => {
        const extra = stagger != null ? stagger * i : 0;
        if (en) {
          const nm = String(en).trim().split(/\s+/)[0];
          // write: as long as a hand needs for the text (about 22 letters a second) unless a duration is given
          const defDur = nm === 'write' ? Math.max(0.35, Math.min(3, (tg.textContent || '').trim().length / 22)) : (PRESET_DEFAULTS[nm] || {}).dur ?? 0.6;
          const m = parseMotion(en, el, 'data-enter', defDur, (PRESET_DEFAULTS[nm] || {}).ease || 'out-expo');
          if (!PRESETS[m.name]) { report('error', 'bad-enter', `Unknown data-enter "${m.name}".`, el, 'Use one of: ' + Object.keys(PRESETS).filter((k) => !/^(zoom-near|flip-in|dip-in|clock|diagonal)$/.test(k)).join(', ')); }
          else {
            if (m.name === 'draw') prepDraw(tg);
            if (m.name === 'clock') prepClock(tg);
            const kf = PRESETS[m.name]();
            if (kf) addOwn(tg, kf, { duration: m.dur * 1000, delay: (m.delay + extra) * 1000, easing: cssEasing(m.ease), fill: 'backwards' }, cStart);
          }
        }
        if (ex) {
          const nm = String(ex).trim().split(/\s+/)[0];
          const m = parseMotion(ex, el, 'data-exit', (EXIT_DEFAULTS[nm] || {}).dur ?? 0.45, (EXIT_DEFAULTS[nm] || {}).ease || 'in-cubic');
          if (!EXIT_PRESETS[m.name]) { report('error', 'bad-exit', `Unknown data-exit "${m.name}".`, el, 'Use one of: ' + Object.keys(EXIT_PRESETS).join(', ')); }
          else if (!isFinite(cEnd)) { report('warning', 'exit-no-end', 'data-exit needs the element (or a parent) to have an end time.', el, 'Add data-duration to this element or its clip.'); }
          else {
            if (m.name === 'draw') prepDraw(tg);
            const kf = EXIT_PRESETS[m.name]();
            const n = targets.length;
            const ext = stagger != null ? stagger * (n - 1 - i) : 0;
            const startAt = (cEnd - cStart) - m.dur - m.delay - ext;
            if (kf) addOwn(tg, kf, { duration: m.dur * 1000, delay: Math.max(0, startAt) * 1000, easing: cssEasing(m.ease), fill: 'forwards' }, cStart);
          }
        }
      });
    }
  }
  let clockReg = false;
  function prepClock(el) {
    if (!clockReg) { clockReg = true; try { CSS.registerProperty({ name: '--mw-clock', syntax: '<percentage>', inherits: false, initialValue: '100%' }); } catch (e) {} }
    el.style.maskImage = el.style.webkitMaskImage = 'conic-gradient(from 0deg, #000 var(--mw-clock), transparent var(--mw-clock))';
  }
  function prepDraw(el) {
    const shapes = el instanceof SVGGeometryElement ? [el] : [...el.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect')];
    for (const s of shapes) if (!s.hasAttribute('pathLength')) s.setAttribute('pathLength', '1');
  }
  function addOwn(el, keyframes, timing, originTime) {
    const a = real.animate.call(el, keyframes, timing);
    a.pause();
    ownAnim.add(a);
    origin.set(a, originTime);
    known.add(a);
    return a;
  }

  // ---------------------------------------------------------------------------
  // data-split (words / chars / lines) — gives each piece --i for staggering
  // ---------------------------------------------------------------------------
  const splitTargets = new WeakMap();
  function applySplit() {
    for (const el of document.querySelectorAll('[data-split]')) {
      if (el.__mwSplit) continue;
      el.__mwSplit = true;
      const mode = (el.getAttribute('data-split') || 'words').trim();
      const pieces = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      let wi = 0, ci = 0;
      for (const tn of texts) {
        const parts = tn.data.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); continue; }
          const w = document.createElement('span');
          w.className = 'mw-word';
          w.style.setProperty('--i', String(wi));
          w.style.setProperty('--wi', String(wi++));
          if (mode === 'chars') {
            for (const ch of Array.from(p)) {
              const c = document.createElement('span');
              c.className = 'mw-char';
              c.textContent = ch;
              c.style.setProperty('--i', String(ci));
              c.style.setProperty('--ci', String(ci++));
              w.appendChild(c);
              pieces.push(c);
            }
          } else { w.textContent = p; pieces.push(w); }
          frag.appendChild(w);
        }
        tn.parentNode.replaceChild(frag, tn);
      }
      el.style.setProperty('--n', String(pieces.length));
      fixClipText(el, pieces);
      if (mode === 'lines') {
        // group words by their rendered line (after fonts load)
        const words = pieces;
        let line = -1, lastTop = null;
        for (const w of words) {
          const top = Math.round(w.offsetTop);
          if (lastTop === null || Math.abs(top - lastTop) > 2) { line++; lastTop = top; }
          w.style.setProperty('--i', String(line));
          w.style.setProperty('--li', String(line));
        }
        el.style.setProperty('--n', String(line + 1));
        // stagger targets: one entry per line → use first word? we animate each word with its line index.
        splitTargets.set(el, words);
        el.__mwLineIndex = true;
      } else splitTargets.set(el, pieces);
    }
  }

  // Gradient text (background-clip: text) on a parent stops painting a child while the child
  // animates on its own layer. Give each piece its own slice of the same gradient.
  function fixClipText(root, pieces) {
    for (const p of pieces) {
      let anc = p.parentElement;
      while (anc) {
        const cs = getComputedStyle(anc);
        if ((cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') && cs.backgroundImage !== 'none') {
          const a = anc.getBoundingClientRect(), r = p.getBoundingClientRect();
          p.style.backgroundImage = cs.backgroundImage;
          p.style.backgroundSize = `${a.width}px ${a.height}px`;
          p.style.backgroundPosition = `${a.left - r.left}px ${a.top - r.top}px`;
          p.style.backgroundRepeat = 'no-repeat';
          p.style.webkitBackgroundClip = 'text';
          p.style.backgroundClip = 'text';
          p.style.color = 'transparent';
          p.style.webkitTextFillColor = 'transparent';
          break;
        }
        if (anc === root) break;
        anc = anc.parentElement;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // data-count and data-type
  // ---------------------------------------------------------------------------
  const counters = [];
  const typers = [];
  function setupCountersAndTypers() {
    for (const el of document.querySelectorAll('[data-count]')) {
      if (el.__mwCount) continue;
      el.__mwCount = true;
      const parts = el.getAttribute('data-count').trim().split(/\s+/).map(Number);
      const from = parts.length > 1 ? parts[0] : 0;
      const to = parts.length > 1 ? parts[1] : parts[0];
      if (!isFinite(from) || !isFinite(to)) { report('error', 'bad-count', 'data-count needs numbers: "1250" or "0 1250".', el); continue; }
      const decAttr = el.getAttribute('data-count-decimals');
      const decimals = decAttr != null ? parseInt(decAttr, 10) : Math.max(dec(from), dec(to));
      counters.push({
        el, from, to, decimals,
        dur: parseTime(el.getAttribute('data-count-duration'), el, 'data-count-duration') ?? 1.6,
        delay: parseTime(el.getAttribute('data-count-delay'), el, 'data-count-delay') ?? 0,
        ease: easing(el.getAttribute('data-count-ease') || 'out-expo'),
        prefix: el.getAttribute('data-count-prefix') || '',
        suffix: el.getAttribute('data-count-suffix') || '',
        group: el.getAttribute('data-count-group') !== 'false',
        last: null,
      });
    }
    for (const el of document.querySelectorAll('[data-type]')) {
      if (el.__mwType) continue;
      el.__mwType = true;
      const nodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push({ node: walker.currentNode, text: walker.currentNode.data });
      const total = nodes.reduce((s, n) => s + n.text.length, 0);
      const v = el.getAttribute('data-type').trim();
      const cps = v ? parseFloat(v) : 30;
      const caret = el.hasAttribute('data-type-caret') ? document.createElement('span') : null;
      if (caret) caret.className = 'mw-caret';
      // Reserve the final size so the layout doesn't jump while typing (block-level elements).
      const disp = getComputedStyle(el).display;
      if (disp !== 'inline' && el.offsetHeight > 0 && !el.style.minHeight) el.style.minHeight = el.offsetHeight + 'px';
      typers.push({ el, nodes, total, cps: cps > 0 ? cps : 30, delay: parseTime(el.getAttribute('data-type-delay'), el, 'data-type-delay') ?? 0, caret, last: -1 });
    }
  }
  function dec(n) { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function fmtNumber(v, decimals, group) {
    // a real minus sign (−), not a hyphen: it lines up with the digits
    let s = Math.abs(v).toFixed(decimals);
    const neg = v < 0 && /[1-9]/.test(s);
    if (group) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
    return (neg ? '\u2212' : '') + s;
  }
  function updateCounters(T) {
    let changed = false;
    for (const c of counters) {
      const lt = mapT(c.el, T) - clipStartOf(c.el) - c.delay;
      const p = c.dur > 0 ? Math.min(1, Math.max(0, lt / c.dur)) : 1;
      const v = c.from + (c.to - c.from) * c.ease(p);
      const txt = c.prefix + fmtNumber(v, c.decimals, c.group) + c.suffix;
      if (txt !== c.last) { c.el.textContent = txt; c.last = txt; changed = true; }
    }
    for (const ty of typers) {
      const lt = mapT(ty.el, T) - clipStartOf(ty.el) - ty.delay;
      const n = Math.max(0, Math.min(ty.total, Math.floor(lt * ty.cps + 1e-6)));
      const typing = n > 0 && n < ty.total;
      if (n !== ty.last) {
        changed = true;
        let left = n, lastNode = null;
        for (const it of ty.nodes) {
          const take = Math.max(0, Math.min(it.text.length, left));
          it.node.data = it.text.slice(0, take);
          left -= take;
          if (take > 0) lastNode = it.node;
        }
        if (ty.caret) {
          if (lastNode) lastNode.parentNode.insertBefore(ty.caret, lastNode.nextSibling);
          else ty.el.insertBefore(ty.caret, ty.el.firstChild);
        }
        ty.last = n;
      }
      if (typing) ty.el.setAttribute('data-mw-typing', ''); else ty.el.removeAttribute('data-mw-typing');
      // no caret before typing starts (a stray blinking bar on an empty line looks like a mistake)
      const wait = lt < 0;
      if (wait !== ty.el.hasAttribute('data-mw-type-wait')) { changed = true; if (wait) ty.el.setAttribute('data-mw-type-wait', ''); else ty.el.removeAttribute('data-mw-type-wait'); }
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Data binding: data-bind="path", data-bind-src="path", data-bind-style-color="path" …
  // ---------------------------------------------------------------------------
  function getPath(obj, path) {
    return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  let dataCache;
  function getData() {
    if (dataCache !== undefined) return dataCache;
    if (CONFIG.data != null) return (dataCache = CONFIG.data);
    const hm = /[#&]mw-data=([^&]+)/.exec(location.hash);
    if (hm) { try { return (dataCache = JSON.parse(decodeURIComponent(hm[1]))); } catch (e) { report('error', 'bad-data', 'Could not read #mw-data from the page address.', null); } }
    const s = document.getElementById('mw-data');
    if (!s) return null;
    try { dataCache = JSON.parse(s.textContent); } catch (e) { report('error', 'bad-data', 'The <script id="mw-data"> block is not valid JSON: ' + e.message, s); dataCache = null; }
    return dataCache;
  }
  function applyBindings() {
    const data = getData();
    if (!data) return;
    for (const el of document.querySelectorAll('*')) {
      for (const at of [...el.attributes]) {
        if (!at.name.startsWith('data-bind')) continue;
        const v = getPath(data, at.value);
        if (v === undefined) { report('warning', 'bind-missing', `data has no "${at.value}".`, el, 'Pass it with --data file.json or --props \'{"…":…}\'.'); continue; }
        if (at.name === 'data-bind') el.textContent = String(v);
        else if (at.name === 'data-bind-html') el.innerHTML = String(v);
        else if (at.name.startsWith('data-bind-style-')) el.style.setProperty(at.name.slice(16), String(v));
        else if (at.name.startsWith('data-bind-')) el.setAttribute(at.name.slice(10), String(v));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Media: <video> and <audio>
  // ---------------------------------------------------------------------------
  const videos = []; // {el (original), img (render mode), src, ...}
  function mediaTiming(el) {
    const c = nearestClip(el);
    return {
      start: c ? c.start : 0,
      end: c ? c.end : comp.duration,
      from: parseTime(el.getAttribute('data-from') ?? el.getAttribute('data-trim'), el, 'data-from') || 0,
      rate: parseFloat(el.getAttribute('data-rate') || el.getAttribute('playbackrate') || '1') || 1,
      loop: el.hasAttribute('loop'),
      volume: el.hasAttribute('data-volume') && !el.getAttribute('data-volume').includes(':') ? parseFloat(el.getAttribute('data-volume')) : 1,
      // data-volume="0:0 1:0.8 9:0.8 10:0" → time:volume pairs (seconds into the clip), straight lines between
      volumeKeys: el.hasAttribute('data-volume') && el.getAttribute('data-volume').includes(':') ? el.getAttribute('data-volume').trim().split(/[\s,]+/).map((kv) => { const [k, v] = kv.split(':'); return [parseTime(k, el, 'data-volume'), parseFloat(v)]; }).filter((x) => x[0] != null && isFinite(x[1])).sort((a, b) => a[0] - b[0]) : null,
      // data-duck="0.3": drop to this volume while any other sound (voice, video) plays
      duck: el.hasAttribute('data-duck') ? (parseFloat(el.getAttribute('data-duck')) >= 0 ? parseFloat(el.getAttribute('data-duck')) : 0.3) : null,
      fadeIn: parseTime(el.getAttribute('data-fade-in'), el, 'data-fade-in') || 0,
      fadeOut: parseTime(el.getAttribute('data-fade-out'), el, 'data-fade-out') || 0,
      muted: el.hasAttribute('muted') || el.muted === true,
    };
  }
  function setupVideos() {
    for (const el of [...document.querySelectorAll('video')]) {
      if (el.__mwVideo) continue;
      el.__mwVideo = true;
      const src = el.currentSrc || el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src'));
      if (!src) { report('error', 'video-no-src', '<video> has no src.', el); continue; }
      const abs = new URL(src, location.href);
      const v = { el, src: abs.pathname + abs.search, url: abs.href, timing: mediaTiming(el), img: null, lastKey: null, pending: null };
      el.pause && el.pause();
      el.autoplay = false;
      el.removeAttribute('autoplay');
      if (MODE !== 'preview') {
        // Render mode: the <video> element stays (so your CSS still applies) but shows
        // frames decoded by ffmpeg as its background image. Frame-exact and codec-independent.
        el.removeAttribute('src');
        el.removeAttribute('poster');
        for (const s of el.querySelectorAll('source')) s.remove();
        try { el.load(); } catch (e) {}
        const cs = getComputedStyle(el);
        const fit = cs.objectFit || 'contain';
        el.style.backgroundSize = fit === 'fill' ? '100% 100%' : fit === 'none' ? 'auto' : fit === 'scale-down' ? 'contain' : fit;
        el.style.backgroundPosition = cs.objectPosition || '50% 50%';
        el.style.backgroundRepeat = 'no-repeat';
        v.bg = true;
      } else {
        el.muted = true; // preview: audio handled by the player
        el.preload = 'auto';
      }
      videos.push(v);
    }
  }
  function videoTimeAt(v, T) {
    const tm = v.timing;
    let lt = (T - tm.start) * tm.rate + tm.from;
    if (v.duration && tm.loop) lt = tm.from + ((lt - tm.from) % (v.duration - tm.from));
    if (v.duration) lt = Math.min(lt, v.duration - 0.001);
    return Math.max(0, lt);
  }
  const pendingWaits = [];
  function updateVideos(T) {
    let changed = false;
    for (const v of videos) {
      const tm = v.timing;
      const TT = mapT(v.el, T);
      if (TT < tm.start || TT >= tm.end) continue;
      const lt = videoTimeAt(v, TT);
      if (v.bg) {
        const fi = Math.round(lt * comp.fps);
        if (fi === v.lastKey) continue;
        v.lastKey = fi;
        changed = true;
        const url = '/__mw/vframe?src=' + encodeURIComponent(v.src) + '&fps=' + comp.fps + '&i=' + fi;
        const pre = new Image();
        pre.src = url;
        pendingWaits.push(pre.decode().then(() => { v.el.style.backgroundImage = 'url("' + url + '")'; v.keep = pre; }, () => { report('error', 'video-frame', `Could not load video frame ${fi} of ${v.src}.`, v.el, 'Check that the file exists and ffmpeg can read it.', T); }));
      } else {
        const el = v.el;
        if (!v.duration && isFinite(el.duration) && el.duration > 0) v.duration = el.duration;
        if (livePlay.on) { if (Math.abs(el.currentTime - lt) > 0.25) { try { el.currentTime = lt; } catch (e) {} } if (el.paused) el.play().catch(() => {}); continue; }
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - lt) > 0.5 / comp.fps) {
          changed = true;
          pendingWaits.push(new Promise((res) => {
            const done = () => { el.removeEventListener('seeked', done); res(); };
            el.addEventListener('seeked', done);
            try { el.currentTime = lt; } catch (e) { res(); }
            real.setTimeout(res, 1500);
          }));
        }
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Live playback (studio, player): real sound from <audio>/<video>, following the video clock.
  // Volume curves and ducking match the rendered file.
  // ---------------------------------------------------------------------------
  const livePlay = { on: false, rate: 1, muted: false, volume: 1 };
  function keysAt(keys, t) {
    if (!keys || !keys.length) return 1;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return b === a ? vb : va + ((t - a) / (b - a)) * (vb - va); }
    return keys[keys.length - 1][1];
  }
  function syncMedia(on, T, opts = {}) {
    livePlay.on = !!on;
    if (opts.rate != null) livePlay.rate = opts.rate;
    if (opts.muted != null) livePlay.muted = opts.muted;
    if (opts.volume != null) livePlay.volume = opts.volume;
    T = T ?? now;
    const auds = [...document.querySelectorAll('audio')];
    const timings = auds.map((el) => ({ el, tm: mediaTiming(el), c: nearestClip(el) }));
    const sounding = (x) => { const st = x.c ? x.c.start : 0, en = x.c ? x.c.end : comp.duration; return T >= st && T < en; };
    for (const x of timings) {
      const { el, tm } = x;
      const st = x.c ? x.c.start : 0, en = x.c ? x.c.end : comp.duration;
      if (!on || T < st || T >= en || livePlay.rate !== 1) { if (!el.paused) el.pause(); continue; }
      let lt = (T - st) * tm.rate + tm.from;
      if (tm.loop && isFinite(el.duration) && el.duration > tm.from) lt = tm.from + ((lt - tm.from) % (el.duration - tm.from));
      let vol = tm.volume * keysAt(tm.volumeKeys, T - st);
      if (tm.fadeIn > 0) vol *= Math.min(1, (T - st) / tm.fadeIn);
      if (tm.fadeOut > 0) vol *= Math.min(1, (en - T) / tm.fadeOut);
      if (tm.duck != null && (timings.some((o) => o !== x && o.tm.duck == null && sounding(o)) || videos.some((v) => !v.timing.muted && T >= v.timing.start && T < v.timing.end))) vol *= tm.duck;
      el.volume = Math.max(0, Math.min(1, vol * livePlay.volume));
      el.muted = livePlay.muted;
      el.playbackRate = tm.rate;
      if (Math.abs(el.currentTime - lt) > 0.15) { try { el.currentTime = lt; } catch (e) {} }
      if (el.paused) el.play().catch(() => {});
    }
    for (const v of videos) { if (!v.bg) { v.el.muted = livePlay.muted || v.timing.muted; v.el.volume = Math.max(0, Math.min(1, (v.timing.volume ?? 1) * livePlay.volume)); if (!on) v.el.pause(); } }
  }
  // Same-origin pages can call mw directly; cross-origin embeds talk with postMessage.
  if (MODE === 'preview') {
    window.addEventListener('message', async (e) => {
      const m = e.data;
      if (!m || typeof m !== 'object' || !m.mw) return;
      const reply = (x) => { try { e.source && e.source.postMessage(Object.assign({ mwReply: m.id }, x), '*'); } catch (er) {} };
      try {
        if (m.mw === 'ready') reply({ info: await ready() });
        else if (m.mw === 'seek') { let r = seek(m.t); if (r && r.then) r = await r; if (m.playing != null) syncMedia(m.playing, m.t, m); reply({ t: m.t }); }
        else if (m.mw === 'media') { syncMedia(m.playing, m.t, m); reply({}); }
      } catch (er) { reply({ error: String(er && er.message || er) }); }
    });
  }

  // ---------------------------------------------------------------------------
  // Images: wait for newly shown images to decode before a frame is captured.
  // ---------------------------------------------------------------------------
  function waitImages() {
    for (const img of document.images) {
      if (!img.complete) pendingWaits.push(new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', () => { report('error', 'image-failed', `Image failed to load: ${img.getAttribute('src')}`, img, 'Check the path (relative to the HTML file).'); res(); }, { once: true }); }));
    }
  }

  // ---------------------------------------------------------------------------
  // Frame callbacks
  // ---------------------------------------------------------------------------
  const frameFns = [];
  const layoutFns = []; // run after every animation is placed: safe to measure positions
  function info(T) {
    return { time: T, frame: Math.round(T * comp.fps), fps: comp.fps, duration: comp.duration, progress: comp.duration ? T / comp.duration : 0, width: comp.width, height: comp.height };
  }
  function runFrameFns(T, list = frameFns) {
    if (!list.length) return false;
    inFrameCallbacks = true;
    let ran = false;
    for (const f of list) {
      try {
        if (f.el) {
          const c = nearestClip(f.el);
          const s = c ? c.start : 0, e = c ? c.end : comp.duration;
          const vis = hasRemap && c && c.outer.length ? applyChain(c.outer, T) : T;
          if (vis < s || vis >= e) continue;
          const tt = hasRemap ? mapT(f.el, T) : T;
          ran = true;
          f.fn(tt - s, Object.assign(info(T), { local: tt - s, clipDuration: e - s }));
        } else { ran = true; f.fn(T, info(T)); }
      } catch (e) { pageError(e); }
    }
    flushAnimations(T, 'event');
    inFrameCallbacks = false;
    return ran;
  }

  // ---------------------------------------------------------------------------
  // Mutation tracking → static-frame detection
  // ---------------------------------------------------------------------------
  let mutated = true;
  const CLIP_SEL = '[data-start],[data-duration],[data-end],[data-sequence]';
  function handleRecords(recs) {
    for (const r of recs) {
      mutated = true;
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches(CLIP_SEL) || n.querySelector(CLIP_SEL) || (n.parentElement && n.parentElement.hasAttribute('data-sequence')))) timelineDirty = true;
      } else if (r.type === 'attributes' && /^data-(start|duration|end|sequence|transition|gap|cuts|cut-align)$/.test(r.attributeName)) timelineDirty = true;
    }
  }
  const mo = new MutationObserver(handleRecords);
  // Discard mutations the runtime made itself.
  function dropOwnMutations() { mo.takeRecords(); }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  let readyPromise = null;
  const waits = [];
  const hooks = { preinit: [], init: [], seek: [], post: [], rebuild: [] };
  let initialized = false;

  function setStageVars() {
    root.style.setProperty('--stage-w', comp.width + 'px');
    root.style.setProperty('--stage-h', comp.height + 'px');
    root.style.setProperty('--px', PX() + 'px');
    root.style.setProperty('--stage-px', PX());
  }

  function readSettings() {
    const w = parseInt(rootAttr('width') || '', 10), h = parseInt(rootAttr('height') || '', 10);
    if (w > 0) comp.width = w; if (h > 0) comp.height = h;
    const f = parseFloat(rootAttr('fps') || '');
    if (f > 0) comp.fps = f;
    FPS = comp.fps;
    const bg = rootAttr('background');
    if (bg) comp.background = bg;
    if (CONFIG.width) comp.width = CONFIG.width;
    if (CONFIG.height) comp.height = CONFIG.height;
    if (CONFIG.fps) { comp.fps = CONFIG.fps; FPS = comp.fps; }
    setStageVars();
    if (comp.width % 2 || comp.height % 2) report('warning', 'odd-size', `Size ${comp.width}x${comp.height} has an odd number; most video codecs need even sizes.`, null, 'Use even width and height, e.g. 1920x1080.');
  }

  function init() {
    if (initialized) return;
    initialized = true;
    readSettings();
    applyBindings();
    for (const h of hooks.preinit) { try { h(); } catch (e) { pageError(e); } }
    applySplit();
    buildTimeline();
    setupVideos();
    setupCountersAndTypers();
    applyEnterExit();
    for (const h of hooks.init) { try { h(); } catch (e) { pageError(e); } }
    { const md = document.getElementById('mw-missing-data'); if (md) { try { const j = JSON.parse(md.textContent); report('warning', 'data-missing', (j.keys.length === 1 ? '{{data.' + j.keys[0] + '}} is' : j.keys.slice(0, 5).map((k) => '{{data.' + k + '}}').join(', ') + (j.keys.length > 5 ? ' and ' + (j.keys.length - 5) + ' more are' : ' are')) + ' empty: ' + (j.noData ? 'no data was given.' : 'the data has no value there.'), null, j.noData ? 'Pass --data data.json (or --props \'{...}\'), or put a data.json next to the HTML, or add <script type="application/json" id="mw-data">{...}</script> with default data, or write {{data.title|Default text}}.' : 'Check the path, or give a default: {{data.title|Default text}}.'); } catch (e) {} } }
    for (const el of document.querySelectorAll('[data-mw-include-error]')) report('error', 'include-not-found', `<mw-include src="${el.getAttribute('data-mw-include-error')}"> was not found.`, null, 'The path is relative to the HTML file that contains the include. Check the spelling, or run `npx motionwright add <block>` to copy a block into ./blocks.');
    if (comp.background && !document.body.style.background) document.body.style.background = comp.background;
    for (const a of preInit) { const tg = targetOf(a); origin.set(a, tg ? clipStartOf(tg) : 0); }
    preInit.length = 0;
    flushAnimations(0, 'clip');
    pendingInit = false;
    if (!comp.duration) report('error', 'no-duration', 'The video has no length.', null, 'Add data-duration="8" to <html>, or give elements data-start/data-duration.');
    // Lint: things that look wrong
    for (const el of document.querySelectorAll('[data-sequence]')) {
      if (!el.children.length) report('warning', 'empty-sequence', 'data-sequence has no children.', el);
    }
    for (const el of document.querySelectorAll('audio')) {
      if (!el.getAttribute('src') && !el.querySelector('source')) report('error', 'audio-no-src', '<audio> has no src.', el);
    }
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
      // Fonts and images that are already in the page
      try { await document.fonts.ready; } catch (e) {}
      // Let user code register waits during load
      if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
      for (;;) {
        const w = waits.splice(0);
        if (!w.length) break;
        let done = false;
        const all = Promise.all(w.map((p) => Promise.resolve(p).catch((e) => pageError(e)))).finally(() => { done = true; });
        const pump = () => { if (done) return; loadPump(); real.setTimeout(pump, 4); };
        real.setTimeout(pump, 4);
        const limit = (CONFIG.loadTimeout || 30) * 1000;
        await Promise.race([all, new Promise((r) => real.setTimeout(r, limit))]);
        if (!done) { done = true; report('error', 'load-timeout', `Something passed to mw.wait() did not finish within ${limit / 1000}s.`, null, 'Check that every promise given to mw.wait() resolves (files exist, libraries load).'); }
      }
      try { await document.fonts.ready; } catch (e) {}
      init();
      // probe video durations (needed for looping)
      for (const v of videos) {
        if (CONFIG.videoDurations && CONFIG.videoDurations[v.src] != null) v.duration = CONFIG.videoDurations[v.src];
      }
      // Fonts used only by split text etc.
      try { await document.fonts.ready; } catch (e) {}
      return mw.inspect();
    })();
    return readyPromise;
  }

  // ---------------------------------------------------------------------------
  // seek(T) — the heart. Returns {dirty} synchronously when possible,
  // or a Promise when media must load.
  // ---------------------------------------------------------------------------
  let lastT = null;
  let frameIndex = 0;
  function seek(T) {
    if (!initialized) init();
    T = Math.max(0, Number(T) || 0);
    handleRecords(mo.takeRecords());
    if (timelineDirty) { buildTimeline(); applySplit(); setupVideos(); setupCountersAndTypers(); applyEnterExit(); for (const h of hooks.rebuild) { try { h(); } catch (e) { pageError(e); } } dropOwnMutations(); }
    let needsReload = false;
    if (lastT != null && T < lastT - 1e-9 && stateful) needsReload = true;
    // Step through intermediate frames for code that relies on requestAnimationFrame.
    // (Starting from frame 0 when this page has not rendered anything yet, so parallel
    // workers produce exactly the same frames as a single worker.)
    if (usedRAF && (lastT == null || T > lastT)) {
      const fps = comp.fps;
      const i0 = lastT == null ? 0 : Math.floor(lastT * fps + 1e-6) + 1;
      const i1 = Math.ceil(T * fps - 1e-6) - 1;
      for (let i = i0; i <= i1; i++) {
        const t = i / fps;
        runTimersUntil(t);
        now = t;
        runRAF(t);
      }
    }
    if (lastT == null || T >= lastT) runTimersUntil(T);
    now = T;
    handleRecords(mo.takeRecords());
    const visChanged = updateVisibility(T);
    dropOwnMutations();
    flushAnimations(T, 'clip');
    let hookChanged = false;
    for (const h of hooks.seek) { try { if (h(T)) hookChanged = true; } catch (e) { pageError(e); } }
    const ranFns = runFrameFns(T) || hookChanged;
    const hadRAF = rafs.size > 0;
    runRAF(T);
    if (hadRAF) flushAnimations(T, 'event');
    handleRecords(mo.takeRecords());
    const cChanged = updateCounters(T);
    const vChanged = updateVideos(T);
    dropOwnMutations();
    flushAnimations(T, 'clip');
    let animActive = seekAnimations(T);
    for (const h of hooks.post) { try { if (h(T)) animActive = true; } catch (e) { pageError(e); } }
    if (layoutFns.length && runFrameFns(T, layoutFns)) animActive = true;
    waitImages();
    const tChanged = lastT == null || Math.abs(T - lastT) > 1e-9;
    const dirty = tChanged && (lastT == null || visChanged || cChanged || vChanged || ranFns || hadRAF || animActive || mutated || activeBefore);
    activeBefore = animActive; // an animation that just finished still changes this frame vs the previous one
    mutated = false;
    lastT = T;
    frameIndex++;
    const result = { t: T, dirty: !!dirty, needsReload };
    if (pendingWaits.length) {
      const w = pendingWaits.splice(0);
      return Promise.all(w).then(() => document.fonts.ready).then(() => result);
    }
    if (document.fonts.status !== 'loaded') return document.fonts.ready.then(() => result);
    return result;
  }
  let activeBefore = true;

  // ---------------------------------------------------------------------------
  // Helpers for authors
  // ---------------------------------------------------------------------------
  function interpolate(t, input, output, opts = {}) {
    const ease = easing(opts.easing || 'linear');
    const clampL = opts.clamp !== false && opts.extrapolateLeft !== 'extend';
    const clampR = opts.clamp !== false && opts.extrapolateRight !== 'extend';
    if (input.length !== output.length) throw new Error('mw.interpolate: input and output need the same length');
    let i = 1;
    while (i < input.length - 1 && t > input[i]) i++;
    const a = input[i - 1], b = input[i];
    let p = b === a ? 1 : (t - a) / (b - a);
    if (clampL && p < 0) p = 0;
    if (clampR && p > 1) p = 1;
    const e = p >= 0 && p <= 1 ? ease(p) : p;
    const o0 = output[i - 1], o1 = output[i];
    if (typeof o0 === 'number') return o0 + (o1 - o0) * e;
    return mixColor(o0, o1, e);
  }
  function parseColor(c) {
    const m = /^#([0-9a-f]{3,8})$/i.exec(c);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    const r = /rgba?\(([^)]+)\)/.exec(c);
    if (r) { const p = r[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p[3] ?? 1]; }
    return [0, 0, 0, 1];
  }
  let colorMixer = null;
  function mixColor(a, b, p) {
    if (colorMixer) return colorMixer(a, b, p);
    const A = parseColor(a), B = parseColor(b);
    const v = A.map((x, i) => x + (B[i] - x) * p);
    return `rgba(${Math.round(v[0])}, ${Math.round(v[1])}, ${Math.round(v[2])}, ${round(v[3])})`;
  }
  function spring(t, opts = {}) {
    const from = opts.from ?? 0, to = opts.to ?? 1;
    return from + (to - from) * springFn(opts)(Math.max(0, t - (opts.delay || 0)));
  }
  // Smooth value noise (deterministic), handy for organic motion.
  function noise(x, seed = 0) {
    const h = (n) => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return h(i) * (1 - u) + h(i + 1) * u;
  }

  function inspect() {
    if (!initialized) init();
    return {
      width: comp.width, height: comp.height, fps: comp.fps, duration: comp.duration, background: comp.background,
      frames: Math.max(1, Math.round(comp.duration * comp.fps)),
      clips: clips.map((c) => ({ selector: selectorOf(c.el), start: round(c.start), end: round(isFinite(c.end) ? c.end : comp.duration), scene: !!(c.el.classList.contains('scene') || (c.el.parentElement && c.el.parentElement.hasAttribute('data-sequence'))) })),
      transitions: transitionList.slice(),
      cameraShots: mw.__cameraShots ? mw.__cameraShots().map((c) => ({ ...c, start: round(c.start), arrive: round(c.arrive), next: c.next == null ? null : round(c.next) })) : [],
      media: media(),
      usesRAF: usedRAF, frameCallbacks: frameFns.length,
      issues: issues.slice(),
    };
  }
  function media() {
    const out = [];
    for (const v of videos) out.push(Object.assign({ kind: 'video', src: v.src }, v.timing, { end: isFinite(v.timing.end) ? v.timing.end : comp.duration }));
    for (const a of document.querySelectorAll('audio')) {
      const src = a.getAttribute('src') || (a.querySelector('source') && a.querySelector('source').getAttribute('src'));
      if (!src) continue;
      const u = new URL(src, location.href);
      const tm = mediaTiming(a);
      out.push(Object.assign({ kind: 'audio', src: u.pathname + u.search }, tm, { end: isFinite(tm.end) ? tm.end : comp.duration }));
    }
    return out;
  }

  // Read size/fps from <html> right away so CSS (--px, --stage-w) and early scripts see the right values.
  try { readSettings(); } catch (e) {}

  const mw = {
    __runtime: true,
    get mode() { return MODE; },
    get time() { return now; },
    get width() { return comp.width; },
    get height() { return comp.height; },
    get fps() { return comp.fps; },
    get duration() { return comp.duration; },
    get px() { return PX(); },
    get data() { return getData(); },
    onFrame(a, b) {
      if (typeof a === 'function') frameFns.push({ fn: a });
      else if (a && typeof b === 'function') frameFns.push({ el: typeof a === 'string' ? document.querySelector(a) : a, fn: b });
      else throw new Error('mw.onFrame(fn) or mw.onFrame(element, fn)');
    },
    // Like onFrame, but runs after all animations are applied for this frame, so
    // getBoundingClientRect() returns where things really are. Use it to follow or aim at elements.
    onLayout(a, b) {
      if (typeof a === 'function') layoutFns.push({ fn: a });
      else if (a && typeof b === 'function') layoutFns.push({ el: typeof a === 'string' ? document.querySelector(a) : a, fn: b });
      else throw new Error('mw.onLayout(fn) or mw.onLayout(element, fn)');
    },
    wait(p) { waits.push(typeof p === 'function' ? p() : p); return p; },
    // Beat grid from <html data-bpm data-beat-offset data-bar-offset data-beats-per-bar> (printed by `motionwright audio`).
    beat(n = 0) { const g = beatGrid(); return g.offset + n * g.period; },
    bar(n = 0) { const g = beatGrid(); return g.barOffset + n * g.perBar * g.period; },
    timing(el) { if (typeof el === 'string') el = document.querySelector(el); if (!clips.length) { try { buildTimeline(); timelineDirty = true; } catch (e) {} } const c = nearestClip(el); return c ? { start: c.start, end: c.end, duration: c.end - c.start } : { start: 0, end: comp.duration, duration: comp.duration }; },
    interpolate, spring, noise, easing,
    ease: new Proxy({}, { get: (_, k) => easing(String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) }),
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, p) => a + (b - a) * p,
    // random('dot-3') → the same number in [0,1) every time for that seed (strings or numbers).
    // random() → next value of the page's seeded Math.random. rng(seed) → a generator function.
    random: (seed) => (seed === undefined || seed === null ? Math.random() : makeRandom(hashSeed(seed))()),
    rng: (seed) => makeRandom(hashSeed(seed ?? 1)),
    ready, seek, inspect,
    // internal
    __issues: () => issues.slice(),
    __report: report,
    __selector: selectorOf,
    __clips: () => clips,
    __nearestClip: nearestClip,
    __real: real,
    __stateful: () => stateful || usedRAF,
    __syncMedia: syncMedia,
    __setVideoDurations(map) { for (const v of videos) if (map[v.src] != null) v.duration = map[v.src]; },
  };
  // Shared internals for runtime extensions (motion.js, audio.js). Not a public API.
  mw.__internal = {
    hooks, comp, real, PX, report, pageError, parseTime, easing, cssEasing, isEasingName, normEase,
    nearestClip, clipStartOf, clipEndOf, mapT, addOwn, selectorOf, makeRandom, parseColor, mixColor, info,
    morphPairs: () => morphPairs,
    addOwnAnim(a, originTime) { ownAnim.add(a); origin.set(a, originTime); known.add(a); },
    setColorMixer(fn) { colorMixer = fn; }, clips: () => clips, waits, pendingWaits, MODE, CONFIG, SKIP_TAGS,
    get now() { return now; }, get initialized() { return initialized; },
  };
  window.mw = mw;
  window.motionwright = mw;
})();
