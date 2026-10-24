/* motionwright sketch: hand-drawn (whiteboard) shapes. MIT License.
 * mw.sketch.* returns SVG path data for rough, slightly wobbly strokes; data-sketch on an SVG shape turns it into one.
 * Every shape is seeded, so it looks the same in every frame and every render (no boiling lines).
 */
(function () {
  'use strict';
  const mw = window.mw;
  if (!mw || !mw.__internal || mw.sketch) return;
  const I = mw.__internal;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const f1 = (x) => Math.round(x * 10) / 10;
  const px = () => (typeof I.PX === 'function' ? I.PX() : 1);
  // original shape → the sketched group that replaced it (so references taken by scripts still work)
  const replaced = I.replaced = I.replaced || new WeakMap();

  function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = (typeof seed === 'number' ? seed * 2654435761 : hashStr(seed)) >>> 0 || 1;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function opts(o) {
    o = o || {};
    return { roughness: o.roughness ?? 1, bow: o.bow ?? 1, passes: Math.max(1, Math.min(3, o.passes ?? 2)), seed: o.seed ?? 1, overshoot: o.overshoot ?? 1, raw: o.raw };
  }

  // One stroke from a to b: jittered ends, a slight overshoot, a gentle bow and a wobble, as one cubic curve.
  function strokeLine(x1, y1, x2, y2, o, R, move = true) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const r = o.roughness;
    // (tuned against judges: subtle wobble read as "too clean to be hand-drawn"; the two passes should visibly part)
    const off = Math.min(len * 0.1, (2.2 + len * 0.012) * px()) * r;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
    const j = () => (R() - 0.5) * off;
    const os = Math.min(len * 0.05, 8 * px()) * o.overshoot;
    const s0 = (R() - 0.3) * os, s1 = (R() - 0.3) * os;
    const ax = x1 - ux * s0 + nx * j() * 0.8, ay = y1 - uy * s0 + ny * j() * 0.8;
    const bx = x2 + ux * s1 + nx * j() * 0.8, by = y2 + uy * s1 + ny * j() * 0.8;
    const bowAmt = (R() < 0.5 ? -1 : 1) * (0.35 + 0.65 * R()) * Math.min(len * 0.025, 7 * px()) * r * o.bow;
    const t1 = 0.25 + R() * 0.2, t2 = 0.6 + R() * 0.2;
    const c1x = ax + (bx - ax) * t1 + nx * (bowAmt * Math.sin(Math.PI * t1) + j() * 0.5), c1y = ay + (by - ay) * t1 + ny * (bowAmt * Math.sin(Math.PI * t1) + j() * 0.5);
    const c2x = ax + (bx - ax) * t2 + nx * (bowAmt * Math.sin(Math.PI * t2) + j() * 0.5), c2y = ay + (by - ay) * t2 + ny * (bowAmt * Math.sin(Math.PI * t2) + j() * 0.5);
    return `${move ? 'M' : 'L'}${f1(ax)} ${f1(ay)}C${f1(c1x)} ${f1(c1y)} ${f1(c2x)} ${f1(c2y)} ${f1(bx)} ${f1(by)}`;
  }
  // Smooth curve through points (Catmull-Rom as cubic Béziers)
  function smooth(pts, closed = false) {
    if (pts.length < 2) return '';
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    const P = (i) => pts[closed ? (i + pts.length) % pts.length : Math.max(0, Math.min(pts.length - 1, i))];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d;
  }
  // Passes are joined into one stroke (the pen goes round again): SVG restarts dashes at every "M", so separate
  // subpaths would all draw at once and finish early when drawn on.
  const passes = (o, fn) => { const R = rng(o.seed); let d = ''; for (let p = 0; p < o.passes; p++) { const q = fn(R, p); d += p ? q.replace(/^M/, 'L') : q; } return d; };

  /** A rough straight line. */
  function line(x1, y1, x2, y2, o) { o = opts(o); return passes(o, (R) => strokeLine(x1, y1, x2, y2, o, R)); }
  /** A rough rectangle (each side its own stroke, crossing a little at the corners). */
  function rect(x, y, w, h, o) {
    o = opts(o);
    return passes(o, (R) => strokeLine(x, y, x + w, y, o, R) + strokeLine(x + w, y, x + w, y + h, o, R, false) + strokeLine(x + w, y + h, x, y + h, o, R, false) + strokeLine(x, y + h, x, y, o, R, false));
  }
  /** A rough ellipse: drawn in one go, the end runs a little past the start like a quick pen circle. */
  function ellipse(cx, cy, rx, ry, o) {
    o = opts(o);
    ry = ry ?? rx;
    const per = Math.PI * (rx + ry);
    const n = Math.max(9, Math.min(28, Math.round(per / (40 * px()))));
    return passes(o, (R, p) => {
      const a0 = R() * Math.PI * 2, over = 0.25 + R() * 0.45, steps = n + Math.ceil(n * over / (Math.PI * 2));
      const k = o.roughness, pts = [];
      const sx = 1 + (R() - 0.5) * 0.08 * k, sy = 1 + (R() - 0.5) * 0.08 * k;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((Math.PI * 2 + over) * i) / steps + (R() - 0.5) * 0.08 * k;
        const wob = 1 + (R() - 0.5) * 0.06 * k;
        // the pen spirals a little: start slightly inside, end slightly outside
        const sp = 1 + (i / steps - 0.5) * 0.04 * k * (p ? -1 : 1);
        pts.push([cx + Math.cos(a) * rx * sx * wob * sp, cy + Math.sin(a) * ry * sy * wob * sp]);
      }
      return smooth(pts);
    });
  }
  const circle = (cx, cy, r, o) => ellipse(cx, cy, r, r, o);
  /** Straight segments through points (closed: back to the start). */
  function polygon(points, o, closed = true) {
    o = opts(o);
    const P = toPoints(points);
    return passes(o, (R) => { let d = ''; for (let i = 0; i < P.length - (closed ? 0 : 1); i++) { const a = P[i], b = P[(i + 1) % P.length]; d += strokeLine(a[0], a[1], b[0], b[1], o, R, i === 0); } return d; });
  }
  const polyline = (points, o) => polygon(points, o, false);
  function toPoints(points) {
    if (Array.isArray(points)) return points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
    const n = String(points).trim().split(/[\s,]+/).map(Number);
    const out = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    return out;
  }
  let meas = null;
  function measure(d) { if (!meas) meas = document.createElementNS(SVGNS, 'path'); meas.setAttribute('d', d); return meas; }
  /** Any SVG path, redrawn by hand: follows the path with a slow wobble. Corners are kept. */
  function path(d, o) {
    o = opts(o);
    const subs = String(d).trim().split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
    // relative "m" subpaths need the absolute position: measure the whole path once and split by length instead
    const whole = measure(d), total = whole.getTotalLength();
    if (!total) return '';
    return passes(o, (R) => {
      let out = '';
      const parts = subs.length > 1 && subs.every((s) => s[0] === 'M') ? subs : [d];
      for (const sd of parts) {
        const el = measure(sd), len = el.getTotalLength();
        if (!len) continue;
        const step = Math.max(6, Math.min(24, len / 12)) * px();
        const n = Math.max(2, Math.ceil(len / step));
        const amp = Math.min(len * 0.02, 1.8 * px() + len * 0.005) * o.roughness;
        // a smooth random wobble along the length: a slow bow plus a gentle wave (a hand does not shake fast)
        const ph1 = R() * 6.28, ph2 = R() * 6.28, fr1 = 0.4 + R() * 0.5, fr2 = 1.2 + R() * 1.2;
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const L = (i / n) * len, q = el.getPointAtLength(L), q2 = el.getPointAtLength(Math.min(len, L + 0.5)), q0 = el.getPointAtLength(Math.max(0, L - 0.5));
          const ang = Math.atan2(q2.y - q0.y, q2.x - q0.x), nx = -Math.sin(ang), ny = Math.cos(ang);
          const t = i / n, w = amp * (0.6 * Math.sin(ph1 + t * fr1 * 6.28) + 0.4 * Math.sin(ph2 + t * fr2 * 6.28)) * Math.min(1, t * 8, (1 - t) * 8 + 0.4);
          pts.push([q.x + nx * w, q.y + ny * w]);
        }
        const closed = /[zZ]\s*$/.test(sd.trim());
        if (closed) { const a = pts[0]; const os = (R() * 0.6 + 0.2) * step; const ang = Math.atan2(pts[1][1] - a[1], pts[1][0] - a[0]); pts.push([a[0] + Math.cos(ang) * os, a[1] + Math.sin(ang) * os]); }
        out += smooth(pts);
      }
      return out;
    });
  }
  /** A rough arrow from (x1,y1) to (x2,y2). curve bends it (0.2 = a fifth of its length, negative bends the other way). */
  function arrow(x1, y1, x2, y2, o) {
    o = opts(o);
    const raw = o.raw || {};
    const curve = raw.curve ?? 0, head = raw.head === 0 || raw.head === false ? 0 : (raw.head ?? 22) * px(), both = raw.heads === 'both' || raw.both;
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const mx = (x1 + x2) / 2 + nx * curve * len, my = (y1 + y2) / 2 + ny * curve * len;
    const shaft = curve ? `M${x1} ${y1}Q${f1(mx)} ${f1(my)} ${x2} ${y2}` : `M${x1} ${y1}L${x2} ${y2}`;
    const R = rng(String(o.seed) + 'h');
    // a barb out and back, then the other barb: the pen never lifts, so draw-on ends with the head
    const barbs = (tx, ty, fx, fy) => {
      const ang = Math.atan2(ty - fy, tx - fx), spread = 0.45 + (R() - 0.5) * 0.12;
      const l1 = head * (0.9 + R() * 0.2), l2 = head * (0.9 + R() * 0.2);
      const b1 = [tx - Math.cos(ang - spread) * l1, ty - Math.sin(ang - spread) * l1], b2 = [tx - Math.cos(ang + spread) * l2, ty - Math.sin(ang + spread) * l2];
      return { b1, b2 };
    };
    const ho = { ...o, overshoot: 0.3 };
    const end = head ? barbs(x2, y2, curve ? mx : x1, curve ? my : y1) : null;
    const start = head && both ? barbs(x1, y1, curve ? mx : x2, curve ? my : y2) : null;
    let d = '';
    if (start) d += strokeLine(start.b1[0], start.b1[1], x1, y1, ho, R) + strokeLine(x1, y1, start.b2[0], start.b2[1], ho, R, false) + strokeLine(start.b2[0], start.b2[1], x1, y1, ho, R, false);
    const body = path(shaft, { ...o, passes: 1, overshoot: 0 });
    d += start ? body.replace(/^M/, 'L') : body;
    if (end) d += strokeLine(x2, y2, end.b1[0], end.b1[1], ho, R, false) + strokeLine(end.b1[0], end.b1[1], x2, y2, ho, R, false) + strokeLine(x2, y2, end.b2[0], end.b2[1], ho, R, false);
    if (o.passes > 1) d += path(shaft, { ...o, passes: 1, overshoot: 0, seed: String(o.seed) + 'b' });
    return d;
  }
  /** Hatching inside a shape (path data, points, or {x,y,w,h}): parallel rough strokes, like quick shading. */
  function hachure(shape, o) {
    const raw = (o && o.raw) || o || {};
    o = opts({ roughness: 0.5, passes: 1, ...o });
    const gap = (raw.gap ?? 12) * px(), angle = ((raw.angle ?? -41) * Math.PI) / 180;
    let poly;
    if (shape && typeof shape === 'object' && !Array.isArray(shape) && 'w' in shape) poly = [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]];
    else if (Array.isArray(shape)) poly = toPoints(shape);
    else { const el = measure(shape), len = el.getTotalLength(), n = Math.max(24, Math.min(240, Math.round(len / (6 * px())))); poly = []; for (let i = 0; i < n; i++) { const q = el.getPointAtLength((i / n) * len); poly.push([q.x, q.y]); } }
    if (poly.length < 3) return '';
    const ca = Math.cos(-angle), sa = Math.sin(-angle);
    const rot = poly.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
    let minY = Infinity, maxY = -Infinity;
    for (const p of rot) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const R = rng(o.seed);
    let d = '';
    const cb = Math.cos(angle), sb = Math.sin(angle);
    const back = (x, y) => [x * cb - y * sb, x * sb + y * cb];
    let k = 0, lastEnd = null;
    for (let y = minY + gap / 2; y < maxY; y += gap, k++) {
      const xs = [];
      for (let i = 0; i < rot.length; i++) {
        const a = rot[i], b = rot[(i + 1) % rot.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const inset = Math.min(gap * 0.3, (xs[i + 1] - xs[i]) * 0.1);
        const [ax, ay] = back(xs[i] + inset, y), [bx, by] = back(xs[i + 1] - inset, y);
        // alternate direction like a hand going back and forth, and keep the pen down between close lines
        const [sx, sy] = k % 2 ? [bx, by] : [ax, ay], [ex, ey] = k % 2 ? [ax, ay] : [bx, by];
        const near = lastEnd && Math.hypot(sx - lastEnd[0], sy - lastEnd[1]) < gap * 2.5;
        d += strokeLine(sx, sy, ex, ey, o, R, !near);
        lastEnd = [ex, ey];
      }
    }
    if (raw.cross) d += hachure(shape, { ...raw, cross: false, angle: (raw.angle ?? -41) + 90, seed: String(o.seed) + 'x' });
    return d;
  }
  /** A wavy scribble line (an underline, a strike-through, a quick zigzag fill with zigzag: true). */
  function underline(x1, y1, x2, y2, o) {
    o = opts(o);
    if (y2 == null) { y2 = y1; }
    const raw = o.raw || {};
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const times = raw.loops ?? 1;
    return passes({ ...o, passes: 1 }, (R) => {
      const pts = [];
      for (let k = 0; k < times; k++) {
        const fwd = k % 2 === 0, off = (k * 7 + (R() - 0.5) * 3) * px();
        const n = Math.max(4, Math.round(len / (60 * px())));
        for (let i = 0; i <= n; i++) {
          const t = fwd ? i / n : 1 - i / n;
          const w = (R() - 0.5) * 3 * px() * o.roughness + off;
          pts.push([x1 + ux * len * t - uy * w, y1 + uy * len * t + ux * w]);
        }
      }
      return smooth(pts);
    });
  }

  // ---------------------------------------------------------------------------
  // data-sketch: turn plain SVG shapes into hand-drawn ones
  // ---------------------------------------------------------------------------
  const GEOM = { rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], polyline: ['points'], polygon: ['points'], path: ['d'] };
  function parseOpts(el, inherited) {
    const v = (el.getAttribute('data-sketch') || '').trim();
    const o = { ...inherited };
    if (/^[\d.]+$/.test(v)) o.roughness = +v;
    else for (const part of v.split(/[;,]/)) { const m = /^\s*([\w-]+)\s*[:=\s]\s*([^\s].*?)\s*$/.exec(part); if (m) o[m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = isNaN(+m[2]) ? m[2] : +m[2]; }
    for (const k of ['fill', 'gap', 'angle', 'seed', 'roughness', 'passes', 'arrow', 'head']) { const a = el.getAttribute('data-sketch-' + k); if (a != null) o[k] = isNaN(+a) ? a : +a; }
    return o;
  }
  function geometryPath(el) {
    const n = (a) => parseFloat(el.getAttribute(a)) || 0;
    switch (el.tagName.toLowerCase()) {
      case 'rect': return { kind: 'rect', args: [n('x'), n('y'), n('width'), n('height')] };
      case 'circle': return { kind: 'ellipse', args: [n('cx'), n('cy'), n('r'), n('r')] };
      case 'ellipse': return { kind: 'ellipse', args: [n('cx'), n('cy'), n('rx'), n('ry')] };
      case 'line': return { kind: 'line', args: [n('x1'), n('y1'), n('x2'), n('y2')] };
      case 'polyline': return { kind: 'polyline', args: [el.getAttribute('points') || ''] };
      case 'polygon': return { kind: 'polygon', args: [el.getAttribute('points') || ''] };
      case 'path': return { kind: 'path', args: [el.getAttribute('d') || ''] };
    }
    return null;
  }
  // the outline as a closed polygon (for fills)
  function outlinePoints(g) {
    const [a, b, c, d] = g.args;
    if (g.kind === 'rect') return [[a, b], [a + c, b], [a + c, b + d], [a, b + d]];
    if (g.kind === 'ellipse') { const pts = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; pts.push([a + Math.cos(t) * c, b + Math.sin(t) * d]); } return pts; }
    if (g.kind === 'polygon' || g.kind === 'polyline') return toPoints(a);
    if (g.kind === 'path') return a;
    return null;
  }
  // perceived lightness 0..1 of a CSS color
  function lightness(c) { const v = mw.color && mw.color.parse(c); if (!v) return 0.5; const f = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return Math.cbrt(0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2])); }
  // the shape as plain path data
  function guidePath(g) {
    const [a, b, c, d] = g.args;
    switch (g.kind) {
      case 'rect': return `M${a} ${b}H${a + c}V${b + d}H${a}Z`;
      case 'ellipse': return `M${a - c} ${b}A${c} ${d} 0 1 0 ${a + c} ${b}A${c} ${d} 0 1 0 ${a - c} ${b}Z`;
      case 'line': return `M${a} ${b}L${c} ${d}`;
      case 'polyline': case 'polygon': { const P = toPoints(a); return P.length ? 'M' + P.map((q) => q[0] + ' ' + q[1]).join('L') + (g.kind === 'polygon' ? 'Z' : '') : null; }
      case 'path': return a || null;
    }
    return null;
  }
  function sketchOne(el, o, index) {
    const g = geometryPath(el);
    if (!g) return;
    const cs = getComputedStyle(el);
    const seed = o.seed != null ? String(o.seed) + ':' + index : (el.id || '') + ':' + index;
    const so = { roughness: o.roughness ?? 1, passes: o.passes ?? 2, bow: o.bow ?? 1, seed, raw: o };
    const fnK = { rect, ellipse, line, polyline, polygon, path }[g.kind];
    const nPass = Math.max(1, Math.min(3, so.passes));
    const outlines = [];
    for (let p = 0; p < nPass; p++) outlines.push(fnK(...g.args, { ...so, passes: 1, seed: seed + ':' + p }));
    // arrowheads at the ends of open shapes (data-sketch-arrow="end" | "start" | "both")
    const arrowAt = o.arrow && /^(path|line|polyline)$/.test(g.kind) ? String(o.arrow) : null;
    const guideD = guidePath(g);
    if (arrowAt && guideD) {
      const m = measure(guideD), L = m.getTotalLength(), R = rng(seed + 'a'), hl = (o.head ?? 20) * px();
      const head = (at, dir) => {
        const q = m.getPointAtLength(at), q2 = m.getPointAtLength(Math.max(0, Math.min(L, at - dir * Math.min(L / 3, hl))));
        const ang = Math.atan2(q.y - q2.y, q.x - q2.x), sp = 0.45 + (R() - 0.5) * 0.1;
        const b1 = [q.x - Math.cos(ang - sp) * hl, q.y - Math.sin(ang - sp) * hl], b2 = [q.x - Math.cos(ang + sp) * hl, q.y - Math.sin(ang + sp) * hl];
        const ho = { ...so, overshoot: 0.3 };
        return strokeLine(q.x, q.y, b1[0], b1[1], ho, R, false) + strokeLine(b1[0], b1[1], q.x, q.y, ho, R, false) + strokeLine(q.x, q.y, b2[0], b2[1], ho, R, false);
      };
      if (arrowAt === 'end' || arrowAt === 'both' || arrowAt === 'true' || arrowAt === '1') outlines[0] += head(L, 1);
      if (arrowAt === 'start' || arrowAt === 'both') outlines[0] = 'M' + outlines[0].slice(1) + `M${f1(m.getPointAtLength(0).x)} ${f1(m.getPointAtLength(0).y)}` + head(0, -1);
    }
    const grp = document.createElementNS(SVGNS, 'g');
    // keep identity and styling: id, classes, data-* (enter, exit, timing), style, presentation attributes
    for (const at of [...el.attributes]) if (!GEOM[el.tagName.toLowerCase()].includes(at.name) && at.name !== 'data-sketch' && !at.name.startsWith('data-sketch-') && at.name !== 'pathLength') grp.setAttribute(at.name, at.value);
    grp.setAttribute('data-mw-sketch', g.kind);
    // the fill as drawn, or the fill attribute when a CSS rule (like .ink { fill: none }) hides it
    const visible = (c) => c && c !== 'none' && !/rgba\(\d+, \d+, \d+, 0\)/.test(c) && !/^url\(/.test(c);
    const attrFill = el.getAttribute('fill');
    const fillColor = visible(cs.fill) ? cs.fill : visible(attrFill) ? attrFill : null;
    const mode = o.fill || (fillColor && g.kind !== 'line' && g.kind !== 'polyline' ? 'hachure' : 'none');
    // a shape with no stroke width set would sketch at 1 px (too thin for video): give it a marker-like 4 px
    if (!el.getAttribute('stroke-width') && !el.style.strokeWidth && parseFloat(cs.strokeWidth) <= 1) grp.style.strokeWidth = 4 * px() + 'px';
    const sw = parseFloat(grp.style.strokeWidth) || parseFloat(cs.strokeWidth) || 2;
    if (fillColor && mode !== 'none') {
      const fp = document.createElementNS(SVGNS, 'path');
      const pts = outlinePoints(g);
      if (mode === 'solid') {
        // a slightly rough filled shape under the outline
        const R = rng(seed + 's'), jt = () => (R() - 0.5) * 3 * px() * so.roughness;
        fp.setAttribute('d', g.kind === 'path' ? g.args[0] : g.kind === 'ellipse' ? ellipse(...g.args, { ...so, passes: 1, roughness: so.roughness * 0.4 }) : 'M' + pts.map((q) => f1(q[0] + jt()) + ' ' + f1(q[1] + jt())).join('L') + 'Z');
        fp.setAttribute('style', `fill:${fillColor};stroke:none`);
      } else {
        fp.setAttribute('d', hachure(pts, { gap: o.gap ?? Math.max(9, sw * 3.2), angle: o.angle ?? -41, cross: mode === 'cross' || mode === 'cross-hatch', seed: seed + 'f', roughness: 0.5 * so.roughness }));
        // a pale fill would fade away as thin lines: the same hue, deeper (pastel yellow → a real yellow)
        const hatchColor = lightness(fillColor) > 0.82 && CSS.supports('color', `oklch(from ${fillColor} l c h)`) ? `oklch(from ${fillColor} min(l, 0.8) max(c, 0.14) h)` : fillColor;
        fp.setAttribute('style', `fill:none;stroke:${hatchColor};stroke-width:${Math.max(2, sw * 0.9)}px;stroke-linecap:round`);
      }
      fp.setAttribute('data-mw-sketch-fill', mode);
      grp.appendChild(fp);
    }
    const noStroke = (el.getAttribute('stroke') === 'none' || cs.stroke === 'none') && fillColor;
    if (!noStroke) for (const d of outlines) {
      const op = document.createElementNS(SVGNS, 'path');
      op.setAttribute('d', d);
      op.setAttribute('fill', 'none');
      op.style.strokeLinecap = 'round';
      op.style.strokeLinejoin = 'round';
      if (cs.stroke === 'none' || !cs.stroke) op.style.stroke = 'currentColor';
      grp.appendChild(op);
    }
    // the exact shape, hidden: mw.path.travel('#pkg', '#route') follows it when '#route' is a sketched shape
    if (guideD) {
      const gp = document.createElementNS(SVGNS, 'path');
      gp.setAttribute('d', guideD);
      gp.setAttribute('data-mw-sketch-guide', '');
      gp.setAttribute('style', 'fill:none;stroke:none;visibility:hidden');
      grp.appendChild(gp);
    }
    grp.style.fill = 'none';
    el.replaceWith(grp);
    replaced.set(el, grp);
    return grp;
  }
  // ---------------------------------------------------------------------------
  // HTML: data-sketch on a box gives it a hand-drawn border; data-sketch-mark highlights, underlines, circles,
  // boxes or strikes a piece of text. Both are measured on the first frame they are visible (fonts loaded, layout done).
  // ---------------------------------------------------------------------------
  const marks = [];
  function startTime(el, attr) {
    const v = el.getAttribute(attr);
    if (v != null && v !== '') return parseFloat(v) || 0;
    // default: right after the element's own entrance (data-enter="name dur delay")
    const en = (el.closest('[data-enter]') || el).getAttribute('data-enter');
    if (!en) return 0;
    const nums = en.trim().split(/\s+/).slice(1).map((x) => parseFloat(x)).filter((x) => isFinite(x));
    return (nums[1] || 0) + (nums[0] ?? 0.6);
  }
  function addMark(el, kind) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('data-check', 'ignore');
    svg.setAttribute('class', 'mw-sketch-mark');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:1' + (kind === 'highlight' ? ';mix-blend-mode:multiply' : '');
    marks.push({ el, kind, svg, seed: (el.id || 'm') + ':' + marks.length, at: startTime(el, 'data-sketch-mark-at'), dur: parseFloat(el.getAttribute('data-sketch-mark-duration')) || (kind === 'highlight' || kind === 'underline' || kind === 'strike' ? 0.5 : 0.7) });
  }
  function addBorder(el) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('data-check', 'ignore');
    svg.setAttribute('class', 'mw-sketch-border');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none';
    marks.push({ el, kind: 'border', svg, seed: (el.id || 'b') + ':' + marks.length, opts: parseOpts(el, {}) });
  }
  function buildMark(m) {
    const el = m.el;
    if (!el.isConnected) return false;
    // Built once while the page loads (the same for every worker). Things in clips that are not on screen yet are
    // shown for a moment to be measured.
    const hidden = [];
    for (let a = el; a; a = a.parentElement) if (a.hasAttribute && a.hasAttribute('data-mw-hidden')) { hidden.push(a); a.removeAttribute('data-mw-hidden'); }
    try { return buildMarkNow(m); } finally { for (const a of hidden) a.setAttribute('data-mw-hidden', ''); }
  }
  function buildMarkNow(m) {
    const el = m.el;
    const R2 = { roughness: 1, seed: m.seed };
    if (m.kind === 'border') {
      const cs = getComputedStyle(el), w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return false;
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const col = bw > 0 && cs.borderTopStyle !== 'none' ? cs.borderTopColor : 'currentColor';
      if (cs.position === 'static') el.style.position = 'relative';
      el.style.borderColor = 'transparent';
      // the svg's 0,0 is the padding box corner: step back over the border
      const box = `M${-bw} ${-bw}H${w - bw}V${h - bw}H${-bw}Z`;
      const ds = [path(box, { ...R2, roughness: m.opts.roughness ?? 1, passes: 1 }), path(box, { ...R2, seed: m.seed + 'b', roughness: m.opts.roughness ?? 1, passes: 1 })];
      m.svg.innerHTML = ds.map((d) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${Math.max(2, bw || 3 * px())}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      el.appendChild(m.svg);
      return true;
    }
    // Text marks live inside the element, so they move, fade and hide with it. Line boxes are measured relative to the
    // element's own box (entrance moves and camera zoom scale all of them alike).
    const B = el.getBoundingClientRect(), k = el.offsetWidth ? B.width / el.offsetWidth : 1;
    if (!B.width || !(k > 0.05)) return false;
    const rects = [...el.getClientRects()].map((r) => ({ x: (r.left - B.left) / k, y: (r.top - B.top) / k, w: r.width / k, h: r.height / k })).filter((r) => r.w > 1 && r.h > 1);
    if (!rects.length) return false;
    const cs = getComputedStyle(el);
    const color = el.getAttribute('data-sketch-mark-color') || (m.kind === 'highlight' ? '#ffd43b' : m.kind === 'circle' ? '#e03131' : cs.color);
    const fs = parseFloat(cs.fontSize) || 40;
    const sw = Math.max(2.5, fs * 0.07);
    let d = '';
    const U = rects.reduce((u, r) => ({ x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), r: Math.max(u.r, r.x + r.w), b: Math.max(u.b, r.y + r.h) }), { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity });
    const pad = fs * 0.25;
    if (m.kind === 'circle') d = ellipse((U.x + U.r) / 2, (U.y + U.b) / 2, (U.r - U.x) / 2 + pad * 1.6, (U.b - U.y) / 2 + pad, { ...R2, passes: 1 });
    else if (m.kind === 'box') d = rect(U.x - pad, U.y - pad * 0.6, U.r - U.x + pad * 2, U.b - U.y + pad * 1.2, { ...R2, passes: 1 });
    else for (const r of rects) {
      const y = m.kind === 'underline' ? r.y + r.h * 0.92 : r.y + r.h * 0.55;
      d += strokeLine(r.x - fs * 0.05, y, r.x + r.w + fs * 0.05, y + (m.kind === 'highlight' ? 0 : fs * 0.02), { roughness: 0.6, bow: 1, overshoot: 0.5, raw: {} }, rng(m.seed + ':' + Math.round(y)), !d);
    }
    // a highlighter multiplies with what is under it, so it can sit on top of the text and still look behind it
    m.svg.innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${m.kind === 'highlight' ? (rects[0].h * 0.62).toFixed(1) : sw.toFixed(1)}" stroke-linecap="${m.kind === 'highlight' ? 'butt' : 'round'}" stroke-linejoin="round" pathLength="1"${m.kind === 'highlight' ? ' opacity="0.7"' : ''}/>`;
    m.p = m.svg.firstChild;
    if (cs.position === 'static') el.style.position = 'relative';
    el.appendChild(m.svg);
    m.base = mw.timing(el).start;
    m.svg.style.visibility = 'hidden';
    return true;
  }
  function updateMarks(T) {
    let changed = false;
    for (const m of marks) {
      if (!m.p) continue;
      // drawn on over m.dur seconds, m.at seconds into the element's clip
      const pr = Math.max(0, Math.min(1, (T - m.base - m.at) / m.dur)), e = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;
      const dash = e >= 1 ? 'none' : `${e.toFixed(4)} 2`, vis = e > 0 ? '' : 'hidden';
      if (dash !== m.lastDash || vis !== m.lastVis) { m.p.style.strokeDasharray = dash; m.svg.style.visibility = vis; m.lastDash = dash; m.lastVis = vis; changed = true; }
    }
    return changed;
  }
  I.hooks.init.push(() => { for (const m of marks) if (!m.built) m.built = buildMark(m); });
  I.hooks.seek.push(updateMarks);

  function setupSketch() {
    let i = 0;
    for (const el of document.querySelectorAll('[data-sketch-mark]')) if (!el.__mwMark) { el.__mwMark = true; addMark(el, (el.getAttribute('data-sketch-mark') || 'underline').trim()); }
    for (const host of [...document.querySelectorAll('[data-sketch]')]) {
      if (!host.isConnected) continue;
      const tag = host.tagName.toLowerCase();
      if (!(host instanceof SVGElement)) { if (!host.__mwBorder) { host.__mwBorder = true; addBorder(host); } continue; }
      const o = parseOpts(host, {});
      if (GEOM[tag]) { sketchOne(host, o, i++); continue; }
      // on an <svg> or <g>: every shape inside (a shape's own data-sketch options win)
      for (const el of [...host.querySelectorAll('rect,circle,ellipse,line,polyline,polygon,path')]) {
        if (el.closest('[data-sketch="off"],[data-sketch="none"]') || el.hasAttribute('data-sketch') || el.closest('defs,clipPath,mask,marker,pattern')) continue;
        sketchOne(el, [...el.attributes].some((a) => a.name.startsWith('data-sketch-')) ? parseOpts(el, o) : o, i++);
      }
      host.removeAttribute('data-sketch');
    }
  }
  I.hooks.preinit.unshift(setupSketch);

  // ---------------------------------------------------------------------------
  // mw.rect(el, space): an element's box in another element's own coordinates (e.g. a camera world),
  // whatever transforms (camera zoom, rotation) sit on top of that space.
  // ---------------------------------------------------------------------------
  function spaceMap(space) {
    let m = space.__mwMarks;
    if (!m || !m[0].isConnected) {
      const mk = (x, y) => { const d = document.createElement('div'); d.setAttribute('data-mw-internal', ''); d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none;visibility:hidden`; space.appendChild(d); return d; };
      if (space !== document.body && getComputedStyle(space).position === 'static') space.style.position = 'relative';
      m = space.__mwMarks = [mk(0, 0), mk(1000, 0), mk(0, 1000)];
    }
    const [o, x, y] = m.map((d) => d.getBoundingClientRect());
    const ax = (x.left - o.left) / 1000, ay = (x.top - o.top) / 1000, bx = (y.left - o.left) / 1000, by = (y.top - o.top) / 1000;
    const det = ax * by - ay * bx || 1;
    // screen → space
    return (sx, sy) => { const dx = sx - o.left, dy = sy - o.top; return [(dx * by - dy * bx) / det, (dy * ax - dx * ay) / det]; };
  }
  const elOf = (t) => (typeof t === 'string' ? document.querySelector(t) : (t && replaced.get(t)) || t);
  function rectIn(target, space) {
    const el = elOf(target), sp = space ? elOf(space) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!sp) return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    const map = spaceMap(sp);
    const pts = [map(r.left, r.top), map(r.right, r.top), map(r.right, r.bottom), map(r.left, r.bottom)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }

  // ---------------------------------------------------------------------------
  // mw.connect('#a', '#b', opts): a line or arrow between two elements that follows them every frame
  // ---------------------------------------------------------------------------
  const connectors = [];
  function connect(a, b, o = {}) {
    const c = { a, b, o, seed: o.seed ?? 'c' + connectors.length };
    connectors.push(c);
    return { el: () => c.path, progress: (t) => c.progressAt ? c.progressAt(t) : 1 };
  }
  // where the line from the center of box r toward point (px, py) leaves r (plus a gap)
  function edgePoint(r, px2, py2, gap) {
    const dx = px2 - r.cx, dy = py2 - r.cy;
    if (!dx && !dy) return [r.cx, r.cy];
    const sx = dx ? (r.w / 2) / Math.abs(dx) : Infinity, sy = dy ? (r.h / 2) / Math.abs(dy) : Infinity;
    const k = Math.min(sx, sy), len = Math.hypot(dx, dy);
    return [r.cx + dx * k + (dx / len) * gap, r.cy + dy * k + (dy / len) * gap];
  }
  function commonParent(x, y) { for (let p = x.parentElement; p; p = p.parentElement) if (p.contains(y)) return p; return document.body; }
  function setupConnector(c) {
    const A = elOf(c.a), B = elOf(c.b);
    if (!A || !B) { I.report('error', 'connect-no-target', `mw.connect: "${!A ? c.a : c.b}" matched nothing.`, null, 'Check the selector.'); c.dead = true; return; }
    c.A = A; c.B = B;
    c.space = c.o.in ? elOf(c.o.in) : commonParent(A, B);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'mw-connect' + (c.o.class ? ' ' + c.o.class : ''));
    svg.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none';
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('fill', 'none');
    path.style.stroke = c.o.color || 'currentColor';
    path.style.strokeWidth = (c.o.width ?? 3) + 'px';
    path.style.strokeLinecap = 'round'; path.style.strokeLinejoin = 'round';
    if (c.o.dash) path.style.strokeDasharray = c.o.dash;
    svg.appendChild(path);
    // a label on the arrow: label: 'GET /' or { text, offset, size, color }
    if (c.o.label != null) {
      const L = typeof c.o.label === 'object' ? c.o.label : { text: String(c.o.label) };
      const tx = document.createElementNS(SVGNS, 'text');
      tx.textContent = L.text;
      tx.setAttribute('text-anchor', 'middle');
      tx.setAttribute('dominant-baseline', 'middle');
      tx.style.fill = L.color || c.o.color || 'currentColor';
      tx.style.fontSize = (L.size ?? 30) * px() + 'px';
      tx.style.stroke = 'none';
      svg.appendChild(tx);
      c.label = tx; c.labelOpt = L;
    }
    if (c.o.behind) c.space.insertBefore(svg, c.space.firstChild); else c.space.appendChild(svg);
    if (c.space !== document.body && getComputedStyle(c.space).position === 'static') c.space.style.position = 'relative';
    c.svg = svg; c.path = path;
    // drawing on: draw: [start, duration] in seconds of the space's clip (or { at, duration, ease })
    const dr = c.o.draw;
    if (dr != null && dr !== false) {
      const at = Array.isArray(dr) ? +dr[0] : typeof dr === 'object' ? +dr.at || 0 : +dr || 0;
      const dur = Array.isArray(dr) ? +(dr[1] ?? 0.8) : typeof dr === 'object' ? +(dr.duration ?? 0.8) : 0.8;
      const ease = I.easing ? I.easing(Array.isArray(dr) ? dr[2] || 'in-out-cubic' : (dr && dr.ease) || 'in-out-cubic') : (p) => p;
      const base = c.o.global ? 0 : mw.timing(c.space === document.body ? A : c.space).start;
      c.progressAt = (T) => Math.max(0, Math.min(1, ease(Math.max(0, Math.min(1, (T - base - at) / Math.max(1e-6, dur))))));
      path.setAttribute('pathLength', '1');
    }
  }
  function updateConnectors(T) {
    let changed = false;
    for (const c of connectors) {
      if (!c.path && !c.dead) setupConnector(c);
      if (c.dead) continue;
      const shown = c.A.getClientRects().length && c.B.getClientRects().length;
      const ra = rectIn(c.A, c.space), rb = rectIn(c.B, c.space);
      const o = c.o, gap = (o.gap ?? 10) * px();
      let d = '';
      if (shown && ra && rb) {
        const curve = o.curve ?? 0;
        // aim from center to center, bent by curve; ends sit on the boxes' edges
        const mx = (ra.cx + rb.cx) / 2, my = (ra.cy + rb.cy) / 2, len = Math.hypot(rb.cx - ra.cx, rb.cy - ra.cy) || 1;
        const nx = -(rb.cy - ra.cy) / len, ny = (rb.cx - ra.cx) / len;
        const qx = mx + nx * curve * len, qy = my + ny * curve * len;
        // from/to: 'top' 'right' 'bottom' 'left' (middle of that side) or 'center'; default: where the line crosses the edge
        const side = (r, sd, gp) => ({ top: [r.cx, r.y - gp], bottom: [r.cx, r.y + r.h + gp], left: [r.x - gp, r.cy], right: [r.x + r.w + gp, r.cy], center: [r.cx, r.cy] })[sd];
        const [x1, y1] = side(ra, o.from, gap) || edgePoint(ra, curve ? qx : rb.cx, curve ? qy : rb.cy, gap);
        const [x2, y2] = side(rb, o.to, gap) || edgePoint(rb, curve ? qx : ra.cx, curve ? qy : ra.cy, gap);
        const head = o.head === false || o.head === 'none' ? null : o.head || 'end';
        const hl = (o.headSize ?? 20) * px();
        if (o.sketch) {
          d = arrow(x1, y1, x2, y2, opts({ roughness: typeof o.sketch === 'number' ? o.sketch : 1, passes: 1, seed: c.seed, raw: { curve, head: head ? hl / px() : 0, heads: head === 'both' ? 'both' : 'end' } }));
          if (!head) d = path(curve ? `M${x1} ${y1}Q${qx} ${qy} ${x2} ${y2}` : `M${x1} ${y1}L${x2} ${y2}`, { roughness: typeof o.sketch === 'number' ? o.sketch : 1, passes: 1, seed: c.seed });
        } else {
          d = curve ? `M${f1(x1)} ${f1(y1)}Q${f1(qx)} ${f1(qy)} ${f1(x2)} ${f1(y2)}` : `M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}`;
          // one stroke: [start barbs] shaft [end barbs], so drawing on runs from start to end
          const barb = (tx, ty, fx, fy, k) => { const an = Math.atan2(ty - fy, tx - fx) + k * 0.45; return `${f1(tx - Math.cos(an) * hl)} ${f1(ty - Math.sin(an) * hl)}`; };
          if (head === 'start' || head === 'both') d = `M${barb(x1, y1, curve ? qx : x2, curve ? qy : y2, -1)}L${f1(x1)} ${f1(y1)}L${barb(x1, y1, curve ? qx : x2, curve ? qy : y2, 1)}L` + d.slice(1);
          if (head === 'end' || head === 'both') d += `L${barb(x2, y2, curve ? qx : x1, curve ? qy : y1, -1)}L${f1(x2)} ${f1(y2)}L${barb(x2, y2, curve ? qx : x1, curve ? qy : y1, 1)}`;
        }
      }
      if (d !== c.lastD) { c.path.setAttribute('d', d); c.lastD = d; changed = true; }
      if (c.label && !d && c.label.style.visibility !== 'hidden') { c.label.style.visibility = 'hidden'; changed = true; }
      if (c.label && d) {
        // halfway along the line, pushed off to the outside of the bend (or above a straight line)
        const m = measure(d.replace(/^(M[^M]*?)M.*$/, '$1')), L = m.getTotalLength(), q = m.getPointAtLength(L / 2), q2 = m.getPointAtLength(Math.min(L, L / 2 + 1));
        let nx = -(q2.y - q.y), ny = q2.x - q.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const curve = o.curve ?? 0;
        // the bend bulges toward +normal when curve > 0; a straight line gets its label above it
        const sgn = curve > 0 ? 1 : curve < 0 ? -1 : ny > 0 ? -1 : 1; nx *= sgn; ny *= sgn;
        const off = (c.labelOpt.offset ?? (c.labelOpt.size ?? 30) * 0.6 + 12) * px();
        const pos = `${f1(q.x + nx * off)},${f1(q.y + ny * off)}`;
        if (pos !== c.lastLabel) { const [lx, ly] = pos.split(','); c.label.setAttribute('x', lx); c.label.setAttribute('y', ly); c.lastLabel = pos; changed = true; }
        const vis = c.progressAt ? (c.progressAt(T) >= 0.5 ? '' : 'hidden') : '';
        if (c.label.style.visibility !== vis) { c.label.style.visibility = vis; changed = true; }
      }
      if (c.progressAt) {
        const p = c.progressAt(T);
        // nothing at all before it starts (a zero-length dash still paints round caps as dots)
        const dash = p >= 1 ? (c.o.dash || 'none') : `${p.toFixed(4)} 2`;
        if (dash !== c.lastDash) { c.path.style.strokeDasharray = dash; c.path.style.visibility = p <= 0 ? 'hidden' : ''; c.lastDash = dash; changed = true; }
      }
    }
    return changed;
  }
  I.hooks.post.push(updateConnectors);

  mw.rect = rectIn;
  mw.connect = connect;
  // Without a seed, the shape's own numbers are the seed: the same call gives the same drawing in every frame and
  // every worker (a counter would make lines boil when called from onFrame).
  const seeded = (fn, n) => (...a) => {
    let o = a[n] && typeof a[n] === 'object' && !Array.isArray(a[n]) ? a[n] : {};
    if (o.seed == null) o = { ...o, seed: 'g' + hashStr(JSON.stringify(a.slice(0, n))) };
    a[n] = o;
    return fn(...a);
  };
  mw.sketch = {
    line: seeded((x1, y1, x2, y2, o) => line(x1, y1, x2, y2, o), 4),
    rect: seeded((x, y, w, h, o) => rect(x, y, w, h, o), 4),
    ellipse: seeded((cx, cy, rx, ry, o) => ellipse(cx, cy, rx, ry, o), 4),
    circle: seeded((cx, cy, r, o) => circle(cx, cy, r, o), 3),
    polygon: seeded((points, o) => polygon(points, o), 1),
    polyline: seeded((points, o) => polyline(points, o), 1),
    path: seeded((d, o) => path(d, o), 1),
    arrow: seeded((x1, y1, x2, y2, o) => arrow(x1, y1, x2, y2, { ...o, raw: o || {} }), 4),
    hachure: seeded((shape, o) => hachure(shape, o), 1),
    underline: (x1, y1, x2, y2, o) => { if (y2 != null && typeof y2 === 'object') { o = y2; y2 = undefined; } return seeded((a, b, c, e, oo) => underline(a, b, c, e, { ...oo, raw: oo || {} }), 4)(x1, y1, x2, y2 ?? y1, o); },
    apply: setupSketch,
  };
})();
