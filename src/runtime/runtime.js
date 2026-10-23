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
    timers.set(id, { due: now + delay, fn, args, interval: interval ? Math.max(delay, 0.001) : 0, seq: timerSeq++ });
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
    'in-quad': [0.11, 0, 0.5, 0], 'out-quad': [0.5, 1, 0.89, 1], 'in-out-quad': [0.45, 0, 0.55, 1],
    'in-cubic': [0.32, 0, 0.67, 0], 'out-cubic': [0.33, 1, 0.68, 1], 'in-out-cubic': [0.65, 0, 0.35, 1],
    'out-quart': [0.25, 1, 0.5, 1], 'in-out-quart': [0.76, 0, 0.24, 1],
    'in-expo': [0.7, 0, 0.84, 0], 'out-expo': [0.16, 1, 0.3, 1], 'in-out-expo': [0.87, 0, 0.13, 1],
    'out-circ': [0, 0.55, 0.45, 1], 'in-back': [0.36, 0, 0.66, -0.56], 'out-back': [0.34, 1.56, 0.64, 1], 'in-out-back': [0.68, -0.6, 0.32, 1.6],
  };
  const SPRINGS = { spring: { stiffness: 170, damping: 26, T: 0.71 }, bouncy: { stiffness: 180, damping: 12, T: 1.14 }, snappy: { stiffness: 400, damping: 30, T: 0.4 }, gentle: { stiffness: 120, damping: 20, T: 0.58 } };
  const easeCache = new Map();
  function easing(name) {
    if (typeof name === 'function') return name;
    name = String(name || 'linear').replace(/^ease-(?=(in|out|spring|bouncy|snappy|gentle))/, '');
    if (easeCache.has(name)) return easeCache.get(name);
    let fn;
    if (BEZ[name]) fn = cubicBezier(...BEZ[name]);
    else if (SPRINGS[name]) { const s = SPRINGS[name], f = springFn(s); fn = (x) => (x >= 1 ? 1 : f(x * s.T)); }
    else { const m = /cubic-bezier\(([^)]+)\)/.exec(name); fn = m ? cubicBezier(...m[1].split(',').map(Number)) : cubicBezier(...BEZ.linear); }
    easeCache.set(name, fn);
    return fn;
  }
  function cssEasing(name) {
    name = String(name || 'out-expo').replace(/^ease-(?=(in|out|spring|bouncy|snappy|gentle))/, '');
    if (BEZ[name]) return 'cubic-bezier(' + BEZ[name].join(',') + ')';
    if (SPRINGS[name]) return 'var(--ease-' + name + ')';
    return name;
  }
  function isEasingName(tok) {
    const n = tok.replace(/^ease-(?=(in|out|spring|bouncy|snappy|gentle))/, '');
    return !!(BEZ[n] || SPRINGS[n] || /^cubic-bezier\(/.test(tok) || /^linear\(/.test(tok));
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
    'slide-left': { enter: 'slide-left', exit: 'slide-left' },
    'slide-right': { enter: 'slide-right', exit: 'slide-right' },
    'slide-up': { enter: 'slide-up', exit: 'slide-up' },
    'slide-down': { enter: 'slide-down', exit: 'slide-down' },
    'wipe-left': { enter: 'wipe-left' }, 'wipe-right': { enter: 'wipe-right' }, 'wipe-up': { enter: 'wipe-up' }, 'wipe-down': { enter: 'wipe-down' },
    'zoom': { enter: 'zoom', exit: 'fade' },
    'blur': { enter: 'blur' },
    'iris': { enter: 'iris' },
    'fade-up': { enter: 'fade-up', exit: 'fade-up' },
  };
  let clips = []; // {el, start, end, parent}
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

  function buildTimeline() {
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
    // Apply sequence transitions to children that do not define their own enter/exit.
    for (const [container, lay] of seqCache) {
      const kids = [...lay.map.keys()];
      kids.forEach((k, i) => {
        const t = lay.trs[i];
        if (!t) return;
        const def = TRANSITIONS[t.name];
        const tail = `${t.dur}s${t.ease ? ' ' + t.ease : ''}`;
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

  function nearestClip(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const c = clipOf.get(cur);
      if (c) return c;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return null;
  }
  function clipStartOf(el) { const c = nearestClip(el); return c ? c.start : 0; }
  function clipEndOf(el) { const c = nearestClip(el); return c ? c.end : comp.duration; }

  let lastVisible = '';
  function updateVisibility(T) {
    let sig = '';
    for (const c of clips) {
      const on = T >= c.start - 1e-9 && T < c.end - 1e-9;
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
        a.currentTime = (T - o) * 1000 * rate;
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
  const PX = () => comp.height / 1080;
  const PRESETS = {
    'fade': () => [{ opacity: 0 }, { opacity: 1 }],
    'fade-up': () => [{ opacity: 0, translate: `0 ${48 * PX()}px` }, { opacity: 1, translate: '0 0' }],
    'fade-down': () => [{ opacity: 0, translate: `0 ${-48 * PX()}px` }, { opacity: 1, translate: '0 0' }],
    'fade-left': () => [{ opacity: 0, translate: `${48 * PX()}px 0` }, { opacity: 1, translate: '0 0' }],
    'fade-right': () => [{ opacity: 0, translate: `${-48 * PX()}px 0` }, { opacity: 1, translate: '0 0' }],
    'rise': () => [{ opacity: 0, translate: `0 ${90 * PX()}px`, filter: `blur(${10 * PX()}px)` }, { opacity: 1, translate: '0 0', filter: 'blur(0px)' }],
    'scale': () => [{ opacity: 0, scale: '0.85' }, { opacity: 1, scale: '1' }],
    'pop': () => [{ opacity: 0, scale: '0.4', offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1, scale: '1', offset: 1 }],
    'zoom': () => [{ opacity: 0, scale: '1.25' }, { opacity: 1, scale: '1' }],
    'blur': () => [{ opacity: 0, filter: `blur(${18 * PX()}px)` }, { opacity: 1, filter: 'blur(0px)' }],
    'slide-up': () => [{ translate: '0 100%' }, { translate: '0 0' }],
    'slide-down': () => [{ translate: '0 -100%' }, { translate: '0 0' }],
    'slide-left': () => [{ translate: '100% 0' }, { translate: '0 0' }],
    'slide-right': () => [{ translate: '-100% 0' }, { translate: '0 0' }],
    'wipe-right': () => [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
    'wipe-left': () => [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)' }],
    'wipe-down': () => [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }],
    'wipe-up': () => [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)' }],
    'iris': () => [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }],
    'draw': () => [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
    'none': () => null,
  };
  // Exit motion keeps going in the named direction (fade-up exit moves up).
  const EXIT_PRESETS = {
    'fade': () => [{ opacity: 1 }, { opacity: 0 }],
    'fade-up': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${-48 * PX()}px` }],
    'fade-down': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${48 * PX()}px` }],
    'fade-left': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `${-48 * PX()}px 0` }],
    'fade-right': () => [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `${48 * PX()}px 0` }],
    'rise': () => [{ opacity: 1, translate: '0 0', filter: 'blur(0px)' }, { opacity: 0, translate: `0 ${-90 * PX()}px`, filter: `blur(${10 * PX()}px)` }],
    'scale': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.85' }],
    'pop': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.4' }],
    'zoom': () => [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.25' }],
    'blur': () => [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: `blur(${18 * PX()}px)` }],
    'slide-up': () => [{ translate: '0 0' }, { translate: '0 -100%' }],
    'slide-down': () => [{ translate: '0 0' }, { translate: '0 100%' }],
    'slide-left': () => [{ translate: '0 0' }, { translate: '-100% 0' }],
    'slide-right': () => [{ translate: '0 0' }, { translate: '100% 0' }],
    'wipe-right': () => [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }],
    'wipe-left': () => [{ clipPath: 'inset(0 0% 0 0)' }, { clipPath: 'inset(0 100% 0 0)' }],
    'wipe-down': () => [{ clipPath: 'inset(0% 0 0 0)' }, { clipPath: 'inset(100% 0 0 0)' }],
    'wipe-up': () => [{ clipPath: 'inset(0 0 0% 0)' }, { clipPath: 'inset(0 0 100% 0)' }],
    'iris': () => [{ clipPath: 'circle(75% at 50% 50%)' }, { clipPath: 'circle(0% at 50% 50%)' }],
    'draw': () => [{ strokeDasharray: '1 1', strokeDashoffset: 0 }, { strokeDasharray: '1 1', strokeDashoffset: -1 }],
    'none': () => null,
  };
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
          const m = parseMotion(en, el, 'data-enter', 0.6, 'out-expo');
          if (!PRESETS[m.name]) { report('error', 'bad-enter', `Unknown data-enter "${m.name}".`, el, 'Use one of: ' + Object.keys(PRESETS).join(', ')); }
          else {
            if (m.name === 'draw') prepDraw(tg);
            const kf = PRESETS[m.name]();
            if (kf) addOwn(tg, kf, { duration: m.dur * 1000, delay: (m.delay + extra) * 1000, easing: cssEasing(m.ease), fill: 'backwards' }, cStart);
          }
        }
        if (ex) {
          const m = parseMotion(ex, el, 'data-exit', 0.45, 'in-cubic');
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
          w.className = 'word';
          w.style.setProperty('--i', String(wi));
          w.style.setProperty('--wi', String(wi++));
          if (mode === 'chars') {
            for (const ch of Array.from(p)) {
              const c = document.createElement('span');
              c.className = 'char';
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
    const s = v.toFixed(decimals);
    if (!group) return s;
    const [i, f] = s.split('.');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  function updateCounters(T) {
    let changed = false;
    for (const c of counters) {
      const lt = T - clipStartOf(c.el) - c.delay;
      const p = c.dur > 0 ? Math.min(1, Math.max(0, lt / c.dur)) : 1;
      const v = c.from + (c.to - c.from) * c.ease(p);
      const txt = c.prefix + fmtNumber(v, c.decimals, c.group) + c.suffix;
      if (txt !== c.last) { c.el.textContent = txt; c.last = txt; changed = true; }
    }
    for (const ty of typers) {
      const lt = T - clipStartOf(ty.el) - ty.delay;
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
      volume: el.hasAttribute('data-volume') ? parseFloat(el.getAttribute('data-volume')) : 1,
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
      if (T < tm.start || T >= tm.end) continue;
      const lt = videoTimeAt(v, T);
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
  function info(T) {
    return { time: T, frame: Math.round(T * comp.fps), fps: comp.fps, duration: comp.duration, progress: comp.duration ? T / comp.duration : 0, width: comp.width, height: comp.height };
  }
  function runFrameFns(T) {
    if (!frameFns.length) return false;
    inFrameCallbacks = true;
    let ran = false;
    for (const f of frameFns) {
      try {
        if (f.el) {
          const c = nearestClip(f.el);
          const s = c ? c.start : 0, e = c ? c.end : comp.duration;
          if (T < s || T >= e) continue;
          ran = true;
          f.fn(T - s, Object.assign(info(T), { local: T - s, clipDuration: e - s }));
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
      } else if (r.type === 'attributes' && /^data-(start|duration|end|sequence|transition|gap)$/.test(r.attributeName)) timelineDirty = true;
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
  let initialized = false;

  function setStageVars() {
    root.style.setProperty('--stage-w', comp.width + 'px');
    root.style.setProperty('--stage-h', comp.height + 'px');
    root.style.setProperty('--px', (comp.height / 1080) + 'px');
    root.style.setProperty('--stage-px', (comp.height / 1080));
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
    applySplit();
    buildTimeline();
    setupVideos();
    setupCountersAndTypers();
    applyEnterExit();
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
        await Promise.all(w.map((p) => Promise.resolve(p).catch((e) => pageError(e))));
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
    if (timelineDirty) { buildTimeline(); applySplit(); setupVideos(); setupCountersAndTypers(); applyEnterExit(); dropOwnMutations(); }
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
    const ranFns = runFrameFns(T);
    const hadRAF = rafs.size > 0;
    runRAF(T);
    if (hadRAF) flushAnimations(T, 'event');
    handleRecords(mo.takeRecords());
    const cChanged = updateCounters(T);
    const vChanged = updateVideos(T);
    dropOwnMutations();
    flushAnimations(T, 'clip');
    const animActive = seekAnimations(T);
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
  function mixColor(a, b, p) {
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
      clips: clips.map((c) => ({ selector: selectorOf(c.el), start: round(c.start), end: round(isFinite(c.end) ? c.end : comp.duration) })),
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
    get data() { return getData(); },
    onFrame(a, b) {
      if (typeof a === 'function') frameFns.push({ fn: a });
      else if (a && typeof b === 'function') frameFns.push({ el: typeof a === 'string' ? document.querySelector(a) : a, fn: b });
      else throw new Error('mw.onFrame(fn) or mw.onFrame(element, fn)');
    },
    wait(p) { waits.push(typeof p === 'function' ? p() : p); return p; },
    timing(el) { if (typeof el === 'string') el = document.querySelector(el); const c = nearestClip(el); return c ? { start: c.start, end: c.end, duration: c.end - c.start } : { start: 0, end: comp.duration, duration: comp.duration }; },
    interpolate, spring, noise, easing,
    ease: new Proxy({}, { get: (_, k) => easing(String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) }),
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, p) => a + (b - a) * p,
    random: makeRandom,
    ready, seek, inspect,
    // internal
    __issues: () => issues.slice(),
    __report: report,
    __selector: selectorOf,
    __clips: () => clips,
    __nearestClip: nearestClip,
    __real: real,
    __stateful: () => stateful || usedRAF,
    __setVideoDurations(map) { for (const v of videos) if (map[v.src] != null) v.duration = map[v.src]; },
  };
  window.mw = mw;
  window.motionwright = mw;
})();
