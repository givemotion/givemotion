/* motionwright motion tools: mw.timeline (seekable tweens), paths, shapes, camera moves,
 * shared-element morphs, fit-to-box text and scramble text. MIT License.
 * Everything here is a pure function of time, so any frame can be rendered in any order.
 */
(function () {
  'use strict';
  const mw = window.mw;
  if (!mw || !mw.__internal || mw.timeline) return;
  const I = mw.__internal;
  const PX = I.PX;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const r4 = (x) => Math.round(x * 10000) / 10000;

  // ---------------------------------------------------------------------------
  // Colors: parse any CSS color, mix in OKLab (no muddy grey midpoints)
  // ---------------------------------------------------------------------------
  const colorCache = new Map();
  let cctx = null;
  function toRGBA(str) {
    if (Array.isArray(str)) return str;
    str = String(str).trim();
    if (colorCache.has(str)) return colorCache.get(str);
    let out = null, m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(str))) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(str))) {
      const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = [+m[1], +m[2], +m[3], a];
    } else if (str === 'transparent') out = [0, 0, 0, 0];
    else if (typeof CSS !== 'undefined' && CSS.supports('color', str)) {
      if (!cctx) { const c = document.createElement('canvas'); c.width = c.height = 1; cctx = c.getContext('2d', { willReadFrequently: true }); }
      cctx.clearRect(0, 0, 1, 1);
      cctx.fillStyle = '#000';
      cctx.fillStyle = str;
      // Read alpha exactly from the serialized style when possible, rgb from a painted pixel.
      cctx.globalAlpha = 1;
      cctx.fillRect(0, 0, 1, 1);
      const d = cctx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    colorCache.set(str, out);
    return out;
  }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const unlin = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };
  function toLab(c) {
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromLab(L) {
    const l = (L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2]) ** 3;
    const m = (L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2]) ** 3;
    const s = (L[0] - 0.0894841775 * L[1] - 1.291485548 * L[2]) ** 3;
    return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function mixRGBA(A, B, p) {
    // A fully transparent end takes the other end's hue, so fades do not pass through black.
    if (A[3] === 0 && B[3] > 0) A = [B[0], B[1], B[2], 0];
    if (B[3] === 0 && A[3] > 0) B = [A[0], A[1], A[2], 0];
    const la = toLab(A), lb = toLab(B);
    const rgb = fromLab([la[0] + (lb[0] - la[0]) * p, la[1] + (lb[1] - la[1]) * p, la[2] + (lb[2] - la[2]) * p]);
    const a = r4(A[3] + (B[3] - A[3]) * p);
    return a >= 1 ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  }
  function mixColor(a, b, p) { const A = toRGBA(a), B = toRGBA(b); return A && B ? mixRGBA(A, B, p) : (p < 0.5 ? a : b); }

  // ---------------------------------------------------------------------------
  // Value interpolation: numbers, strings with numbers and colors inside
  // ---------------------------------------------------------------------------
  const COLOR_SRC = '#[0-9a-fA-F]{3,8}\\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\)|\\b(?:transparent|white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|lime|navy|teal|gold|silver)\\b';
  const NUM_SRC = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:e[-+]?\\d+)?';
  const TOK = new RegExp(COLOR_SRC + '|' + NUM_SRC, 'gi');
  function tokenize(s) {
    s = String(s);
    const lits = [], vals = [];
    let last = 0;
    for (const m of s.matchAll(TOK)) {
      const txt = m[0];
      // a number glued to letters before it is part of a name (e.g. "h1"), not a value
      if (/^[-+.\d]/.test(txt) && m.index > 0 && /[a-zA-Z_]/.test(s[m.index - 1]) && !/[-+]/.test(txt[0])) continue;
      lits.push(s.slice(last, m.index));
      vals.push(/^[-+.\d]/.test(txt) ? parseFloat(txt) : (toRGBA(txt) || txt));
      last = m.index + txt.length;
    }
    lits.push(s.slice(last));
    return { lits, vals };
  }
  function sameShape(A, B) {
    if (A.vals.length !== B.vals.length || A.lits.length !== B.lits.length) return false;
    for (let i = 0; i < A.lits.length; i++) if (A.lits[i] !== B.lits[i]) return false;
    for (let i = 0; i < A.vals.length; i++) if (typeof A.vals[i] !== typeof B.vals[i]) return false;
    return true;
  }
  function interpTokens(A, B) {
    return (p) => {
      let out = A.lits[0];
      for (let i = 0; i < A.vals.length; i++) {
        const a = A.vals[i], b = B.vals[i];
        out += (typeof a === 'number' ? String(r4(a + (b - a) * p)) : mixRGBA(a, b, p)) + A.lits[i + 1];
      }
      return out;
    };
  }
  const FILTER_ID = { blur: '0px', brightness: '1', contrast: '1', grayscale: '0', 'hue-rotate': '0deg', invert: '0', opacity: '1', saturate: '1', sepia: '0', 'drop-shadow': '0px 0px 0px transparent' };
  function identityFilter(to) {
    return String(to).replace(/([a-z-]+)\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, (all, fn) => (FILTER_ID[fn] != null ? `${fn}(${FILTER_ID[fn]})` : all));
  }
  // Let the browser interpolate anything it knows how to (transforms, clip-path, mixed units),
  // sampled once up front, so seeking stays cheap.
  let helperEl = null;
  function browserInterp(prop, from, to) {
    if (!helperEl) { helperEl = document.createElement('div'); helperEl.setAttribute('data-mw-internal', ''); helperEl.style.cssText = 'position:absolute;left:-99999px;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none'; document.body.appendChild(helperEl); }
    let a;
    try { a = I.real.animate.call(helperEl, [{ [prop]: from }, { [prop]: to }], { duration: 1000, fill: 'both' }); } catch (e) { return null; }
    a.pause();
    const N = 32, samples = [];
    const kebab = prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    for (let k = 0; k <= N; k++) { a.currentTime = (k / N) * 1000; samples.push(getComputedStyle(helperEl).getPropertyValue(kebab)); }
    a.cancel();
    if (samples[0] === samples[N] && String(from) !== String(to)) return null; // not interpolable
    const toks = samples.map(tokenize);
    return (p) => {
      if (p <= 0) return samples[0];
      if (p >= 1) return samples[N];
      const f = p * N, i = Math.floor(f);
      const A = toks[i], B = toks[i + 1];
      return sameShape(A, B) ? interpTokens(A, B)(f - i) : samples[Math.round(f)];
    };
  }
  function makeInterp(from, to, prop) {
    if (typeof from === 'number' && typeof to === 'number') return (p) => from + (to - from) * p;
    const fs = String(from), ts = String(to);
    if (fs === ts) return () => from;
    let A = tokenize(fs), B = tokenize(ts);
    if (prop === 'filter' || prop === 'backdropFilter') {
      if (fs === 'none') A = tokenize(identityFilter(ts));
      if (ts === 'none') B = tokenize(identityFilter(fs));
    }
    if (sameShape(A, B)) return interpTokens(A, B);
    const ca = toRGBA(fs), cb = ca && toRGBA(ts);
    if (ca && cb) return (p) => mixRGBA(ca, cb, p);
    if (prop && !prop.startsWith('--') && /^[a-zA-Z]+$/.test(prop)) {
      const bi = browserInterp(prop, fs, ts);
      if (bi) return bi;
    }
    return (p) => (p < 0.5 ? from : to); // not interpolable: switch halfway (like CSS)
  }

  // ---------------------------------------------------------------------------
  // Paths and shapes
  // ---------------------------------------------------------------------------
  let measSvg = null;
  function pathEl(d) {
    if (d && d.nodeType === 1) d = d.getAttribute('d');
    if (!measSvg) { measSvg = document.createElementNS(SVGNS, 'svg'); }
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d || 'M0 0');
    return p;
  }
  const lenCache = new Map();
  function pathInfo(d) {
    if (d && d.nodeType === 1) d = d.getAttribute('d');
    let pi = lenCache.get(d);
    if (!pi) { const el = pathEl(d); pi = { el, len: el.getTotalLength() }; lenCache.set(d, pi); }
    return pi;
  }
  function pointAt(d, p) {
    const { el, len } = pathInfo(d);
    const L = Math.max(0, Math.min(1, p)) * len;
    const a = el.getPointAtLength(L), b = el.getPointAtLength(Math.min(len, L + 0.5)), c = el.getPointAtLength(Math.max(0, L - 0.5));
    return { x: a.x, y: a.y, angle: (Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI };
  }
  function samplePoly(d, n) {
    const el = pathEl(d), len = el.getTotalLength(), pts = [];
    for (let i = 0; i < n; i++) { const q = el.getPointAtLength((i / n) * len); pts.push([q.x, q.y]); }
    return pts;
  }
  function area(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
  function splitSub(d) { return String(d).trim().split(/(?=M)/).map((s) => s.trim()).filter(Boolean); }
  function morphInterp(dA, dB) {
    if (dA && dA.nodeType === 1) dA = dA.getAttribute('d');
    if (dB && dB.nodeType === 1) dB = dB.getAttribute('d');
    const A = tokenize(dA), B = tokenize(dB);
    if (sameShape(A, B)) return interpTokens(A, B); // same commands: exact
    const sa = splitSub(dA), sb = splitSub(dB);
    const relative = /m/.test(dA.slice(1)) || /m/.test(dB.slice(1));
    const subsA = relative ? [dA] : sa, subsB = relative ? [dB] : sb;
    const n = Math.max(subsA.length, subsB.length);
    const pairs = [];
    for (let k = 0; k < n; k++) {
      const a = subsA[k], b = subsB[k];
      const la = a ? pathInfo(a).len : 0, lb = b ? pathInfo(b).len : 0;
      const N = Math.max(24, Math.min(360, Math.round(Math.max(la, lb) / 3)));
      let pa = a ? samplePoly(a, N) : null, pb = b ? samplePoly(b, N) : null;
      if (!pa) { const c = centroid(pb); pa = pb.map(() => c.slice()); }
      if (!pb) { const c = centroid(pa); pb = pa.map(() => c.slice()); }
      const closed = /z\s*$/i.test(a || '') || /z\s*$/i.test(b || '');
      if (closed) {
        if (Math.sign(area(pa)) !== Math.sign(area(pb)) && area(pa) !== 0 && area(pb) !== 0) pb.reverse();
        let best = 0, bestD = Infinity;
        const step = Math.max(1, Math.floor(N / 90));
        for (let off = 0; off < N; off += step) {
          let s = 0;
          for (let i = 0; i < N; i += 3) { const p = pa[i], q = pb[(i + off) % N]; s += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; }
          if (s < bestD) { bestD = s; best = off; }
        }
        pb = pb.map((_, i) => pb[(i + best) % N]);
      }
      pairs.push({ pa, pb, closed });
    }
    return (p) => pairs.map(({ pa, pb, closed }) => 'M' + pa.map((q, i) => r4(q[0] + (pb[i][0] - q[0]) * p) + ' ' + r4(q[1] + (pb[i][1] - q[1]) * p)).join('L') + (closed ? 'Z' : '')).join(' ');
  }

  // Shape generators: all return SVG path data centered on (cx, cy).
  function polyPath(pts, closed = true) { return 'M' + pts.map((p) => r4(p[0]) + ' ' + r4(p[1])).join('L') + (closed ? 'Z' : ''); }
  function smoothClosed(pts) {
    // Catmull-Rom through the points, as cubic Beziers
    const n = pts.length;
    let d = `M${r4(pts[0][0])} ${r4(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${r4(c1[0])} ${r4(c1[1])} ${r4(c2[0])} ${r4(c2[1])} ${r4(p2[0])} ${r4(p2[1])}`;
    }
    return d + 'Z';
  }
  const shape = {
    circle(r = 50, o = {}) { const { cx = 0, cy = 0 } = o; return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`; },
    ellipse(rx = 60, ry = 40, o = {}) { const { cx = 0, cy = 0 } = o; return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`; },
    rect(w = 100, h = 100, o = {}) {
      const { cx = 0, cy = 0 } = o; const r = Math.min(o.r || 0, w / 2, h / 2); const x = cx - w / 2, y = cy - h / 2;
      if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    },
    polygon(sides = 6, r = 50, o = {}) {
      const { cx = 0, cy = 0, rotation = 0 } = o; const pts = [];
      for (let i = 0; i < sides; i++) { const a = ((rotation - 90) * Math.PI) / 180 + (i / sides) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return polyPath(pts);
    },
    star(points = 5, outer = 50, inner, o = {}) {
      inner = inner ?? outer * 0.45; const { cx = 0, cy = 0, rotation = 0 } = o; const pts = [];
      for (let i = 0; i < points * 2; i++) { const r = i % 2 ? inner : outer; const a = ((rotation - 90) * Math.PI) / 180 + (i / (points * 2)) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return polyPath(pts);
    },
    heart(size = 100, o = {}) {
      const { cx = 0, cy = 0 } = o; const s = size / 100;
      const P = (x, y) => `${r4(cx + x * s)} ${r4(cy + y * s)}`;
      return `M${P(0, 35)}C${P(-45, 5)} ${P(-55, -30)} ${P(-28, -42)}C${P(-12, -48)} ${P(0, -38)} ${P(0, -24)}C${P(0, -38)} ${P(12, -48)} ${P(28, -42)}C${P(55, -30)} ${P(45, 5)} ${P(0, 35)}Z`;
    },
    // An organic blob. Animate it by passing t (seconds): mw.shape.blob(200, { t })
    blob(r = 100, o = {}) {
      const { cx = 0, cy = 0, points = 8, wobble = 0.22, seed = 1, t = 0, speed = 0.35 } = o; const pts = [];
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        const k = 1 + wobble * (mw.noise(t * speed + i * 1.7, seed + i * 13.1) * 2 - 1);
        pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
      }
      return smoothClosed(pts);
    },
    // A sine wave from x0 to x0+width (open path)
    wave(width = 400, o = {}) {
      const { x = 0, y = 0, amp = 30, freq = 2, phase = 0, steps = 96 } = o; const pts = [];
      for (let i = 0; i <= steps; i++) { const u = i / steps; pts.push([x + u * width, y + Math.sin(u * freq * Math.PI * 2 + phase) * amp]); }
      return polyPath(pts, false);
    },
    smooth: smoothClosed,
    poly: polyPath,
  };

  // ---------------------------------------------------------------------------
  // Timeline: GSAP-style API, but every value is computed from the time,
  // so frames can be rendered in any order and in parallel.
  // ---------------------------------------------------------------------------
  const TF = { x: 'px', y: 'px', z: 'px', xPercent: '%', yPercent: '%', rotate: 'deg', rotateX: 'deg', rotateY: 'deg', skewX: 'deg', skewY: 'deg', scale: '', scaleX: '', scaleY: '' };
  const ALIAS = { rotation: 'rotate', rotationX: 'rotateX', rotationY: 'rotateY', rotationZ: 'rotate', rotateZ: 'rotate', translateX: 'x', translateY: 'y', translateZ: 'z' };
  const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flexGrow', 'flexShrink', 'order', 'zoom', 'fillOpacity', 'strokeOpacity', 'stopOpacity', 'scale', 'aspectRatio', 'columnCount', 'orphans', 'widows', 'strokeMiterlimit']);
  const RESERVED = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'repeatDelay', 'onUpdate', 'onStart', 'onComplete', 'immediateRender', 'overwrite', 'id', 'paused', 'keyframes', 'yoyoEase', 'lazy', 'callbackScope', 'data', 'runBackwards', 'startAt', 'inherit']);
  const tlList = [];
  let tlSeq = 0;
  let initDone = false;

  function toArray(t, scope) {
    if (t == null) return [];
    if (typeof t === 'string') {
      const r = scope ? [...scope.querySelectorAll(t)] : [];
      return r.length ? r : [...document.querySelectorAll(t)];
    }
    if (t instanceof Element || t === window || !(Symbol.iterator in Object(t)) || typeof t.length !== 'number') return [t];
    return [...t].flatMap((x) => toArray(x, scope));
  }
  function staggerOffsets(st, n, rnd, targets) {
    if (typeof st === 'function') return new Array(n).fill(0).map((_, i) => +st(i, targets && targets[i], targets) || 0);
    if (st == null || n <= 1) return new Array(n).fill(0);
    const o = typeof st === 'object' ? st : { each: st };
    const each = o.amount != null ? o.amount / Math.max(1, n - 1) : (o.each || 0);
    const from = o.from ?? 'start';
    const order = new Array(n).fill(0).map((_, i) => {
      if (from === 'start') return i;
      if (from === 'end') return n - 1 - i;
      if (from === 'center') return Math.abs(i - (n - 1) / 2);
      if (from === 'edges') return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
      if (from === 'random') return rnd() * (n - 1);
      if (typeof from === 'number') return Math.abs(i - from);
      return i;
    });
    const max = Math.max(...order) || 1;
    const ez = o.ease ? mw.easing(o.ease) : null;
    return order.map((k) => (ez ? ez(k / max) * max : k) * each);
  }
  function evalVal(v, i, el, list, rnd) {
    if (typeof v === 'function') return v(i, el, list);
    if (typeof v === 'string') {
      const m = /^random\((.*)\)$/.exec(v.trim());
      if (m) {
        const arr = /^\[(.*)\]$/.exec(m[1].trim());
        if (arr) { const opts = arr[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')); const pick = opts[Math.floor(rnd() * opts.length)]; return isNaN(+pick) ? pick : +pick; }
        const [a, b, snap] = m[1].split(',').map(Number);
        let x = a + rnd() * (b - a);
        if (snap) x = Math.round(x / snap) * snap;
        return x;
      }
    }
    return v;
  }
  function flattenProps(vars) {
    const out = {};
    for (const k of Object.keys(vars)) {
      if (RESERVED.has(k)) continue;
      if (k === 'css' && vars.css && typeof vars.css === 'object') Object.assign(out, flattenProps(vars.css));
      else if (k === 'attr' && vars.attr && typeof vars.attr === 'object') for (const a of Object.keys(vars.attr)) out['attr:' + a] = vars.attr[a];
      else out[ALIAS[k] || k] = vars[k];
    }
    return out;
  }
  function decompose(el) {
    const base = { x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, scale: 1, scaleX: 1, scaleY: 1 };
    if (!el || !(el instanceof Element)) return base;
    const tf = el instanceof SVGElement && !(el instanceof SVGSVGElement) ? el.getAttribute('transform') && null : getComputedStyle(el).transform;
    if (!tf || tf === 'none') return base;
    const m = /matrix\(([^)]+)\)/.exec(tf);
    if (m) {
      const [a, b, c, d, e, f] = m[1].split(',').map(parseFloat);
      const sx = Math.hypot(a, b);
      const rot = Math.atan2(b, a);
      const det = a * d - b * c;
      const sy = sx ? det / sx : 0;
      const skew = sx ? Math.atan2(a * c + b * d, sx * sx) : 0;
      Object.assign(base, { x: e, y: f, rotate: (rot * 180) / Math.PI, skewX: (Math.atan(skew) * 180) / Math.PI * 0, scaleX: sx, scaleY: sy });
      return base;
    }
    const m3 = /matrix3d\(([^)]+)\)/.exec(tf);
    if (m3) { const v = m3[1].split(',').map(parseFloat); base.x = v[12]; base.y = v[13]; base.z = v[14]; }
    return base;
  }
  function kebab(p) { return p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }
  function readBase(el, prop, tfBase) {
    if (prop in TF) return tfBase[prop];
    if (!(el instanceof Element)) return el[prop];
    if (prop.startsWith('attr:')) { const v = el.getAttribute(prop.slice(5)); return v == null ? 0 : (isNaN(+v) ? v : +v); }
    if (prop === 'autoAlpha') return parseFloat(getComputedStyle(el).opacity);
    if (prop === 'draw') return el.__mwDraw ?? 1;
    if (prop === 'morph') return el.getAttribute('d') || '';
    if (prop === 'text') return el.textContent;
    if (prop === 'textContent' || prop === 'innerText') { const n = parseFloat(String(el.textContent).replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; }
    if (prop === 'transformPerspective') return 0;
    if (prop.startsWith('--')) return getComputedStyle(el).getPropertyValue(prop).trim();
    const v = getComputedStyle(el).getPropertyValue(kebab(prop));
    return v;
  }
  function normalizeEnd(prop, v, from) {
    // relative values "+=100" / "-=50"
    if (typeof v === 'string') {
      const m = /^([-+])=\s*([-+]?[\d.]+)(\D*)$/.exec(v.trim());
      if (m) { const base = parseFloat(from) || 0; const d = parseFloat(m[2]) * (m[1] === '-' ? -1 : 1); const unit = m[3] || unitOf(prop, from); return unit && !(prop in TF) ? (base + d) + unit : base + d; }
    }
    if (typeof v === 'number' && !(prop in TF) && !UNITLESS.has(prop) && !prop.startsWith('attr:') && !prop.startsWith('--') && !['autoAlpha', 'draw', 'textContent', 'innerText', 'transformPerspective'].includes(prop)) {
      if (typeof from === 'string' && /^-?[\d.]+(px)?$/.test(from.trim())) return v + 'px';
      if (typeof from !== 'number') return v + 'px';
    }
    if (prop in TF && typeof v === 'string') { const n = parseFloat(v); if (!isNaN(n) && /^-?[\d.]+(px|deg)?$/.test(v.trim())) return n; }
    return v;
  }
  function unitOf(prop, v) { const m = /[\d.]([a-z%]+)\s*$/i.exec(String(v)); return m ? m[1] : (prop in TF || UNITLESS.has(prop) ? '' : 'px'); }
  function coerceFrom(prop, from, to) {
    // make "from" comparable with "to": numbers stay numbers, "12px" → 12 when to is a number
    if (typeof to === 'number' && typeof from === 'string') { const n = parseFloat(from); if (!isNaN(n) && /^-?[\d.]+(px)?$/.test(from.trim())) return n; }
    if (typeof to === 'string' && typeof from === 'number' && /px$/.test(to)) return from + 'px';
    return from;
  }

  class Timeline {
    constructor(scope, opts) {
      if (scope && !(scope instanceof Element) && typeof scope === 'object' && !Array.isArray(scope)) { opts = scope; scope = opts.scope; }
      this.opts = Object.assign({}, opts || {});
      this.scopeSpec = scope || null;
      this.defaults = Object.assign({ duration: 0.5, ease: 'power1.out' }, this.opts.defaults || {});
      this.ops = [];
      this.built = false;
      this.id = tlSeq++;
      this.rnd = I.makeRandom(9973 + this.id * 7919);
      tlList.push(this);
    }
    get scope() { if (this._scope === undefined) this._scope = typeof this.scopeSpec === 'string' ? document.querySelector(this.scopeSpec) : this.scopeSpec; return this._scope; }
    _op(o) { this.ops.push(o); this.built = false; return this; }
    to(t, vars, pos) { return this._op({ type: 'to', t, a: null, b: vars || {}, pos }); }
    from(t, vars, pos) { return this._op({ type: 'from', t, a: vars || {}, b: null, pos }); }
    fromTo(t, a, b, pos) { return this._op({ type: 'fromTo', t, a: a || {}, b: b || {}, pos }); }
    set(t, vars, pos) { return this._op({ type: 'to', t, a: null, b: Object.assign({}, vars, { duration: 0 }), pos }); }
    addLabel(name, pos) { return this._op({ type: 'label', name, pos }); }
    label(name, pos) { return this.addLabel(name, pos); }
    add(x, pos) {
      if (typeof x === 'string') return this.addLabel(x, pos);
      if (x instanceof Timeline) { const i = tlList.indexOf(x); if (i >= 0) tlList.splice(i, 1); return this._op({ type: 'child', tl: x, pos }); }
      if (typeof x === 'function') return this.call(x, pos);
      return this;
    }
    // A callback that receives the timeline's local time every frame (pure: it must only depend on t).
    call(fn, pos) { return this._op({ type: 'call', fn, pos }); }
    duration() { this._build(); return this.total; }
    totalDuration() { return this.duration(); }
    _pos(pos, cursor) {
      if (pos == null) return cursor.end;
      if (typeof pos === 'number') return pos;
      const s = String(pos).trim();
      let m;
      if ((m = /^([<>])\s*([-+]=?)?\s*([\d.]+)?$/.exec(s))) {
        const base = m[1] === '<' ? cursor.prevStart : cursor.prevEnd;
        const n = m[3] ? parseFloat(m[3]) : 0;
        return base + (m[2] && m[2][0] === '-' ? -n : n);
      }
      if ((m = /^([-+])=\s*([\d.]+)$/.exec(s))) return cursor.end + (m[1] === '-' ? -1 : 1) * parseFloat(m[2]);
      if ((m = /^([\w-]+)\s*(?:([-+])=\s*([\d.]+))?$/.exec(s)) && this.labels[m[1]] != null) return this.labels[m[1]] + (m[2] ? (m[2] === '-' ? -1 : 1) * parseFloat(m[3]) : 0);
      if (!isNaN(parseFloat(s))) return parseFloat(s);
      I.report('warning', 'timeline-position', `Unknown timeline position "${pos}".`, null, 'Use a number, "<", ">", "+=0.5", "-=0.2" or a label name.');
      return cursor.end;
    }
    _build() {
      if (this.built) return;
      this.built = true;
      this.labels = {};
      this.items = [];
      this.calls = [];
      const cursor = { end: 0, prevStart: 0, prevEnd: 0 };
      let opIndex = 0;
      for (const op of this.ops) {
        opIndex++;
        if (op.type === 'label') { this.labels[op.name] = this._pos(op.pos, cursor); continue; }
        if (op.type === 'call') { const at = this._pos(op.pos, cursor); this.calls.push({ at, fn: op.fn }); cursor.prevStart = cursor.prevEnd = at; cursor.end = Math.max(cursor.end, at); continue; }
        if (op.type === 'child') {
          const ch = op.tl; ch._build();
          const at = this._pos(op.pos, cursor);
          for (const it of ch.items) this.items.push(Object.assign({}, it, { start: it.start + at, child: ch }));
          for (const c of ch.calls) this.calls.push({ at: c.at + at, fn: c.fn });
          cursor.prevStart = at; cursor.prevEnd = at + ch.total; cursor.end = Math.max(cursor.end, cursor.prevEnd);
          continue;
        }
        const timing = Object.assign({}, this.defaults, op.type === 'from' ? op.a : op.b);
        // keyframes: [{x:..}, {x:..}] → a chain of tweens
        if (Array.isArray(timing.keyframes) || (timing.keyframes && typeof timing.keyframes === 'object')) {
          const kfs = Array.isArray(timing.keyframes) ? timing.keyframes : (() => {
            const o = timing.keyframes, keys = Object.keys(o).filter((k) => Array.isArray(o[k]));
            const n = Math.max(...keys.map((k) => o[k].length));
            const total = timing.duration;
            return new Array(n - 1).fill(0).map((_, i) => Object.assign({ duration: total / (n - 1), ease: o.ease || timing.ease }, Object.fromEntries(keys.map((k) => [k, o[k][Math.min(i + 1, o[k].length - 1)]]))));
          })();
          const sub = new Timeline(this.scopeSpec, { defaults: Object.assign({}, this.defaults, { ease: timing.ease }) });
          tlList.splice(tlList.indexOf(sub), 1);
          if (!Array.isArray(timing.keyframes)) {
            const o = timing.keyframes; const first = {};
            for (const k of Object.keys(o)) if (Array.isArray(o[k])) first[k] = o[k][0];
            sub.set(op.t, first, 0);
          }
          for (const kf of kfs) sub.to(op.t, kf);
          sub._build();
          const at = this._pos(op.pos, cursor) + (timing.delay || 0);
          for (const it of sub.items) this.items.push(Object.assign({}, it, { start: it.start + at }));
          cursor.prevStart = at; cursor.prevEnd = at + sub.total; cursor.end = Math.max(cursor.end, cursor.prevEnd);
          continue;
        }
        const targets = toArray(op.t, this.scope);
        if (!targets.length) I.report('warning', 'timeline-no-target', `mw.timeline: "${typeof op.t === 'string' ? op.t : 'target'}" matched nothing.`, null, 'Check the selector. Targets are looked up when the video starts, inside the timeline scope if one was given.');
        const start = this._pos(op.pos, cursor) + (timing.delay || 0);
        const dur = Math.max(0, +timing.duration || 0);
        const rep = timing.repeat === -1 ? Infinity : Math.max(0, timing.repeat | 0);
        const rd = +timing.repeatDelay || 0;
        const offs = staggerOffsets(timing.stagger, targets.length, this.rnd, targets);
        const fromProps = op.a ? flattenProps(op.a) : null, toProps = op.b ? flattenProps(op.b) : null;
        const keys = Object.keys(Object.assign({}, fromProps || {}, toProps || {}));
        let last = start;
        targets.forEach((el, i) => {
          const rnd = I.makeRandom(1 + this.id * 1000003 + opIndex * 7919 + i * 104729);
          const s = start + offs[i];
          const it = { el, i, n: targets.length, type: op.type, start: s, dur, rep, rd, yoyo: !!timing.yoyo, ease: mw.easing(timing.ease), props: {}, onUpdate: timing.onUpdate || null, immediate: op.type !== 'to' && timing.immediateRender !== false, seq: this.items.length };
          for (const k of keys) it.props[k] = { from: fromProps && k in fromProps ? evalVal(fromProps[k], i, el, targets, rnd) : undefined, to: toProps && k in toProps ? evalVal(toProps[k], i, el, targets, rnd) : undefined };
          this.items.push(it);
          const end = s + (rep === Infinity ? dur : dur * (rep + 1) + rd * rep);
          last = Math.max(last, end);
        });
        cursor.prevStart = start;
        cursor.prevEnd = last;
        cursor.end = Math.max(cursor.end, last);
      }
      this.total = cursor.end;
      this.resolved = false;
    }
    _resolve() {
      this._build();
      if (this.resolved) return;
      this.resolved = true;
      // Tracks: one sorted list of segments per (target, property)
      const tracks = new Map();
      const sorted = this.items.slice().sort((a, b) => a.start - b.start || a.seq - b.seq);
      for (const it of sorted) {
        let tm = tracks.get(it.el);
        if (!tm) { tm = { el: it.el, props: new Map(), tfBase: null, cache: new Map(), anchor: null }; tracks.set(it.el, tm); }
        for (const k of Object.keys(it.props)) {
          if (!tm.props.has(k)) tm.props.set(k, []);
          tm.props.get(k).push({ it, spec: it.props[k] });
        }
      }
      for (const tm of tracks.values()) {
        const el = tm.el;
        // Keep the element's own CSS transform (e.g. translate(-50%,-50%) centering) and add the tween on top.
        tm.tfBase = decompose(null);
        tm.cssPrefix = '';
        if (el instanceof Element && [...tm.props.keys()].some((k) => k in TF || k === 'transformPerspective')) {
          const tf = el instanceof SVGElement && !(el instanceof SVGSVGElement) ? 'none' : getComputedStyle(el).transform;
          if (tf && tf !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(tf)) tm.cssPrefix = tf + ' ';
        }
        tm.hasTF = [...tm.props.keys()].some((k) => k in TF || k === 'transformPerspective');
        tm.anchor = this.opts.global ? null : (this.scope || (el instanceof Element ? el : null));
        tm.inline = el instanceof Element ? {} : null;
        for (const [k, segs] of tm.props) {
          let base = readBase(el, k, tm.tfBase);
          if (tm.inline && !(k in TF) && !k.startsWith('attr:') && !['draw', 'morph', 'text', 'textContent', 'innerText', 'autoAlpha', 'transformPerspective'].includes(k)) tm.inline[k] = el.style.getPropertyValue(kebab(k));
          tm.baseVals = tm.baseVals || {};
          tm.baseVals[k] = base;
          let prev = base;
          for (const sg of segs) {
            const { spec, it } = sg;
            let from, to;
            if (it.type === 'to') { from = prev; to = normalizeEnd(k, spec.to, prev); }
            else if (it.type === 'from') { from = normalizeEnd(k, spec.from, prev); to = prev; }
            else { from = normalizeEnd(k, spec.from !== undefined ? spec.from : prev, prev); to = normalizeEnd(k, spec.to !== undefined ? spec.to : prev, from); }
            from = coerceFrom(k, from, to);
            sg.from = from; sg.to = to;
            if (k === 'morph') sg.interp = morphInterp(String(from || to), String(to && to.nodeType ? to.getAttribute('d') : to));
            else if (k === 'text') { const T = String(to); sg.interp = (p) => T.slice(0, Math.round(p * T.length)); }
            else sg.interp = makeInterp(from, to, k);
            prev = to;
          }
        }
      }
      this.tracks = tracks;
    }
    _localTime(anchor, T) {
      let t;
      if (!anchor) t = T;
      else t = I.mapT(anchor, T) - I.clipStartOf(anchor);
      t -= +this.opts.delay || 0;
      const rep = this.opts.repeat === -1 ? Infinity : (this.opts.repeat | 0);
      if (rep && this.total > 0 && t > 0) {
        const period = this.total + (+this.opts.repeatDelay || 0);
        const cyc = Math.floor(t / period);
        if (cyc <= rep) { t -= cyc * period; if (t > this.total) t = this.total; if (this.opts.yoyo && cyc % 2) t = this.total - t; }
        else t = this.opts.yoyo && rep % 2 ? 0 : this.total;
      }
      return t;
    }
    _apply(T) {
      this._resolve();
      let changed = false;
      const clipsNow = I.clips();
      const perClip = new Map(); // many targets share one clip: work out its time once per frame
      for (const tm of this.tracks.values()) {
        const el = tm.el;
        if (tm.clipsRef !== clipsNow) { tm.clipsRef = clipsNow; tm.clip = tm.anchor ? I.nearestClip(tm.anchor) : null; }
        const c = tm.clip;
        let ct = perClip.get(c || tm.anchor);
        if (!ct) {
          // Skip elements whose clip is not on screen (they get updated when they appear).
          const vis = !c || (() => { const vt = I.mapT(c.parent || null, T); return vt >= c.start - 1e-9 && vt < c.end - 1e-9; })();
          ct = { vis, t: vis ? this._localTime(tm.anchor, T) : 0 };
          perClip.set(c || tm.anchor, ct);
        }
        if (!ct.vis) continue;
        const t = ct.t;
        const vals = {};
        for (const [k, segs] of tm.props) {
          let seg = null;
          for (let i = segs.length - 1; i >= 0; i--) if (segs[i].it.start <= t + 1e-9) { seg = segs[i]; break; }
          let v;
          if (!seg) {
            const first = segs[0];
            if (first.it.immediate) v = first.interp(0);
            else v = undefined; // untouched: leave the page's own value
          } else {
            const it = seg.it;
            let lt = t - it.start, p;
            if (it.dur <= 0) p = 1;
            else {
              const period = it.dur + it.rd;
              let cyc = Math.floor(lt / period);
              if (it.rep !== Infinity && cyc > it.rep) { cyc = it.rep; lt = it.dur + cyc * period; }
              let w = lt - cyc * period;
              p = w >= it.dur ? 1 : w / it.dur;
              if (it.yoyo && cyc % 2) p = 1 - p;
            }
            v = seg.interp(it.ease(Math.max(0, Math.min(1, p))));
            if (it.onUpdate && k === (it.firstKey ??= Object.keys(it.props)[0])) { try { it.onUpdate.call(it, p, el, it.i); } catch (e) { I.pageError(e); } }
          }
          vals[k] = v;
        }
        if (write(tm, vals)) changed = true;
      }
      for (const c of this.calls) {
        const t = this._localTime(this.opts.global ? null : this.scope, T);
        try { c.fn(t - c.at, t); } catch (e) { I.pageError(e); }
        changed = true;
      }
      return changed;
    }
  }
  function setCached(tm, key, val, fn) {
    if (tm.cache.get(key) === val) return false;
    tm.cache.set(key, val);
    fn(val);
    return true;
  }
  function write(tm, vals) {
    const el = tm.el;
    let changed = false;
    if (!(el instanceof Element)) {
      for (const k of Object.keys(vals)) if (vals[k] !== undefined && el[k] !== vals[k]) { el[k] = vals[k]; changed = true; }
      return changed;
    }
    if (tm.hasTF) {
      const c = Object.assign({}, tm.tfBase);
      let any = false;
      for (const k of Object.keys(vals)) if ((k in TF || k === 'transformPerspective') && vals[k] !== undefined) { c[k] = typeof vals[k] === 'number' ? vals[k] : parseFloat(vals[k]); any = true; }
      if (any) {
        const sx = c.scale * c.scaleX, sy = c.scale * c.scaleY;
        let s = tm.cssPrefix || '';
        if (c.transformPerspective) s += `perspective(${r4(c.transformPerspective)}px) `;
        // 2D unless 3D is really used: 3D transforms give every element its own layer, which is slower to paint
        s += c.z || c.rotateX || c.rotateY || c.transformPerspective ? `translate3d(${r4(c.x)}px, ${r4(c.y)}px, ${r4(c.z)}px)` : `translate(${r4(c.x)}px, ${r4(c.y)}px)`;
        if (c.xPercent || c.yPercent) s += ` translate(${r4(c.xPercent)}%, ${r4(c.yPercent)}%)`;
        if (c.rotate) s += ` rotate(${r4(c.rotate)}deg)`;
        if (c.rotateY) s += ` rotateY(${r4(c.rotateY)}deg)`;
        if (c.rotateX) s += ` rotateX(${r4(c.rotateX)}deg)`;
        if (c.skewX || c.skewY) s += ` skew(${r4(c.skewX)}deg, ${r4(c.skewY)}deg)`;
        if (sx !== 1 || sy !== 1) s += ` scale(${r4(sx)}, ${r4(sy)})`;
        // SVG shapes turn and scale around their own center, unless an origin was set (then leave it exactly as written).
        if (el instanceof SVGElement && !(el instanceof SVGSVGElement) && tm.svgOrigin === undefined) {
          const cso = getComputedStyle(el);
          tm.svgOrigin = !el.style.transformOrigin && !('transformOrigin' in vals) && /^0px 0px/.test(cso.transformOrigin) && cso.transformBox === 'view-box';
          if (tm.svgOrigin) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = '50% 50%'; }
        }
        if (setCached(tm, 'transform', s, (v) => { el.style.transform = v; })) changed = true;
      }
    }
    for (const k of Object.keys(vals)) {
      if (k in TF || k === 'transformPerspective') continue;
      let v = vals[k];
      if (k.startsWith('attr:')) {
        if (v === undefined) continue;
        if (setCached(tm, k, String(typeof v === 'number' ? r4(v) : v), (s) => el.setAttribute(k.slice(5), s))) changed = true;
        continue;
      }
      if (k === 'autoAlpha') {
        if (v === undefined) continue;
        const o = r4(+v);
        if (setCached(tm, k, o, (x) => { el.style.opacity = x; el.style.visibility = x <= 0 ? 'hidden' : 'inherit'; })) changed = true;
        continue;
      }
      if (k === 'draw') {
        if (v === undefined) continue;
        let a = 0, b = v;
        if (Array.isArray(v)) [a, b] = v; else if (typeof v === 'string') { const m = v.trim().split(/\s+/).map(parseFloat); if (m.length > 1) [a, b] = m; else b = m[0]; }
        if (!el.hasAttribute('pathLength')) el.setAttribute('pathLength', '1');
        const len = Math.max(0, b - a);
        // at zero length, round line caps would still paint a dot: hide the stroke then
        if (setCached(tm, k, r4(a) + ' ' + r4(len), () => { el.style.strokeDasharray = `${r4(len)} ${r4(1 + len + 1)}`; el.style.strokeDashoffset = String(r4(-a)); el.style.strokeOpacity = len <= 0.0005 ? '0' : ''; })) changed = true;
        continue;
      }
      if (k === 'morph') { if (v !== undefined && setCached(tm, k, v, (d) => el.setAttribute('d', d))) changed = true; continue; }
      if (k === 'text') { if (v !== undefined && setCached(tm, k, v, (s) => { el.textContent = s; })) changed = true; continue; }
      if (k === 'textContent' || k === 'innerText') {
        if (v === undefined) continue;
        const it = tm.props.get(k)[0].it;
        const snap = it && it.snap; void snap;
        const num = typeof v === 'number' ? v : parseFloat(v);
        if (setCached(tm, k, Math.round(num), (n) => { el.textContent = String(n); })) changed = true;
        continue;
      }
      if (v === undefined) {
        // restore what the page had before
        const orig = tm.inline ? tm.inline[k] : '';
        if (setCached(tm, k, '\u0000orig', () => { if (orig) el.style.setProperty(kebab(k), orig); else el.style.removeProperty(kebab(k)); })) changed = true;
        continue;
      }
      if (typeof v === 'number') v = UNITLESS.has(k) || k.startsWith('--') ? String(r4(v)) : r4(v) + 'px';
      if (setCached(tm, k, v, (s) => el.style.setProperty(kebab(k), s))) changed = true;
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // data-camera: slow camera moves that keep a scene alive. Added on top of
  // any transform the element already has.
  // ---------------------------------------------------------------------------
  function setupCameras() {
    for (const el of document.querySelectorAll('[data-camera]')) {
      if (el.__mwCam) continue;
      el.__mwCam = true;
      const c = I.nearestClip(el);
      const cs = c ? c.start : 0, ce = c && isFinite(c.end) ? c.end : I.comp.duration;
      const moves = el.getAttribute('data-camera').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      const short = Math.min(I.comp.width, I.comp.height);
      for (const mv of moves) {
        const toks = mv.split(/\s+/);
        const name = toks[0];
        let amount = null, ease = 'in-out-sine', from = 0, to = ce - cs;
        for (const t of toks.slice(1)) {
          const r = /^([\d.]+)s?-([\d.]+)s?$/.exec(t);
          if (r) { from = +r[1]; to = +r[2]; } else if (I.isEasingName(t)) ease = t; else if (!isNaN(parseFloat(t))) amount = parseFloat(t);
        }
        const dur = Math.max(0.01, to - from);
        let kf = null;
        const px = PX();
        const cover = (d) => 1 + (2 * Math.abs(d) * px) / short + 0.01;
        switch (name) {
          case 'push': { const a = amount ?? 1.1; kf = [{ transform: 'scale(1)' }, { transform: `scale(${a})` }]; break; }
          case 'pull': { const a = amount ?? 1.1; kf = [{ transform: `scale(${a})` }, { transform: 'scale(1)' }]; break; }
          case 'move-left': case 'move-right': case 'move-up': case 'move-down': {
            const d = amount ?? 80, s = cover(d);
            const v = { 'move-left': [-d, 0], 'move-right': [d, 0], 'move-up': [0, -d], 'move-down': [0, d] }[name];
            kf = [{ transform: `translate(${(-v[0] / 2) * px}px, ${(-v[1] / 2) * px}px) scale(${s})` }, { transform: `translate(${(v[0] / 2) * px}px, ${(v[1] / 2) * px}px) scale(${s})` }];
            break;
          }
          case 'rotate': case 'tilt': {
            // enlarge just enough that the tilted frame still covers every corner (tall or wide)
            const a = amount ?? 3, th = ((a / 2) * Math.PI) / 180, W = I.comp.width, H = I.comp.height;
            const sc = Math.cos(th) + (Math.max(W, H) / Math.min(W, H)) * Math.sin(th) + 0.004;
            kf = [{ transform: `rotate(${-a / 2}deg) scale(${r4(sc)})` }, { transform: `rotate(${a / 2}deg) scale(${r4(sc)})` }]; break;
          }
          case 'orbit': { const a = amount ?? 8; kf = [{ transform: `perspective(${2000 * px}px) rotateY(${-a / 2}deg) rotateX(${a / 6}deg) scale(1.06)` }, { transform: `perspective(${2000 * px}px) rotateY(${a / 2}deg) rotateX(${-a / 6}deg) scale(1.06)` }]; break; }
          case 'float': case 'drift': case 'handheld': case 'shake': {
            // amount is in px (at 1080p): how far the view wanders. shake rises and dies away inside its window.
            const isShake = name === 'shake';
            const a = (amount ?? (isShake ? 12 : name === 'handheld' ? 7 : 14)) * px;
            const freq = isShake ? 9 : name === 'handheld' ? 0.9 : 0.25;
            const step = isShake ? 1 / I.comp.fps : 1 / 10;
            const n = Math.max(2, Math.ceil(dur / step) + 1);
            const seed = (el.__mwSeed = (el.__mwSeed || 0) + 1) * 17 + name.length;
            const s = isShake ? 1 + (2 * a) / short : 1 + (2 * a) / short + 0.01;
            kf = [];
            for (let i = 0; i < n; i++) {
              const u = Math.min(dur, i * step);
              const t = u * freq;
              const env = isShake ? Math.sin(Math.min(1, u / dur) * Math.PI) * (1 - 0.4 * (u / dur)) : 1;
              const nx = mw.noise(t, seed) * 2 - 1, ny = mw.noise(t + 31.7, seed + 3) * 2 - 1, nr = mw.noise(t + 77.1, seed + 9) * 2 - 1;
              const sc = isShake ? 1 + (s - 1) * env : s;
              kf.push({ transform: `translate(${r4(nx * a * env)}px, ${r4(ny * a * env)}px) rotate(${r4(nr * (isShake ? 0.6 : 0.35) * env)}deg) scale(${r4(sc)})`, offset: Math.min(1, u / dur) });
            }
            kf[kf.length - 1].offset = 1;
            ease = 'linear';
            break;
          }
          default:
            I.report('error', 'bad-camera', `Unknown data-camera move "${name}".`, el, 'Use: push, pull, move-left, move-right, move-up, move-down, rotate, orbit, float, handheld, shake.');
        }
        if (!kf) continue;
        const a = I.real.animate.call(el, kf, { duration: dur * 1000, delay: from * 1000, easing: I.cssEasing(ease), fill: name === 'shake' ? 'none' : 'both', composite: 'add' });
        a.pause();
        // register with the runtime clock
        a.__mwCamera = true;
        I.addOwnAnim(a, cs);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shared-element morph between scenes: data-transition="morph" + data-morph="id"
  // ---------------------------------------------------------------------------
  // Each frame of the transition, both elements are measured where they really are (after camera
  // moves, tweens, layout) and flown along the same path between the two boxes.
  const morphs = [];
  function setupMorphs() {
    for (const pair of I.morphPairs()) {
      const A = pair.from, B = pair.to;
      if (B.__mwMorphed) continue;
      B.__mwMorphed = true;
      const map = new Map();
      for (const e of A.querySelectorAll('[data-morph]')) map.set(e.getAttribute('data-morph'), e);
      let found = 0;
      for (const eb of B.querySelectorAll('[data-morph]')) {
        const ea = map.get(eb.getAttribute('data-morph'));
        if (!ea) continue;
        found++;
        morphs.push({ a: ea, b: eb, sceneB: B, dur: pair.dur, ease: mw.easing(pair.ease), on: false });
      }
      // Fade out everything in the old scene except the morphing elements (they must stay solid).
      const ca = I.nearestClip(A);
      if (found && ca && isFinite(ca.end)) {
        const keep = [...A.querySelectorAll('[data-morph]')].filter((e) => map.get(e.getAttribute('data-morph')) && [...B.querySelectorAll('[data-morph]')].some((x) => x.getAttribute('data-morph') === e.getAttribute('data-morph')));
        // Fade with filter: opacity() *added* to the element's own filter, so the page's own opacity
        // (an element already faded out) is kept. Boxes that contain a morphing element lose their
        // own paint (background, border, shadow) instead, so no empty card is left behind.
        const timing = { duration: pair.dur * 1000 * 0.7, delay: Math.max(0, ca.end - ca.start - pair.dur) * 1000, easing: 'ease-in-out', fill: 'forwards' };
        const fadeKids = (node) => {
          for (const ch of node.children) {
            if (I.SKIP_TAGS.has(ch.tagName) || ch.hasAttribute('data-mw-internal')) continue;
            if (keep.includes(ch)) continue;
            // wrappers that draw nothing themselves (display: contents, e.g. blocks) pass the fade to their children
            if (getComputedStyle(ch).display === 'contents') { fadeKids(ch); continue; }
            if (keep.some((k) => ch.contains(k))) {
              const cs = getComputedStyle(ch);
              const paints = cs.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0;
              if (paints) {
                const an = I.real.animate.call(ch, [{ backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor, boxShadow: cs.boxShadow }, { backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none', backgroundImage: 'none' }], timing);
                an.pause(); I.addOwnAnim(an, ca.start);
              }
              fadeKids(ch);
              continue;
            }
            let an;
            try { an = I.real.animate.call(ch, [{ filter: 'opacity(1)' }, { filter: 'opacity(0)' }], Object.assign({ composite: 'add' }, timing)); }
            catch (e) { an = I.real.animate.call(ch, [{ opacity: 1 }, { opacity: 0 }], timing); }
            an.pause(); I.addOwnAnim(an, ca.start);
          }
        };
        fadeKids(A);
      }
      if (!found) I.report('warning', 'morph-no-pairs', 'data-transition="morph" found no matching data-morph ids in the two scenes, so it is a plain crossfade.', B, 'Give the same data-morph="name" to an element in each scene.');
    }
  }
  function clearMorph(el) { el.style.removeProperty('translate'); el.style.removeProperty('scale'); }
  function ancestorScale(el) {
    let p = el.parentElement;
    while (p && !p.offsetWidth) p = p.parentElement;
    if (!p) return 1;
    return p.getBoundingClientRect().width / p.offsetWidth || 1;
  }
  // layout size without transforms (<svg> has no offsetWidth, use its CSS box)
  const boxW = (el) => el.offsetWidth ?? el.clientWidth ?? 0;
  const boxH = (el) => el.offsetHeight ?? el.clientHeight ?? 0;
  function placeAt(el, r, R) {
    // r: where el is now (screen), R: where it should be. Scale happens around the element's own
    // transform-origin, so work that point out on screen, and undo ancestor scaling for the move.
    const k = ancestorScale(el);
    const o = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
    const bw = boxW(el), bh = boxH(el);
    const ox = r.left + (bw ? (o[0] / bw) * r.width : 0);
    const oy = r.top + (bh ? (o[1] / bh) * r.height : 0);
    const sx = r.width ? R.width / r.width : 1, sy = r.height ? R.height / r.height : 1;
    const tx = (R.left - ox - sx * (r.left - ox)) / (k || 1), ty = (R.top - oy - sy * (r.top - oy)) / (k || 1);
    el.style.translate = `${r4(tx)}px ${r4(ty)}px`;
    el.style.scale = `${r4(sx)} ${r4(sy)}`;
  }
  function updateMorphs(T) {
    let changed = false;
    for (const m of morphs) {
      const c = I.nearestClip(m.sceneB);
      if (!c) continue;
      const lt = T - c.start;
      const active = lt >= 0 && lt < m.dur;
      if (!active) { if (m.on) { clearMorph(m.a); clearMorph(m.b); m.on = false; changed = true; } continue; }
      m.on = true; changed = true;
      clearMorph(m.a); clearMorph(m.b);
      const ra = m.a.getBoundingClientRect(), rb = m.b.getBoundingClientRect();
      const p = m.ease(Math.max(0, Math.min(1, lt / m.dur)));
      const ar = (r) => r.width / Math.max(1, r.height);
      if (Math.abs(Math.log(ar(ra) / ar(rb))) > 0.2) {
        // different shapes (e.g. two text boxes): fly center to center and scale evenly, no stretching
        const cx = (ra.left + ra.width / 2) * (1 - p) + (rb.left + rb.width / 2) * p, cy = (ra.top + ra.height / 2) * (1 - p) + (rb.top + rb.height / 2) * p;
        const h = ra.height * (1 - p) + rb.height * p;
        const box = (r) => { const k = h / r.height; return { left: cx - (r.width * k) / 2, top: cy - (r.height * k) / 2, width: r.width * k, height: r.height * k }; };
        placeAt(m.a, ra, box(ra));
        placeAt(m.b, rb, box(rb));
      } else {
        const R = { left: ra.left + (rb.left - ra.left) * p, top: ra.top + (rb.top - ra.top) * p, width: ra.width + (rb.width - ra.width) * p, height: ra.height + (rb.height - ra.height) * p };
        placeAt(m.a, ra, R);
        placeAt(m.b, rb, R);
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // mw.camera(world): a virtual camera over a big "world" layer. Shots frame elements,
  // follow moving ones, and blend smoothly from one to the next. Pure function of time.
  //   const cam = mw.camera('#world');
  //   cam.shot(0, { fit: ['#a', '#b'], padding: 80 })
  //      .shot(2, { follow: '#package', zoom: 1.8, duration: 1.2 })
  //      .shot(12, { fit: '#route', duration: 1.5, ease: 'in-out-quart' })
  //      .shake(6.2, { duration: 0.4, amount: 12 });
  // Elements with data-parallax="0.3" next to the world move 30% as much (depth).
  // ---------------------------------------------------------------------------
  const cameras = [];
  class Camera {
    constructor(world, opts = {}) {
      this.spec = world; this.opts = opts; this.shots = []; this.shakes = [];
      cameras.push(this);
    }
    get world() { if (!this._w) { this._w = typeof this.spec === 'string' ? document.querySelector(this.spec) : this.spec; if (!this._w) I.report('error', 'camera-no-world', `mw.camera: "${this.spec}" matched nothing.`, null); } return this._w; }
    shot(at, s) { this.shots.push(Object.assign({ at: +at || 0, duration: 1, ease: 'in-out-cubic', padding: 60 }, s)); this.shots.sort((a, b) => a.at - b.at); return this; }
    shake(at, o = {}) { this.shakes.push(Object.assign({ at: +at || 0, duration: 0.4, amount: 10, freq: 18 }, o)); return this; }
    _markers() {
      const w = this.world;
      if (!this._m || !this._m[0].isConnected) {
        const mk = (x) => { const d = document.createElement('div'); d.setAttribute('data-mw-internal', ''); d.style.cssText = `position:absolute;left:${x}px;top:0;width:0;height:0;pointer-events:none`; w.appendChild(d); return d; };
        this._m = [mk(0), mk(1000)];
        w.setAttribute('data-mw-camera-world', '');
        if (getComputedStyle(w).position === 'static') w.style.position = 'relative';
        w.style.transformOrigin = '0 0';
      }
      const a = this._m[0].getBoundingClientRect(), b = this._m[1].getBoundingClientRect();
      return { ox: a.left, oy: a.top, k: (b.left - a.left) / 1000 || 1 };
    }
    // where something is, in world coordinates (unaffected by the camera itself)
    _box(target, M) {
      if (target && typeof target === 'object' && !Array.isArray(target) && !(target instanceof Element) && 'x' in target) return { x: target.x, y: target.y, w: target.w || 0, h: target.h || 0 };
      const els = (Array.isArray(target) ? target : [target]).flatMap((t) => typeof t === 'string' ? [...this.world.querySelectorAll(t)] : t ? [t] : []);
      if (!els.length) return null;
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const e of els) { const q = e.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
      return { x: (l - M.ox) / M.k, y: (t - M.oy) / M.k, w: (r - l) / M.k, h: (b - t) / M.k };
    }
    _state(sh, M, view) {
      // camera state = { cx, cy, zoom, rot } in world coordinates
      const target = sh.fit ?? sh.follow ?? sh.center;
      const box = target != null ? this._box(target, M) : { x: view.w / 2, y: view.h / 2, w: 0, h: 0 };
      if (!box) return null;
      let zoom = sh.zoom;
      // with fit, zoom multiplies the fitted zoom (1.05 = a little closer)
      if (sh.fit != null) zoom = Math.min((view.w - 2 * sh.padding) / Math.max(1, box.w), (view.h - 2 * sh.padding) / Math.max(1, box.h)) * (sh.zoom ?? 1);
      zoom = Math.max(sh.minZoom ?? 0.05, Math.min(sh.maxZoom ?? 20, zoom ?? 1));
      const off = sh.offset || [0, 0];
      return { cx: box.x + box.w / 2 + off[0], cy: box.y + box.h / 2 + off[1], zoom, rot: sh.rotate || 0 };
    }
    _apply(T) {
      const w = this.world;
      if (!w || !this.shots.length) return false;
      const c = I.nearestClip(w);
      if (c) { const vt = I.mapT(c.parent || null, T); if (vt < c.start - 1e-9 || vt >= c.end - 1e-9) return false; }
      const t = I.mapT(w, T) - (this.opts.global ? 0 : I.clipStartOf(w));
      const parent = w.offsetParent || w.parentElement;
      const view = { w: parent.clientWidth || I.comp.width, h: parent.clientHeight || I.comp.height };
      const M = this._markers();
      // current shot and the one before it
      let i = -1;
      for (let k = 0; k < this.shots.length; k++) if (this.shots[k].at <= t + 1e-9) i = k;
      const cur = this.shots[Math.max(0, i)];
      let st = this._state(cur, M, view);
      if (!st) return false;
      if (i > 0 && t < cur.at + cur.duration) {
        const prevS = this._state(this.shots[i - 1], M, view);
        if (prevS) {
          const p = mw.easing(cur.ease)(Math.max(0, Math.min(1, (t - cur.at) / Math.max(0.001, cur.duration))));
          // zoom blends in log space so it feels even
          const z = Math.exp(Math.log(prevS.zoom) + (Math.log(st.zoom) - Math.log(prevS.zoom)) * p);
          st = { cx: prevS.cx + (st.cx - prevS.cx) * p, cy: prevS.cy + (st.cy - prevS.cy) * p, zoom: z, rot: prevS.rot + (st.rot - prevS.rot) * p };
        }
      }
      let sx = 0, sy = 0, sr = 0;
      for (const sk of this.shakes) {
        const lt = t - sk.at;
        if (lt < 0 || lt > sk.duration) continue;
        const env = Math.sin((lt / sk.duration) * Math.PI) * (1 - lt / sk.duration * 0.5);
        sx += (mw.noise(lt * sk.freq, 11) * 2 - 1) * sk.amount * env; sy += (mw.noise(lt * sk.freq, 23) * 2 - 1) * sk.amount * env; sr += (mw.noise(lt * sk.freq, 37) * 2 - 1) * sk.amount * 0.05 * env;
      }
      const ox = w.offsetLeft, oy = w.offsetTop;
      const tx = view.w / 2 - ox - st.zoom * st.cx + sx, ty = view.h / 2 - oy - st.zoom * st.cy + sy;
      const rot = st.rot + sr;
      const tf = `translate(${r4(tx)}px, ${r4(ty)}px)` + (rot ? ` rotate(${r4(rot)}deg)` : '') + ` scale(${r4(st.zoom)})`;
      let changed = false;
      if (w.style.transform !== tf) { w.style.transform = tf; changed = true; }
      // parallax layers: siblings of the world (or inside its parent) with data-parallax
      for (const pl of parent.querySelectorAll('[data-parallax]')) {
        if (w.contains(pl)) continue;
        const f = parseFloat(pl.getAttribute('data-parallax')) || 0;
        const ptf = `translate(${r4((view.w / 2 - st.zoom * st.cx - ox) * f + sx * f)}px, ${r4((view.h / 2 - st.zoom * st.cy - oy) * f + sy * f)}px) scale(${r4(1 + (st.zoom - 1) * f)})`;
        if (pl.style.transform !== ptf) { pl.style.transform = ptf; pl.style.transformOrigin = '50% 50%'; changed = true; }
      }
      return changed;
    }
  }
  // ---------------------------------------------------------------------------
  // mw.path.travel(el, path, { stops, ease, rotate }): move an element along an SVG path.
  //   stops: [[time, progress], ...] e.g. [[0, 0], [1.5, 0.3], [2.5, 0.3], [4, 1]] (holds where progress repeats)
  // The path is converted to the element's own coordinates once, then played by the browser
  // (CSS offset-path), so it is exact and cheap. Times are relative to the element's clip.
  // ---------------------------------------------------------------------------
  const travels = [];
  function setupTravel(tr) {
    const el = typeof tr.el === 'string' ? document.querySelector(tr.el) : tr.el;
    const pth = typeof tr.path === 'string' && !/^\s*[Mm]/.test(tr.path) ? document.querySelector(tr.path) : tr.path;
    if (!el) { I.report('error', 'travel-no-element', `mw.path.travel: "${tr.el}" matched nothing.`, null); return; }
    const cb = el.offsetParent || el.parentElement;
    const mk = (x) => { const d = document.createElement('div'); d.setAttribute('data-mw-internal', ''); d.style.cssText = `position:absolute;left:${x}px;top:0;width:0;height:0`; cb.appendChild(d); return d; };
    const m0 = mk(0), m1 = mk(1000);
    const a = m0.getBoundingClientRect(), b = m1.getBoundingClientRect();
    const k = (b.left - a.left) / 1000 || 1;
    m0.remove(); m1.remove();
    let pts = [];
    if (pth && pth.nodeType === 1 && pth.getTotalLength) {
      const len = pth.getTotalLength(), ctm = pth.getScreenCTM(), sv = pth.ownerSVGElement;
      const N = Math.max(60, Math.min(600, Math.round(len / 4)));
      for (let i = 0; i <= N; i++) {
        const q = pth.getPointAtLength((i / N) * len);
        const sp = sv.createSVGPoint(); sp.x = q.x; sp.y = q.y;
        const s2 = sp.matrixTransform(ctm);
        pts.push([(s2.x - a.left) / k, (s2.y - a.top) / k]);
      }
    } else {
      // raw path data: already in the container's coordinates
      const pe = pathEl(String(tr.path)); const len = pe.getTotalLength(); const N = Math.max(60, Math.min(600, Math.round(len / 4)));
      for (let i = 0; i <= N; i++) { const q = pe.getPointAtLength((i / N) * len); pts.push([q.x, q.y]); }
    }
    // offset-path point (0,0) is the element's own layout top-left corner; its center is placed on the path
    const ox = el.offsetLeft, oy = el.offsetTop;
    const d = 'M' + pts.map(([x, y]) => r4(x - ox) + ' ' + r4(y - oy)).join(' L');
    el.style.offsetPath = `path('${d}')`;
    el.style.offsetAnchor = 'center';
    el.style.offsetRotate = tr.opts.rotate === false || tr.opts.rotate == null ? '0deg' : tr.opts.rotate === true || tr.opts.rotate === 'auto' ? 'auto' : String(tr.opts.rotate);
    let stops = (tr.opts.stops || [[0, 0], [tr.opts.duration || 2, 1]]).map((s0) => (Array.isArray(s0) ? s0 : [s0.at, s0.to]));
    stops = stops.sort((x, y) => x[0] - y[0]);
    const T0 = stops[0][0], T1 = stops[stops.length - 1][0];
    const total = Math.max(0.001, T1 - T0);
    const ease = tr.opts.ease || 'in-out-cubic';
    const kf = stops.map(([t, pr], i) => ({ offsetDistance: r4(pr * 100) + '%', offset: (t - T0) / total, easing: I.cssEasing(Array.isArray(ease) ? ease[i] || 'linear' : ease) }));
    const c = I.nearestClip(el);
    const an = I.real.animate.call(el, kf, { duration: total * 1000, delay: T0 * 1000, fill: 'both' });
    an.pause(); I.addOwnAnim(an, c ? c.start : 0);
    tr.done = true;
    tr.stops = stops; tr.easeFn = (i) => mw.easing(Array.isArray(ease) ? ease[i] || 'linear' : ease);
  }
  function travel(el, path, opts = {}) {
    const tr = { el, path, opts, done: false };
    travels.push(tr);
    if (initDone) setupTravel(tr);
    // progress (0..1) at local time t, e.g. to draw the route behind the traveler
    tr.progress = (t) => {
      const st = tr.stops || (opts.stops || []).map((s0) => (Array.isArray(s0) ? s0 : [s0.at, s0.to]));
      if (!st.length) return 0;
      if (t <= st[0][0]) return st[0][1];
      for (let i = 1; i < st.length; i++) if (t <= st[i][0]) { const p = (t - st[i - 1][0]) / Math.max(1e-6, st[i][0] - st[i - 1][0]); return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * (tr.easeFn ? tr.easeFn(i - 1)(p) : p); }
      return st[st.length - 1][1];
    };
    return tr;
  }

  // ---------------------------------------------------------------------------
  // mw.burst(target, { at, kind, x, y, count, colors, … }): confetti, sparks, dust or bubbles
  // thrown from a point at a moment. Pure physics of time: seekable, same in every render.
  // ---------------------------------------------------------------------------
  const bursts = [];
  const BURST_KINDS = {
    confetti: { count: 160, speed: 1000, spread: 360, angle: -90, gravity: 1100, drag: 1.8, duration: 2.8, size: 17, shape: 'paper' },
    sparks: { count: 70, speed: 1300, spread: 360, angle: -90, gravity: 500, drag: 3.2, duration: 0.9, size: 4, shape: 'streak' },
    dust: { count: 60, speed: 260, spread: 360, angle: -90, gravity: -40, drag: 1.2, duration: 2.2, size: 6, shape: 'dot' },
    bubbles: { count: 40, speed: 380, spread: 120, angle: -90, gravity: -120, drag: 0.8, duration: 2.4, size: 16, shape: 'ring' },
  };
  function burst(target, opts = {}) {
    const b = { target, opts, canvas: null };
    bursts.push(b);
    if (initDone) setupBurst(b);
    return b;
  }
  function setupBurst(b) {
    const el = typeof b.target === 'string' ? document.querySelector(b.target) : b.target;
    if (!el) { I.report('error', 'burst-no-target', `mw.burst: "${b.target}" matched nothing.`, null); return; }
    const o = Object.assign({ kind: 'confetti', at: 0, x: '50%', y: '50%', colors: ['#ff5c8a', '#ffd166', '#06d6a0', '#118ab2', '#a78bfa', '#ffffff'], seed: bursts.indexOf(b) + 1 }, BURST_KINDS[b.opts.kind || 'confetti'] || BURST_KINDS.confetti, b.opts);
    const W = el.clientWidth || I.comp.width, H = el.clientHeight || I.comp.height;
    const cv = document.createElement('canvas');
    cv.setAttribute('data-mw-internal', '');
    cv.width = Math.ceil(W); cv.height = Math.ceil(H);
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:' + (o.zIndex ?? 30);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(cv);
    const px = PX();
    const pos = (v, size) => (typeof v === 'string' && v.endsWith('%') ? (parseFloat(v) / 100) * size : (+v || 0) * px);
    const rnd = I.makeRandom(1 + o.seed * 7919);
    const parts = [];
    for (let i = 0; i < o.count; i++) {
      const ang = ((o.angle + (rnd() - 0.5) * o.spread) * Math.PI) / 180;
      const sp = o.speed * px * (0.12 + Math.pow(rnd(), 0.8) * 0.95);
      parts.push({ vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 14, flip: rnd() * 6.28, flipS: 4 + rnd() * 8, size: o.size * px * (0.6 + rnd() * 0.8), color: o.colors[Math.floor(rnd() * o.colors.length)], life: o.duration * (0.7 + rnd() * 0.3), delay: rnd() * (o.stagger || 0.06), wob: rnd() * 6.28 });
    }
    b.canvas = cv; b.o = o; b.parts = parts; b.x0 = pos(o.x, W); b.y0 = pos(o.y, H); b.el = el; b.last = null;
  }
  function drawBursts(T) {
    let changed = false;
    for (const b of bursts) {
      if (!b.canvas) continue;
      const t = I.mapT(b.el, T) - I.clipStartOf(b.el) - b.o.at;
      const key = t < 0 || t > b.o.duration * 1.05 + 0.1 ? 'off' : Math.round(t * 1000);
      if (key === b.last) continue;
      b.last = key; changed = true;
      const g = b.canvas.getContext('2d');
      g.clearRect(0, 0, b.canvas.width, b.canvas.height);
      if (key === 'off') continue;
      const { gravity, drag, shape } = b.o;
      const px = PX();
      for (const p of b.parts) {
        const lt = t - p.delay;
        if (lt < 0 || lt > p.life) continue;
        // velocity decays with drag k: x = v(1-e^-kt)/k ; gravity falls at terminal-ish speed
        const e = Math.exp(-drag * lt), k = drag || 1e-6;
        const x = b.x0 + (p.vx * (1 - e)) / k + Math.sin(lt * 3 + p.wob) * (shape === 'paper' ? 18 * px * Math.min(1, lt) : 0);
        const y = b.y0 + (p.vy * (1 - e)) / k + (gravity * px / k) * (lt - (1 - e) / k);
        const fade = Math.min(1, (p.life - lt) / (p.life * 0.25));
        g.globalAlpha = Math.max(0, fade);
        g.fillStyle = g.strokeStyle = p.color;
        if (shape === 'paper') {
          g.save(); g.translate(x, y); g.rotate(p.rot + p.spin * lt); g.scale(1, Math.cos(p.flip + p.flipS * lt));
          g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); g.restore();
        } else if (shape === 'streak') {
          const vx = p.vx * e, vy = p.vy * e + gravity * px * (1 - e) / k;
          const L = Math.min(40 * px, Math.hypot(vx, vy) * 0.03);
          const a = Math.atan2(vy, vx);
          g.lineWidth = p.size * 0.6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * L, y - Math.sin(a) * L); g.stroke();
        } else if (shape === 'ring') {
          g.lineWidth = Math.max(1, p.size * 0.12); g.beginPath(); g.arc(x, y, p.size / 2, 0, 6.283); g.stroke();
        } else { g.beginPath(); g.arc(x, y, p.size / 2, 0, 6.283); g.fill(); }
      }
      g.globalAlpha = 1;
    }
    return changed;
  }

  function updateCameras(T) { let ch = false; for (const c of cameras) if (c._apply(T)) ch = true; return ch; }

  // ---------------------------------------------------------------------------
  // data-fit: shrink (or grow) text so it fits its box exactly
  // ---------------------------------------------------------------------------
  function setupFit() {
    for (const el of document.querySelectorAll('[data-fit]')) {
      if (el.__mwFit) continue;
      el.__mwFit = true;
      const mode = (el.getAttribute('data-fit') || 'shrink').trim() || 'shrink';
      const cs = getComputedStyle(el);
      const fs0 = parseFloat(cs.fontSize);
      const maxAttr = parseFloat(el.getAttribute('data-fit-max'));
      const boxW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // natural width of the content on one line, at the current font size
      const natural = () => {
        const sv = [el.style.width, el.style.whiteSpace, el.style.display];
        el.style.width = 'max-content'; el.style.whiteSpace = 'nowrap'; if (cs.display === 'inline') el.style.display = 'inline-block';
        const w = el.getBoundingClientRect().width / (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1);
        [el.style.width, el.style.whiteSpace, el.style.display] = sv;
        return w - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      };
      if (mode === 'grow' || mode === 'fill') {
        if (!(boxW > 0)) { I.report('warning', 'fit-no-width', 'data-fit="grow" needs a box with a width.', el); continue; }
        let fs = fs0;
        for (let i = 0; i < 4; i++) { const w = natural(); if (!(w > 0)) break; fs = fs * (boxW / w); el.style.fontSize = fs + 'px'; }
        if (isFinite(maxAttr)) el.style.fontSize = Math.min(fs, maxAttr * PX()) + 'px';
        el.style.whiteSpace = 'nowrap';
      } else {
        // shrink until it fits: width always; height only when the box has a fixed height
        const fixedH = el.style.height || (cs.height !== 'auto' && el.parentElement && getComputedStyle(el.parentElement).display !== 'flex' && el.scrollHeight > el.clientHeight + 0.25 * fs0);
        const over = () => el.scrollWidth > el.clientWidth + 1 || (fixedH && el.scrollHeight > el.clientHeight + 0.25 * parseFloat(el.style.fontSize || fs0));
        if (!over()) continue;
        let lo = fs0 * 0.15, hi = fs0;
        for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; el.style.fontSize = mid + 'px'; if (over()) hi = mid; else lo = mid; }
        el.style.fontSize = lo + 'px';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // data-scramble="1.2": text decodes from random glyphs, left to right
  // ---------------------------------------------------------------------------
  const scramblers = [];
  function setupScramble() {
    for (const el of document.querySelectorAll('[data-scramble]')) {
      if (el.__mwScr) continue;
      el.__mwScr = true;
      const text = el.textContent;
      const dur = I.parseTime(el.getAttribute('data-scramble'), el, 'data-scramble') || 1;
      const delay = I.parseTime(el.getAttribute('data-scramble-delay'), el, 'data-scramble-delay') || 0;
      const chars = el.getAttribute('data-scramble-chars') || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?';
      if (getComputedStyle(el).display !== 'inline' && !el.style.minWidth) el.style.minWidth = el.offsetWidth + 'px';
      scramblers.push({ el, text, dur, delay, chars, last: null });
    }
  }
  function hash(a, b) { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; return (h >>> 0) / 4294967296; }
  function updateScramble(T) {
    let changed = false;
    for (const s of scramblers) {
      const t = I.mapT(s.el, T) - I.clipStartOf(s.el) - s.delay;
      const N = s.text.length;
      const tick = Math.floor((t + 10) * 18);
      let out = '';
      for (let i = 0; i < N; i++) {
        const ch = s.text[i];
        if (/\s/.test(ch)) { out += ch; continue; }
        const reveal = (i / Math.max(1, N - 1)) * s.dur * 0.85 + s.dur * 0.15;
        out += t >= reveal ? ch : t < 0 ? (i < 0 ? ch : s.chars[Math.floor(hash(i, tick) * s.chars.length)]) : s.chars[Math.floor(hash(i, tick) * s.chars.length)];
      }
      if (out !== s.last) { s.el.textContent = out; s.last = out; changed = true; }
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Animated images (GIF, animated WebP/PNG/AVIF): browsers play them on their own clock,
  // so we decode the frames and show the right one for the current time.
  // ---------------------------------------------------------------------------
  const animImgs = [];
  async function setupAnimatedImages() {
    if (typeof ImageDecoder === 'undefined') return;
    const imgs = [...document.querySelectorAll('img')].filter((im) => !im.__mwAnim && (im.hasAttribute('data-animated') || /\.(gif|webp|apng|avif)(\?|#|$)/i.test(im.getAttribute('src') || '')));
    await Promise.all(imgs.map(async (im) => {
      im.__mwAnim = true;
      const src = im.getAttribute('src');
      try {
        const res = await fetch(src);
        const type = res.headers.get('content-type') || ({ gif: 'image/gif', webp: 'image/webp', apng: 'image/apng', png: 'image/png', avif: 'image/avif' })[(src.split('?')[0].split('.').pop() || '').toLowerCase()];
        if (!(await ImageDecoder.isTypeSupported(type))) return;
        const dec = new ImageDecoder({ data: res.body, type });
        await dec.tracks.ready;
        await dec.completed;
        const n = dec.tracks.selectedTrack.frameCount;
        if (n <= 1) { dec.close(); return; }
        const frames = [];
        const cv = document.createElement('canvas');
        let total = 0;
        for (let i = 0; i < n; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          cv.width = image.displayWidth; cv.height = image.displayHeight;
          cv.getContext('2d').drawImage(image, 0, 0);
          const d = Math.max(0.02, (image.duration || 100000) / 1e6);
          frames.push({ at: total, url: cv.toDataURL('image/png') });
          total += d;
          image.close();
        }
        dec.close();
        const loop = im.getAttribute('data-loop') !== 'false';
        const rate = parseFloat(im.getAttribute('data-rate') || '1') || 1;
        animImgs.push({ im, frames, total, loop, rate, last: -1 });
        im.src = frames[0].url;
      } catch (e) { I.report('warning', 'animated-image', `Could not decode animated image ${src}: ${e && e.message || e}`, im); }
    }));
  }
  function updateAnimatedImages(T) {
    let changed = false;
    for (const a of animImgs) {
      let t = (I.mapT(a.im, T) - I.clipStartOf(a.im)) * a.rate;
      t = a.loop ? ((t % a.total) + a.total) % a.total : Math.min(Math.max(0, t), a.total - 1e-6);
      let i = 0;
      while (i < a.frames.length - 1 && a.frames[i + 1].at <= t + 1e-9) i++;
      if (i === a.last) continue;
      a.last = i; changed = true;
      a.im.src = a.frames[i].url;
      if (!a.im.complete) I.pendingWaits.push(a.im.decode().catch(() => {}));
    }
    return changed;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mw.wait(setupAnimatedImages()), { once: true });
  else mw.wait(setupAnimatedImages());

  // ---------------------------------------------------------------------------
  // Fast big blurs. A large CSS blur (soft glow blobs) is very slow to paint at full size.
  // For plain shapes (no children, no text) we paint the blur at 1/k size and scale it up,
  // which looks the same because the result is already very soft. Opt out: data-mw-exact.
  // ---------------------------------------------------------------------------
  function optimizeBlurs() {
    const els = document.body ? document.body.getElementsByTagName('*') : [];
    for (const el of els) {
      if (el.__mwBlur || el.hasAttribute('data-mw-exact') || el.children.length || (el.textContent || '').trim() || !(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      const m = /^blur\(([\d.]+)px\)$/.exec(cs.filter);
      if (!m) continue;
      const r = parseFloat(m[1]);
      if (r < 24) continue;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) continue;
      if (/px/.test(cs.backgroundImage) || cs.boxShadow !== 'none' || cs.backdropFilter !== 'none' || (cs.borderStyle !== 'none' && parseFloat(cs.borderWidth) > 0)) continue;
      // skip if something animates its look (not just transform/opacity)
      let animated = false;
      try { for (const an of el.getAnimations()) { const kf = an.effect && an.effect.getKeyframes ? an.effect.getKeyframes() : []; for (const k of kf) for (const p of Object.keys(k)) if (!/^(offset|easing|composite|computedOffset|transform|translate|rotate|scale|opacity|left|top|right|bottom|offsetDistance|offsetPath)$/.test(p)) animated = true; } } catch (e) {}
      if (animated) continue;
      const k = Math.min(8, Math.max(2, Math.floor(r / 10)));
      el.__mwBlur = true;
      // Bake: a small SVG image (shape + blur) is decoded once; moving it later is just copying pixels.
      const sw = w / k, sh = h / k, br = r / k, pad = Math.ceil(br * 3);
      const radius = cs.borderRadius.split(' ').map((v) => (v.endsWith('%') ? v : (parseFloat(v) / k) + 'px')).join(' ');
      const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/"/g, "'").replace(/</g, '&lt;');
      const style = `position:absolute;left:${pad}px;top:${pad}px;width:${sw}px;height:${sh}px;background-color:${cs.backgroundColor};background-image:${cs.backgroundImage};background-size:${cs.backgroundSize};background-position:${cs.backgroundPosition};background-repeat:${cs.backgroundRepeat};border-radius:${radius};filter:blur(${br}px)`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw + 2 * pad}" height="${sh + 2 * pad}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="${esc(style)}"></div></foreignObject></svg>`;
      // An SVG image would be re-rasterized at full size on every paint, so draw it once into a small
      // canvas: a canvas is a fixed bitmap, and scaling it up costs almost nothing.
      const cv = document.createElement('canvas');
      cv.setAttribute('data-mw-internal', '');
      cv.width = Math.ceil(sw + 2 * pad); cv.height = Math.ceil(sh + 2 * pad);
      cv.style.cssText = `position:absolute;left:${-pad * k}px;top:${-pad * k}px;width:${cv.width * k}px;height:${cv.height * k}px;pointer-events:none;display:block`;
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const done = img.decode().then(() => {
        cv.getContext('2d').drawImage(img, 0, 0);
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('background', 'transparent', 'important');
        if (cs.position === 'static') el.style.position = 'relative';
        el.style.overflow = 'visible';
        el.appendChild(cv);
      }).catch(() => {});
      I.pendingWaits.push(done);
    }
  }

  // ---------------------------------------------------------------------------
  // Hook into the runtime
  // ---------------------------------------------------------------------------
  I.hooks.preinit.push(setupFit);
  I.hooks.init.push(() => { initDone = true; try { optimizeBlurs(); } catch (e) {} for (const tr of travels) if (!tr.done) setupTravel(tr); for (const b of bursts) if (!b.canvas) setupBurst(b); setupCameras(); setupMorphs(); setupScramble(); for (const tl of tlList) tl._build(); });
  I.hooks.rebuild.push(() => { setupCameras(); setupMorphs(); setupScramble(); });
  I.hooks.post.push(updateCameras);
  I.hooks.post.push(updateMorphs);
  I.hooks.seek.push((T) => {
    let changed = updateScramble(T);
    if (animImgs.length && updateAnimatedImages(T)) changed = true;
    if (bursts.length && drawBursts(T)) changed = true;
    for (const tl of tlList) if (tl._apply(T)) changed = true;
    return changed;
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function tween(type, t, a, b) {
    const tl = new Timeline(null, {});
    if (type === 'to') tl.to(t, a, 0); else if (type === 'from') tl.from(t, a, 0); else if (type === 'fromTo') tl.fromTo(t, a, b, 0); else tl.set(t, a, 0);
    return tl;
  }
  Object.assign(mw, {
    timeline: (scope, opts) => new Timeline(scope, opts),
    camera: (world, opts) => new Camera(world, opts),
    burst,
    to: (t, v) => tween('to', t, v),
    from: (t, v) => tween('from', t, v),
    fromTo: (t, a, b) => tween('fromTo', t, a, b),
    set: (t, v) => tween('set', t, v),
    color: { mix: mixColor, parse: toRGBA },
    path: { point: pointAt, length: (d) => pathInfo(d).len, morph: morphInterp, interpolate: morphInterp, travel },
    shape,
    mapRange: (v, a, b, c, d, clamp = true) => { let p = (v - a) / (b - a); if (clamp) p = Math.max(0, Math.min(1, p)); return c + (d - c) * p; },
    snap: (v, step) => Math.round(v / step) * step,
    wrap: (v, a, b) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a)),
    pick: (arr, seed = 1) => arr[Math.floor(I.makeRandom(seed)() * arr.length)],
  });
  // interpolate() now mixes any CSS color in OKLab
  I.setColorMixer(mixColor);
})();
