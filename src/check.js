// `check` and `snapshot`: let an AI (or a human) see problems without watching the video.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { openComposition } from './render.js';

/** If neither <html> nor <body> paints a background, treat the composition as an overlay (alpha). */
async function autoTransparent(ctx, opts) {
  if (opts.transparent) return true;
  const clear = await ctx.page.evaluate(`(() => { const t = (e) => { const c = getComputedStyle(e); return c.backgroundImage === 'none' && /rgba\\(0, 0, 0, 0\\)|transparent/.test(c.backgroundColor); }; return t(document.documentElement) && t(document.body); })()`);
  if (clear) await ctx.page.s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  return clear;
}

// ---------------------------------------------------------------------------
// Page-side analysis (stringified and evaluated in the composition page)
// ---------------------------------------------------------------------------
const PAGE_ANALYZE = String.raw`((dt, opt) => {
  const W = gm.width, H = gm.height, PX = gm.px;
  // Safe zone for vertical social video (app buttons and titles cover the edges), in px at 1080p
  const ZONES = { shorts: [220, 60, 380, 60], reels: [220, 60, 380, 60], tiktok: [220, 120, 380, 60] };
  const zname = (opt && opt.safeZone) || document.documentElement.getAttribute('data-safe-zone');
  let zone = null;
  if (zname && zname !== 'none' && zname !== 'off') { const z = ZONES[zname] || String(zname).split(/[\s,]+/).map(Number); if (z.length === 4 && z.every((v) => isFinite(v))) zone = { left: z[3] * PX, top: z[0] * PX, right: W - z[1] * PX, bottom: H - z[2] * PX, name: ZONES[zname] ? zname : 'custom' }; }
  const out = [];
  const ignored = (el) => !!el.closest('[data-check~="ignore"],[aria-hidden="true"],[data-gm-internal]');
  // data-check="overlap-ok": text in there may overlap, be covered or be crossed on purpose (a pile of cards)
  const overlapOk = (el) => !!(el && el.closest && el.closest('[data-check~="overlap-ok"]'));
  // Alpha of a computed CSS color (rgb(), rgba(), color(srgb … / a), oklch(… / a)…); 'transparent' is 0.
  const cssAlpha = (c) => {
    if (!c || c === 'none' || c === 'transparent') return 0;
    const m = /\(([^)]*)\)/.exec(c);
    if (!m) return 1;
    let a = null;
    if (/^rgba?\(/.test(c) && m[1].includes(',')) a = m[1].split(',')[3];
    else if (m[1].includes('/')) a = m[1].split('/')[1];
    if (a == null) return 1;
    a = a.trim();
    return a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
  };
  // Does a background paint (nearly) opaque? A gradient counts when all its stops are opaque, or, for a radial
  // scrim drawn behind something (a pseudo-element), when its middle is.
  const bgSolid = (cs, radialMiddle) => {
    if (cssAlpha(cs.backgroundColor) >= 0.85) return true;
    const bi = cs.backgroundImage;
    if (!bi || bi === 'none') return false;
    if (/url\(/.test(bi)) return true;
    const stops = [...bi.matchAll(/(rgba?|color|oklch|oklab|lab|lch|hsla?)\([^()]*\)|transparent/g)].map((s) => cssAlpha(s[0]));
    if (!stops.length) return false;
    return radialMiddle && /^radial-gradient/.test(bi) ? stops[0] >= 0.85 : Math.min(...stops) >= 0.85;
  };
  const isTextEl = (el) => {
    // Emoji-only text is a picture, not reading text.
    for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim() && !/^[\s\p{Extended_Pictographic}‍️⃣]+$/u.test(n.data)) return true;
    return false;
  };
  const visible = (el) => {
    let cur = el, op = 1;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return 0;
      op *= parseFloat(cs.opacity);
      // fades the runtime adds as filter: opacity() (a morph's old scene, a morph pair handing over)
      if (cs.filter !== 'none' && cs.filter.includes('opacity(')) for (const m of cs.filter.matchAll(/opacity\(([\d.]+)(%?)\)/g)) op *= parseFloat(m[1]) / (m[2] ? 100 : 1);
      if (op < 0.04) return 0;
      cur = cur.parentElement;
    }
    return op;
  };
  const textRects = (el) => {
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.data.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push(q);
    }
    return rects;
  };
  const union = (rs) => rs.reduce((a, r) => a ? { left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, null);
  const sel = (el) => gm.__selector(el);
  // Glyph boxes are taller than the visible letters; shrink them for clip/overlap tests.
  const tight = (r) => { const h = r.bottom - r.top; return { left: r.left, right: r.right, top: r.top + h * 0.2, bottom: r.bottom - h * 0.22, width: r.right - r.left, height: h * 0.58 }; };
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const inter = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  // 1. Short animations (entrances, exits, transitions) mean "moving". Camera moves and long
  //    looping/ambient animations do not: they would hide every problem.
  const animating = new Set();
  for (const a of document.getAnimations()) {
    try {
      if (a.__gmCamera) continue;
      const ct = a.effect.getComputedTiming();
      const lt = ct.localTime, d = ct.delay || 0, ad = ct.activeDuration;
      if (ct.progress != null && lt > d && lt < d + ad && isFinite(ad) && ad <= 2500) animating.add(a.effect.target);
    } catch (e) {}
  }
  const inAnim = (el) => { for (let c = el; c; c = c.parentElement) if (animating.has(c)) return true; return false; };
  const transitioning = [...animating].some((m) => m && m.parentElement && m.parentElement.hasAttribute('data-sequence'));
  // 2. Motion from any code (timeline, React, onFrame): compare with the previous sample.
  const prev = window.__gmPrevBoxes || new Map();
  const next = new Map();
  const snippet = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-gm-hidden]') || ignored(el)) continue;
    if (!isTextEl(el)) continue;
    const op = visible(el);
    if (!op) continue;
    const rs = textRects(el);
    if (!rs.length) continue;
    const u = union(rs);
    // Measure motion inside the biggest moving layer around the text (a camera world, a scene with
    // a camera move): text that sits still in a world the camera pans over is not "moving".
    let cam = null;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.offsetWidth * a.offsetHeight >= 0.4 * W * H && getComputedStyle(a).transform !== 'none') cam = a;
    }
    let bx = (u.left + u.right) / 2, by = (u.top + u.bottom) / 2, k = 1;
    if (cam) { const r = cam.getBoundingClientRect(); k = r.width / (cam.offsetWidth || r.width) || 1; bx = (bx - r.left) / k; by = (by - r.top) / k; }
    const box = { cx: bx, cy: by, k, w: (u.right - u.left) / k, h: (u.bottom - u.top) / k, op, cam, sx: (u.left + u.right) / 2, sy: (u.top + u.bottom) / 2, sw: u.right - u.left };
    next.set(el, box);
    const p = prev.get(el);
    let speedMoving = false;
    if (p && dt > 0) {
      if (p.cam === box.cam) {
        const v = (Math.hypot(box.cx - p.cx, box.cy - p.cy) * box.k) / dt;
        const sz = Math.abs(box.w - p.w) / Math.max(1, p.w) / dt + Math.abs(box.h - p.h) / Math.max(1, p.h) / dt;
        const fo = Math.abs(box.op - p.op) / dt;
        speedMoving = v > 40 * PX || sz > 0.25 || fo > 0.4;
      }
      // Fast on screen is moving too, whatever carries it (a full-frame panel pushed in, a fast camera move):
      // only slow drifts of a big layer count as "still".
      const sv = Math.hypot(box.sx - p.sx, box.sy - p.sy) / dt, ssz = Math.abs(Math.log(Math.max(1, box.sw) / Math.max(1, p.sw))) / dt;
      if (sv > 600 * PX || ssz > 0.5) speedMoving = true;
    }
    texts.push({ el, rs, u, op, moving: inAnim(el) || speedMoving, fading: !!(p && Math.abs(box.op - p.op) > 0.02) });
  }
  window.__gmPrevBoxes = next;
  // Is a camera world moving right now? Labels the camera passes over on its way to the next shot are not framing mistakes.
  const focus = (window.gm && gm.__cameraFocus) ? gm.__cameraFocus() : [];
  const prevCam = window.__gmPrevCam || new Map(), nextCam = new Map(), camMoving = new Set();
  for (const wEl of document.querySelectorAll('[data-gm-camera-world]')) {
    const r = wEl.getBoundingClientRect(), c = { x: r.left, y: r.top, s: r.width / (wEl.offsetWidth || r.width || 1) };
    nextCam.set(wEl, c);
    const p = prevCam.get(wEl);
    if (p && dt > 0 && (Math.hypot(c.x - p.x, c.y - p.y) / dt > 60 * PX || Math.abs(Math.log(c.s / p.s)) / dt > 0.03)) camMoving.add(wEl);
  }
  window.__gmPrevCam = nextCam;
  // Visible part of the text: inside the frame and inside every clipping ancestor (overflow or clip-path inset).
  const clipBoxOf = (el) => {
    let r = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 }, by = null, masked = false;
    for (let anc = el; anc && anc !== document.body; anc = anc.parentElement) {
      const acs = getComputedStyle(anc);
      if (acs.maskImage && acs.maskImage !== 'none' || acs.webkitMaskImage && acs.webkitMaskImage !== 'none') masked = true;
      if (acs.clipPath && acs.clipPath !== 'none') {
        const m = /inset\(([^)]*)\)/.exec(acs.clipPath);
        if (m) {
          const b = anc.getBoundingClientRect();
          const v = m[1].replace(/round.*/, '').trim().split(/\s+/).map((x) => ({ n: parseFloat(x) || 0, pct: x.endsWith('%') }));
          const [t0, r0 = t0, b0 = t0, l0 = r0] = v;
          const f = (x, size) => (x.pct ? (x.n / 100) * size : x.n);
          const box = { left: b.left + f(l0, b.width), top: b.top + f(t0, b.height), right: b.right - f(r0, b.width), bottom: b.bottom - f(b0, b.height) };
          r = inter(r, box);
        } else masked = true;
      }
      if (/(hidden|clip)/.test(acs.overflowX + acs.overflowY) && !anc.classList.contains('scene') && anc.getAttribute('data-sequence') == null) {
        const b = anc.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) { const n = inter(r, b); if (area(n) < area(r) - 1 && !by) by = anc; r = n; }
      }
    }
    return { r, by, masked };
  };
  // Is the text covered by something drawn on top of it (another layer, a wipe, an iris)?
  const paintsSolid = (c) => {
    // Does this element itself paint an opaque surface at that point? Big see-through layers
    // (a full-frame chart <svg>, a particle <canvas>, a gradient vignette) do not count.
    const r = c.getBoundingClientRect();
    const big = r.width * r.height > 0.5 * W * H;
    const tag = c.tagName.toLowerCase();
    if (tag === 'img' || tag === 'video') return !big;
    if (tag === 'canvas') return !big;
    if (/^(path|rect|circle|ellipse|polygon)$/.test(tag)) {
      const cs = getComputedStyle(c);
      const fillOk = cs.fill !== 'none' && !/rgba\([^)]*,\s*0(\.[0-5]\d*)?\)/.test(cs.fill) && parseFloat(cs.fillOpacity) > 0.6;
      // a thick stroke (a needle, an arrow, a chart line) also hides what is under it
      const strokeOk = cs.stroke !== 'none' && !/rgba\([^)]*,\s*0(\.[0-5]\d*)?\)/.test(cs.stroke) && parseFloat(cs.strokeOpacity) > 0.6 && parseFloat(cs.strokeWidth) >= 3;
      if (!fillOk && !strokeOk) return false;
      let op = 1; for (let a = c; a && a.nodeType === 1; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
      return op > 0.6;
    }
    if (c instanceof SVGElement) return false;
    const cs2 = getComputedStyle(c);
    const m = /rgba?\(([^)]+)\)/.exec(cs2.backgroundColor);
    const alpha = m ? (m[1].split(',')[3] != null ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    let solid = alpha > 0.6;
    // A gradient counts only if it has no see-through stops (a shine or a glow is see-through).
    if (!solid && cs2.backgroundImage !== 'none' && !big) solid = !/transparent|rgba\([^)]*,\s*0?\.[0-5]\d*\)|rgba\([^)]*,\s*0\)/.test(cs2.backgroundImage);
    if (!solid) return false;
    // faded-out things do not hide what is under them
    let op = 1; for (let a = c; a && a.nodeType === 1; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
    return op > 0.6;
  };
  // How much of the text is under something solid drawn on top of it (a wipe, a card, a needle)?
  const coverOf = (t) => {
    if (getComputedStyle(t.el).pointerEvents === 'none') return { n: 0, hits: 0, by: null };
    let hits = 0, n = 0, by = null;
    const probe = (x, y) => {
      if (x < 0 || y < 0 || x > W || y > H) return;
      n++;
      // Walk down the stack of things at that point until we reach the text.
      for (const c of document.elementsFromPoint(x, y)) {
        if (c === t.el || c.contains(t.el) || t.el.contains(c)) break;
        if (paintsSolid(c)) { hits++; by = by || c; break; }
      }
    };
    for (const q of t.rs.slice(0, 3)) for (const fx of [0.15, 0.5, 0.85]) probe(q.left + (q.right - q.left) * fx, (q.top + q.bottom) / 2);
    // covered all along the middle: also look above and below it (a caption band over the lower half of a label)
    // (and when the top or bottom edge of the letters is under something, that whole row: a band over half a label)
    const all = n > 0 && hits === n;
    for (const q of t.rs.slice(0, 3)) {
      const tq = tight(q);
      for (const fy of [0.15, 0.85]) {
        const y = tq.top + (tq.bottom - tq.top) * fy, h0 = hits;
        probe(q.left + (q.right - q.left) * 0.5, y);
        if (all || hits > h0) { probe(q.left + (q.right - q.left) * 0.15, y); probe(q.left + (q.right - q.left) * 0.85, y); }
      }
    }
    return { n, hits, by };
  };
  // clip-path shapes on the text and its ancestors (inset, polygon, circle, ellipse): a point test, or null when
  // nothing clips it. (Two scenes clipped to opposite sides of a hand-made wipe never share a pixel.)
  const clipFns = new Map();
  const clipFn = (el) => {
    if (clipFns.has(el)) return clipFns.get(el);
    const tests = [];
    for (let anc = el; anc && anc !== document.body; anc = anc.parentElement) {
      const cp = getComputedStyle(anc).clipPath;
      if (!cp || cp === 'none') continue;
      const m = /^(inset|polygon|circle|ellipse)\((.*)\)/.exec(cp.trim());
      if (!m) continue;
      const b = anc.getBoundingClientRect(), ow = anc.offsetWidth || b.width, oh = anc.offsetHeight || b.height;
      const kx = ow ? b.width / ow : 1, ky = oh ? b.height / oh : 1;
      const len = (v, size) => (/%$/.test(v) ? (parseFloat(v) / 100) * size : parseFloat(v) || 0);
      const args = m[2].replace(/\s+round\s.*$/, '');
      if (m[1] === 'inset') {
        const v = args.trim().split(/\s+/), [t0, r0 = t0, b0 = t0, l0 = r0] = v;
        const L = b.left + len(l0, ow) * kx, T = b.top + len(t0, oh) * ky, R = b.right - len(r0, ow) * kx, B = b.bottom - len(b0, oh) * ky;
        tests.push((x, y) => x >= L && x <= R && y >= T && y <= B);
      } else if (m[1] === 'polygon') {
        const pts = args.replace(/^\s*(nonzero|evenodd)\s*,/, '').split(',').map((p) => { const [px, py] = p.trim().split(/\s+/); return [b.left + len(px, ow) * kx, b.top + len(py, oh) * ky]; });
        tests.push((x, y) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; });
      } else {
        const [rad, at] = args.split(/\s+at\s+/), rs0 = rad.trim().split(/\s+/), c = (at || '50% 50%').trim().split(/\s+/);
        const cx = b.left + len(c[0], ow) * kx, cy = b.top + len(c[1] || '50%', oh) * ky;
        const side = (v, size) => (/^(closest|farthest)-side$/.test(v) || !v ? size / 2 : len(v, size));
        const rx = side(rs0[0], m[1] === 'circle' ? Math.hypot(ow, oh) / Math.SQRT2 : ow) * kx, ry = m[1] === 'circle' ? rx / kx * ky : side(rs0[1] || rs0[0], oh) * ky;
        tests.push((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
      }
    }
    const f = tests.length ? (x, y) => tests.every((tf) => tf(x, y)) : null;
    clipFns.set(el, f);
    return f;
  };
  // How much of two texts' letters cover the same pixels (with their clip-paths taken into account)
  const ovArea = (a, b) => {
    const fa = clipFn(a.el), fb = clipFn(b.el);
    let ov = 0;
    for (const ra0 of a.rs) for (const rb0 of b.rs) {
      const q = inter(tight(ra0), tight(rb0)), s = area(q);
      if (!s) continue;
      if (!fa && !fb) { ov += s; continue; }
      let n = 0, k = 0;
      for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 5; ix++) { const x = q.left + (q.right - q.left) * (ix + 0.5) / 5, y = q.top + (q.bottom - q.top) * (iy + 0.5) / 3; n++; if ((!fa || fa(x, y)) && (!fb || fb(x, y))) k++; }
      ov += s * k / n;
    }
    return ov;
  };
  const reportedBox = new Set();
  for (const t of texts) {
    const { el, u } = t;
    const cs = getComputedStyle(el);
    const tu = tight(u);
    const frame = { left: 0, top: 0, right: W, bottom: H };
    const cb = clipBoxOf(el);
    const shown = inter(inter(tu, frame), cb.r);
    // a sliver (a clip-path wipe that has not started, a label just past the edge) is not "shown"
    t.hidden = area(shown) < Math.max(4, 0.03 * area(tu)) || cb.masked && t.moving;
    // (a clip-path shape that leaves none of the text showing: hidden too)
    if (!t.hidden && clipFn(el)) { const f = clipFn(el); let any = false; for (let iy = 0; iy < 3 && !any; iy++) for (let ix = 0; ix < 7 && !any; ix++) any = f(shown.left + (shown.right - shown.left) * (ix + 0.5) / 7, shown.top + (shown.bottom - shown.top) * (iy + 0.5) / 3); if (!any) t.hidden = true; }
    const cov = t.hidden ? { n: 0, hits: 0 } : coverOf(t);
    t.covered = cov.n > 0 && cov.hits === cov.n;
    // Text of a camera world under a screen overlay (a caption band, a title card outside the world) while the camera
    // holds: the shot is framed so that its labels sit behind the overlay. (Fully covered too: that label is lost.)
    const camW0 = el.closest('[data-gm-camera-world]');
    let overlaid = false;
    if (camW0 && !t.moving && !t.hidden && cov.hits > 0 && cov.by && !camW0.contains(cov.by) && !cov.by.contains(camW0) && t.op >= 0.5 && !camMoving.has(camW0) && !transitioning && !ignored(cov.by) && !overlapOk(el) && !overlapOk(cov.by) && !cov.by.closest('[data-gm-internal]')) {
      out.push({ severity: 'warning', code: 'text-covered', selector: sel(el), text: snippet(el), message: (t.covered ? 'This text of the camera world is hidden' : 'Part of this text of the camera world is hidden') + ' behind ' + sel(cov.by) + ', a layer over the world (a caption, a card).', minSpan: 0.3, fix: 'Frame the shot so its labels clear the overlay (more padding on that side, or a different center), or move the overlay.' });
      overlaid = true;
    }
    if (t.moving || t.hidden || t.covered) continue;
    // Partly hidden behind a shape or box that is drawn on top of it
    // (something flying over it on its way somewhere does not count)
    const passing = (c) => inAnim(c) || texts.some((o) => o.moving && (o.el === c || c.contains(o.el)));
    if (!overlaid && cov.hits > 0 && cov.by && t.op >= 0.5 && !transitioning && !ignored(cov.by) && !overlapOk(el) && !overlapOk(cov.by) && !cov.by.closest('[data-gm-internal]') && !passing(cov.by)) {
      out.push({ severity: 'warning', code: 'text-covered', selector: sel(el), text: snippet(el), message: 'Part of the text is hidden behind ' + sel(cov.by) + ', which is drawn on top of it.', minSpan: 0.3, fix: 'Move one of them, or put the text above it (z-index, or later in the HTML).' });
    }
    // Inside a camera world (or data-check="crop-ok"), being cut by the frame edge is framing, not a mistake.
    const cropOk = !!el.closest('[data-gm-camera-world],[data-check~="crop-ok"]');
    // 1. Text partly outside the frame (fully outside = not shown, which is fine)
    const outX = Math.max(0, -tu.left) + Math.max(0, tu.right - W);
    const outY = Math.max(0, -tu.top) + Math.max(0, tu.bottom - H);
    // In a camera world, text passing by the edge while the camera moves is fine, but a label cut by the edge of a shot
    // at rest is worth a look (even when most of it is out of frame: "st works" of a title reads as a mistake).
    const visFrac = area(inter(tu, frame)) / Math.max(1, area(tu));
    const cropMeant = !!el.closest('[data-check~="crop-ok"]');
    const camWorld = el.closest('[data-gm-camera-world]');
    // (a label of another part of the drawing that sits half in frame is still reported: judges and viewers read a
    //  half-cut label as a mistake, whatever the shot is about)
    const overview = camWorld && focus.some((f) => f.world === camWorld && f.overview);
    if ((outX > 2 || outY > 2) && cropOk && !cropMeant && visFrac >= 0.1 && !(camWorld && camMoving.has(camWorld))) out.push({ severity: 'warning', code: 'text-offscreen', selector: sel(el), text: snippet(el), message: 'Text is cut by the frame edge while the camera is on it.', minSpan: 0.3, fix: 'Frame the shot so labels are fully in view or fully out (more padding, a slightly different center, or move the label); a neighbour half in frame reads as a mistake. If the crop is on purpose, add data-check="crop-ok" to that text or a parent.' });
    if ((outX > 2 || outY > 2) && !cropOk) out.push({ severity: 'error', code: 'text-offscreen', selector: sel(el), text: snippet(el), message: 'Text runs past the edge of the frame by ' + Math.round(Math.max(outX, outY)) + 'px.', minSpan: 0.2, fix: 'Reduce font-size, allow wrapping (max-width), or move it inside the frame.' });
    // 2. Partly cut by a box with overflow hidden (fully hidden = waiting to enter, which is fine)
    else if (cb.by && !cropOk && area(inter(tu, cb.r)) < area(tu) - 2 * Math.max(1, tu.height) && !reportedBox.has(cb.by)) {
      reportedBox.add(cb.by);
      out.push({ severity: 'error', code: 'text-clipped', selector: sel(el), text: snippet(el), message: 'Text is partly cut off by ' + sel(cb.by) + ' (overflow: hidden).', fix: 'Make the text smaller, let it wrap, or make the container bigger.' });
    }
    // 3. Spills out of its card (nearest ancestor with a visible background or border)
    let anc = el.parentElement;
    let escapes = /^(absolute|fixed)$/.test(cs.position);
    const clipText = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
    while (!escapes && !clipText && anc && anc !== document.body && !anc.classList.contains('scene')) {
      const acs = getComputedStyle(anc);
      if (acs.webkitBackgroundClip === 'text' || acs.backgroundClip === 'text') break;
      const hasBox = (acs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(acs.backgroundColor)) || acs.backgroundImage !== 'none' || parseFloat(acs.borderTopWidth) > 0 && acs.borderTopStyle !== 'none';
      if (hasBox) {
        const r = anc.getBoundingClientRect();
        const slack = 2, vslack = 0.3 * parseFloat(cs.fontSize);
        if ((u.right > r.right + slack || u.left < r.left - slack || u.bottom > r.bottom + vslack || u.top < r.top - vslack) && !reportedBox.has(anc)) {
          reportedBox.add(anc);
          out.push({ severity: 'warning', code: 'text-overflows-box', selector: sel(el), text: snippet(el), message: 'Text spills outside its box ' + sel(anc) + '.', minSpan: 0.15, fix: 'Add padding/width to the box, shorten the text, or reduce font-size.' });
        }
        break;
      }
      if (/^(absolute|fixed)$/.test(acs.position)) escapes = true;
      anc = anc.parentElement;
    }
    // 3b. Text where app buttons and titles will cover it (vertical social video)
    if (zone && t.op >= 0.5 && !el.closest('[data-check~="crop-ok"],[data-check~="safe-ok"]')) {
      const inSafe = area(inter(inter(tu, frame), zone)) / Math.max(1, area(inter(tu, frame)));
      if (inSafe < 0.85) out.push({ severity: 'warning', code: 'unsafe-zone', selector: sel(el), text: snippet(el), message: 'Text sits where the app covers the video (' + zone.name + ' safe zone: ' + Math.round(zone.top / PX) + ' px top, ' + Math.round((H - zone.bottom) / PX) + ' px bottom, ' + Math.round(zone.left / PX) + '/' + Math.round((W - zone.right) / PX) + ' px sides at 1080p).', minSpan: 0.3, fix: 'Move it toward the middle of the frame. If it does not matter when covered, add data-check="safe-ok".' });
    }
    // 4. Tiny text (visual size, after transforms)
    const fs = parseFloat(cs.fontSize);
    const lineH = t.rs.reduce((m, r) => Math.max(m, r.height), 0);
    const scaleY = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
    const visualFs = fs * (isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
    if (visualFs < 22 * PX && lineH > 0 && !overview && !(camWorld && camMoving.has(camWorld))) out.push({ severity: 'warning', code: 'tiny-text', selector: sel(el), text: snippet(el), message: 'Text is ' + Math.round(visualFs) + 'px tall in a ' + W + 'x' + H + ' frame, which is hard to read in a video.', fix: 'Use at least ' + Math.round(24 * PX) + 'px (' + Math.round(28 * PX) + 'px+ for body text).' });
    t.fontPx = visualFs;
    t.bold = parseInt(cs.fontWeight, 10) >= 600;
    // (SVG text is painted with its fill, not its CSS color; a gradient fill is judged like clip-filled text: not at all)
    const svgText = el instanceof SVGElement;
    t.color = svgText ? cs.fill : cs.color;
    t.clipText = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text' || /transparent|rgba\(\d+, \d+, \d+, 0\)/.test(cs.webkitTextFillColor || '') || (svgText && !/^(rgb|#|hsl|color|oklab|oklch|lab|lch)/.test(cs.fill));
  }
  // 4b. A line drawn through text (an arrow, the edge of a box): visible strokes that pass through the letters.
  //     Fills (a card behind a label, hatching) are fine; strokes still being drawn on, or hidden under something opaque, are skipped.
  const strokes = [];
  for (const sh of document.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse')) {
    if (sh.closest('defs,clipPath,mask,marker,pattern,symbol,[data-gm-sketch-guide],[data-gm-sketch-fill],.gm-sketch-mark,[data-gm-internal]') || ignored(sh)) continue;
    const cs = getComputedStyle(sh);
    if (cs.stroke === 'none' || /rgba\([^)]*,\s*0\)/.test(cs.stroke) || cs.visibility !== 'visible' || inAnim(sh)) continue;
    // A dashed line counts (a dashed ring through a label is still a line through it), but a draw-on that has not
    // finished (dash 1 gap 2 on pathLength 1, offset not yet 0) is only partly there: skip it.
    if (cs.strokeDasharray !== 'none') {
      const da = cs.strokeDasharray.split(/[\s,]+/).map(parseFloat), off = parseFloat(cs.strokeDashoffset) || 0;
      if (sh.getAttribute('pathLength') === '1' && da.length === 2 && da[1] >= da[0] && Math.abs(off) > 0.02) continue;
    }
    const b = sh.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    let op = parseFloat(cs.strokeOpacity);
    for (let a = sh; a && a.nodeType === 1 && op > 0.3; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
    if (op <= 0.3) continue;
    const ctm = sh.getScreenCTM && sh.getScreenCTM();
    if (!ctm || parseFloat(cs.strokeWidth) * Math.hypot(ctm.a, ctm.b) < 1.5 * PX) continue;
    // (an SVGPoint, not a DOMPoint: Chrome before ~136, e.g. the headless shell 132, throws on a DOMPoint here)
    const svg = sh.ownerSVGElement;
    strokes.push({ sh, b, inv: ctm.inverse(), pt: svg && svg.createSVGPoint ? svg.createSVGPoint() : null });
  }
  // Is the stroke covered at this point by something opaque drawn above it (a label's own card, a filled shape,
  // a sketch fill riding the line, a scrim drawn as a ::before)? Painted alpha >= 0.85 counts as covering.
  const opaqueEl = (e, x, y) => {
    const cs = getComputedStyle(e);
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return false; // a multiply highlight does not hide what is under it
    let solid = false;
    if (e instanceof SVGElement) solid = !/^(svg|g|text|tspan|use|foreignObject)$/i.test(e.tagName) && cs.fill !== 'none' && (/^url\(/.test(cs.fill) || cssAlpha(cs.fill) * parseFloat(cs.fillOpacity) >= 0.85);
    else {
      solid = /^(IMG|VIDEO|CANVAS)$/.test(e.tagName) || bgSolid(cs, false);
      // a backing drawn by ::before / ::after (judged where it overlaps the element's own box)
      if (!solid && x != null) for (const pe of ['::before', '::after']) {
        const ps = getComputedStyle(e, pe);
        if (ps.content === 'none' || ps.display === 'none' || ps.visibility !== 'visible' || parseFloat(ps.opacity) < 0.85 || !bgSolid(ps, true)) continue;
        const r = e.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { solid = true; break; }
      }
    }
    if (!solid) return false;
    let op = 1;
    for (let a = e; a && a.nodeType === 1 && op >= 0.85; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
    return op >= 0.85;
  };
  // Hit testing skips pointer-events:none (connect arrows, chart grids, overlays), so while looking at what is
  // stacked over a line, every element is made hit-testable for a moment (only after a stroke was found under text).
  let peStyle = null;
  const hitAll = (on) => {
    if (on && !peStyle) { peStyle = document.createElement('style'); peStyle.setAttribute('data-gm-internal', ''); peStyle.textContent = '*{pointer-events:auto!important}'; document.head.appendChild(peStyle); }
    else if (!on && peStyle) { peStyle.remove(); peStyle = null; }
  };
  const coveredAt = (x, y, sh) => {
    hitAll(true);
    const stack = document.elementsFromPoint(x, y);
    const k = stack.indexOf(sh);
    if (k < 0) return false;
    for (let i = 0; i < k; i++) if (stack[i] !== document.documentElement && stack[i] !== document.body && !stack[i].contains(sh) && opaqueEl(stack[i], x, y)) return true;
    return false;
  };
  if (strokes.length) for (const t of texts) {
    if (t.moving || t.hidden || t.covered || t.op < 0.5 || overlapOk(t.el)) continue;
    const tu = tight(t.u);
    let hit = null;
    for (const st of strokes) {
      const b = st.b;
      if (b.right < tu.left || b.left > tu.right || b.bottom < tu.top || b.top > tu.bottom || st.sh.closest('svg') === t.el.closest('svg') && t.el.closest('text') && false) continue;
      // (rows about 4 px apart at 1080p, so a thin line between two rows is not missed)
      const ny = Math.min(8, Math.max(3, Math.ceil((tu.bottom - tu.top) / (4 * PX))));
      for (let iy = 0; iy < ny && !hit; iy++) for (let ix = 0; ix < 7 && !hit; ix++) {
        const x = tu.left + (tu.right - tu.left) * (ix + 0.5) / 7, y = tu.top + (tu.bottom - tu.top) * (iy + 0.5) / ny;
        const p = new DOMPoint(x, y).matrixTransform(st.inv);
        let pt = p;
        if (st.pt) { st.pt.x = p.x; st.pt.y = p.y; pt = st.pt; }
        try { if (st.sh.isPointInStroke(pt) && !coveredAt(x, y, st.sh)) hit = st.sh; } catch (e) {}
      }
      if (hit) break;
    }
    if (hit) out.push({ severity: 'warning', code: 'text-over-line', selector: sel(t.el), text: snippet(t.el), message: 'A line runs through this text: ' + sel(hit) + '.', minSpan: 0.3, fix: 'Move the label off the line (or the line around it), or give the label an opaque backing (alpha 0.85+) drawn above the line.' });
  }
  hitAll(false);
  // 5a. During a scene change: text of the old scene and text of the new one on top of each other, both half visible
  //     (a crossfade of two headlines reads as a smudge; judges call it "ghosted text")
  if (transitioning) {
    const sceneOf = (e) => { for (let c = e; c && c.parentElement; c = c.parentElement) if (c.parentElement.hasAttribute('data-sequence')) return c; return null; };
    const vis = texts.filter((t) => !t.hidden && !t.covered && t.op >= 0.25 && sceneOf(t.el));
    const seen = new Set();
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j], sa = sceneOf(a.el), sb = sceneOf(b.el);
      if (sa === sb || seen.has(a.el) || seen.has(b.el) || overlapOk(a.el) || overlapOk(b.el)) continue;
      // the two halves of a morph pair fly together on purpose
      const ma = a.el.closest('[data-morph]'), mb = b.el.closest('[data-morph]');
      if (ma && mb && ma.getAttribute('data-morph') === mb.getAttribute('data-morph')) continue;
      const ov = ovArea(a, b);
      const ar = (t) => t.rs.reduce((m, r0) => m + area(tight(r0)), 0);
      if (ov > 0.2 * Math.min(ar(a), ar(b)) && Math.min(a.op, b.op) >= 0.3) {
        seen.add(a.el); seen.add(b.el);
        out.push({ severity: 'warning', code: 'ghost-overlap', selector: sel(b.el), text: snippet(b.el), message: 'During the scene change, this text and "' + snippet(a.el) + '" from the other scene are both half visible on top of each other.', minSpan: 0.15, fix: 'Use a transition that does not stack the two scenes (push-*, whip-*, cover-*, wipe-*, iris), move one of the texts, or let the old text leave before the new one enters.' });
      }
    }
  }
  // 5. Overlapping text (settled, visible, not covered)
  const live = texts.filter((t) => !t.moving && !t.hidden && !t.covered);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (transitioning) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el) || overlapOk(a.el) || overlapOk(b.el)) continue;
      const splitParent = (e) => e.closest('[data-split]');
      if (splitParent(a.el) && splitParent(a.el) === splitParent(b.el)) continue;
      // letters or short pieces of one word (tight kinetic type) are not "overlapping text"
      if (a.el.parentElement === b.el.parentElement && (a.el.textContent.trim().length <= 2 || b.el.textContent.trim().length <= 2)) continue;
      const ov = ovArea(a, b);
      const ar = (t) => t.rs.reduce((s, r) => s + r.width * r.height * 0.58, 0);
      if (ov > 0.12 * Math.min(ar(a), ar(b))) {
        out.push({ severity: 'warning', code: 'text-overlap', selector: sel(a.el), text: snippet(a.el), message: 'Text overlaps other text: ' + sel(b.el) + ' ("' + snippet(b.el) + '").', minSpan: 0.15, fix: 'Move one of them, or make sure they are not visible at the same time.' });
      }
    }
  }
  // 5c. Two readable texts on top of each other while one of them moves (an exit and the next entrance at the same
  //     time inside one scene: "Your" under "Copy."). Crossfades pass (both are never above half opacity for long),
  //     and so do morph pairs, letters of one split word and copies of the same text.
  if (!transitioning) {
    const rd = texts.filter((t) => !t.hidden && !t.covered && t.op > 0.5 && !overlapOk(t.el));
    const ar = (t) => t.rs.reduce((m, r0) => m + area(tight(r0)), 0);
    const seenM = new Set();
    for (let i = 0; i < rd.length; i++) for (let j = i + 1; j < rd.length; j++) {
      const a = rd[i], b = rd[j];
      if (!a.moving && !b.moving) continue; // settled pairs: text-overlap
      if (a.u.right < b.u.left || b.u.right < a.u.left || a.u.bottom < b.u.top || b.u.bottom < a.u.top) continue;
      if (seenM.has(a.el) || seenM.has(b.el) || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const sp = a.el.closest('[data-split]');
      if (sp && sp === b.el.closest('[data-split]')) continue;
      if (a.el.parentElement === b.el.parentElement && (a.el.textContent.trim().length <= 2 || b.el.textContent.trim().length <= 2)) continue;
      const ma = a.el.closest('[data-morph]'), mb = b.el.closest('[data-morph]');
      if (ma && mb && ma.getAttribute('data-morph') === mb.getAttribute('data-morph')) continue;
      if (snippet(a.el) === snippet(b.el)) continue;
      const ov = ovArea(a, b);
      if (ov > 0.12 * Math.min(ar(a), ar(b))) {
        seenM.add(a.el); seenM.add(b.el);
        const [m, o] = a.moving ? [a, b] : [b, a];
        out.push({ severity: 'warning', code: 'moving-overlap', selector: sel(m.el), text: snippet(m.el), message: 'This text runs over "' + snippet(o.el) + '" (' + sel(o.el) + ') while it moves, both readable: an exit and the next entrance at the same time read as a smudge.', minSpan: 0.2, fix: 'Let the old text leave (or fade below half) before the new one arrives, or move one of them. If the overlap is the point, add data-check="overlap-ok".' });
      }
    }
  }
  // 6. Broken images
  for (const img of document.images) {
    if (img.closest('[data-gm-hidden]') || ignored(img)) continue;
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) out.push({ severity: 'error', code: 'image-broken', selector: sel(img), message: 'Image did not load: ' + img.getAttribute('src'), fix: 'Check the file path (relative to the HTML file).' });
  }
  // Text boxes for the contrast pass. Fading, moving, covered or clip-filled text is not judged.
  // (text cut by the frame edge is not judged for contrast: only part of it can be measured, and the crop is its own issue)
  const inFrame = (t) => t.u.left >= -2 && t.u.top >= -2 && t.u.right <= W + 2 && t.u.bottom <= H + 2;
  // (text that is still fading, or lies partly under another element drawn over it (a scrim, a caption box), is not
  //  judged for contrast: that dimming is on purpose, and a covering box is text-covered's business)
  const underSomething = (t) => {
    const tu = tight(t.u);
    for (let ix = 0; ix < 5; ix++) {
      const x = tu.left + (tu.right - tu.left) * (ix + 0.5) / 5, y = (tu.top + tu.bottom) / 2;
      const st = document.elementsFromPoint(x, y), k = st.findIndex((e) => e === t.el || t.el.contains(e));
      if (k > 0 && st.slice(0, k).some((e) => !e.contains(t.el) && !e.closest('[data-gm-internal]'))) return true;
    }
    return false;
  };
  // The flat color right behind a text, when nothing else is painted between (its card, the page): texts with the same
  // color on the same backing at the same size class get the same contrast verdict, even when only one was measured.
  const flatBacking = (t) => {
    let bgEl = null, bg = null;
    for (let a = t.el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== 'none') return null;
      if (cssAlpha(cs.backgroundColor) >= 0.99) { bgEl = a; bg = cs.backgroundColor; break; }
      if (a !== t.el && parseFloat(cs.opacity) < 0.99) return null;
    }
    if (!bgEl) return null;
    const q = t.rs[0], st = document.elementsFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2);
    let k = st.findIndex((e) => e === t.el || t.el.contains(e));
    if (k < 0) return null;
    for (k++; k < st.length; k++) { const e = st[k]; if (e === bgEl) return bg; if (!e.contains(t.el)) return null; }
    return null;
  };
  const tNow = opt && opt.t != null ? opt.t : null;
  if (!window.__gmSigs) window.__gmSigs = {};
  window.__gmTextBoxes = transitioning ? [] : live.filter((t) => !t.clipText && t.op >= 0.75 && !t.fading && inFrame(t) && !underSomething(t)).map((t) => {
    const cs = getComputedStyle(t.el);
    // A dark/light text-shadow or outline gives text its own backing; be lenient then.
    const backed = (cs.textShadow && cs.textShadow !== 'none') || parseFloat(cs.webkitTextStrokeWidth) > 0;
    // Large text (WCAG): 24 px+, or bold 18.66 px+ (on screen, after zoom, at 1080p)
    const large = t.fontPx >= 24 * PX || (t.bold && t.fontPx >= 18.66 * PX);
    const fb = t.op >= 0.99 && !backed ? flatBacking(t) : null;
    const sig = fb ? [t.color, fb, large ? 'L' : 'N'].join('|') : null;
    const s0 = sel(t.el);
    if (sig && tNow != null) { const g = window.__gmSigs[s0]; if (g && g.sig === sig) { g.times.push(tNow); } else window.__gmSigs[s0] = { sig, text: snippet(t.el), times: [tNow] }; }
    return { sel: s0, text: snippet(t.el), rects: t.rs.map((r) => [r.left, r.top, r.width, r.height]), color: t.color, op: t.op, backed, large, sig };
  });
  // where each issue's element sits: its scene and when that scene starts (for scene-local times)
  for (const i of out) {
    try { const e = i.selector && document.querySelector(i.selector); const sc = e && (e.closest('.scene') || e.closest('[data-start],[data-duration]')); if (sc) { i.scene = sel(sc); i.sceneStart = gm.timing(sc).start; } } catch (er) {}
  }
  // the biggest readable text on screen (an "empty" frame with a heading on it is not empty)
  let maxFont = 0;
  for (const t of texts) { if (t.hidden || t.covered) continue; const k = t.el.offsetHeight ? t.el.getBoundingClientRect().height / t.el.offsetHeight : 1; maxFont = Math.max(maxFont, parseFloat(getComputedStyle(t.el).fontSize) * (isFinite(k) && k > 0 ? k : 1)); }
  return { issues: out, textCount: texts.length, maxFont: maxFont / PX, boxes: window.__gmTextBoxes.length, busy: animating.size > 0 || texts.some((t) => t.moving && !t.hidden) };
})`;

// ---------------------------------------------------------------------------
// Robotic motion (page side): where the things that move are, per sample, and which easing curves the page uses
// ---------------------------------------------------------------------------
// Per sample: [id, screen cx, cy, local cx, cy (in the parent's own px), parent scale, w, h, own scale, flags]
// flags: 1 camera world, 2 inside a camera world, 4 moves along a path (offset-path)
const PAGE_MOTION = String.raw`(() => {
  const W = gm.width, H = gm.height, out = [], names = {};
  let id = window.__gmMoId || 0;
  const cands = new Set(document.querySelectorAll('[data-gm-camera-world]'));
  for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (t && t.nodeType === 1) cands.add(t); }
  for (const el of document.body.querySelectorAll('[style]')) { const st = el.style; if (st.transform || st.translate || st.offsetDistance || st.left || st.top) cands.add(el); }
  for (const el of cands) {
    if (!el.isConnected || el === document.body || el === document.documentElement || el.closest('[data-check~="ignore"],[aria-hidden="true"],[data-gm-internal],[data-gm-hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 0.004 * W * H || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.3) continue;
    const world = el.hasAttribute('data-gm-camera-world');
    // Local motion is measured in the element's camera world when it has one (world space: a camera move is not the
    // element moving), else in its parent's own px (an SVG parent: its user units, from its screen matrix).
    const camW = world ? null : el.closest('[data-gm-camera-world]');
    const p = camW || el.offsetParent || el.parentElement;
    let pr = p ? p.getBoundingClientRect() : { left: 0, top: 0, width: W }, pk = 1;
    if (p && p.offsetWidth) pk = pr.width / p.offsetWidth || 1;
    else if (p && p.getScreenCTM) { const m = p.getScreenCTM(); if (m) { const s = Math.hypot(m.a, m.b); if (s > 1e-6) { pk = s; pr = { left: m.e, top: m.f, width: pr.width }; } } }
    const ow = el.offsetWidth || r.width, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    // blurred already (a whip transition, a blur filter on the move)
    let blurred = 0;
    for (let a = el; a && a !== document.body && !blurred; a = a.parentElement) { const m = /blur\(([\d.]+)px\)/.exec(getComputedStyle(a).filter); if (m && parseFloat(m[1]) >= 2) blurred = 8; }
    if (!el.__gmMoId) { el.__gmMoId = ++id; names[id] = gm.__selector(el); }
    // (and, for a camera world, the middle of the view in its parent's own px)
    out.push([el.__gmMoId, cx, cy, (cx - pr.left) / pk, (cy - pr.top) / pk, pk, r.width, r.height, r.width / (ow || 1), (world ? 1 : 0) | (!world && el.closest('[data-gm-camera-world]') ? 2 : 0) | (cs.offsetPath && cs.offsetPath !== 'none' ? 4 : 0) | blurred, (W / 2 - pr.left) / pk, (H / 2 - pr.top) / pk]);
  }
  window.__gmMoId = id;
  return { els: out, names };
})()`;

// Once: is motion blur off (classic motion, or turned off), and which easing curve each tween and entrance uses.
// Script tweens are read from the page's own scripts (blocks are not the author's choice and are left out).
const PAGE_EASES = String.raw`(async () => {
  const I = gm.__internal, html = document.documentElement, classic = gm.motion === 'classic';
  const off = (v) => v != null && /^(off|0|none|false|no)$/i.test(String(v).trim());
  const blurOff = classic || off(html.getAttribute('data-motion-blur')) || off(I.CONFIG && I.CONFIG.motionBlur);
  const blurExplicitOff = !classic && blurOff;
  const canon = (name) => { try { return I.cssEasing(name); } catch (e) { return String(name); } };
  const list = []; // { ease: canonical or 'natural', name }
  const add = (name, natural) => list.push(natural ? { ease: 'natural', name: 'default' } : { ease: canon(name), name: String(name) });
  // 1. entrances and exits (data-enter="name [duration] [delay] [easing]")
  for (const el of document.querySelectorAll('[data-enter],[data-exit]')) {
    if (el.closest('[data-gm-include],[data-check~="ignore"]')) continue;
    for (const attr of ['data-enter', 'data-exit']) {
      const v = el.getAttribute(attr);
      if (!v || /^\s*(none)?\s*$/.test(v)) continue;
      const toks = v.trim().split(/\s+/).slice(1), e = toks.find((t) => I.isEasingName(t));
      if (e) { add(e); continue; }
      if (!classic) { add(null, true); continue; }
      // classic default: the curve the entrance animation really has
      let got = null;
      for (const x of [el, ...el.querySelectorAll('*')]) { for (const a of x.getAnimations()) { const tm = a.effect && a.effect.getTiming(); if (tm && tm.easing && tm.easing !== 'linear' && isFinite(tm.duration) && tm.duration < 5000) { got = tm.easing; break; } } if (got) break; }
      if (got) list.push({ ease: got, name: v.trim().split(/\s+/)[0] + ' (preset default)' });
    }
  }
  // 2. CSS animations written in the page (not endless loops)
  for (const a of document.getAnimations()) {
    if (!(typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation)) continue;
    const t = a.effect && a.effect.target, tm = a.effect.getTiming();
    if (!t || t.closest('[data-gm-include]') || !isFinite(tm.iterations) || tm.iterations > 3 || !(tm.duration <= 3000)) continue;
    const kf = a.effect.getKeyframes(), e = tm.easing !== 'linear' ? tm.easing : (kf[0] && kf[0].easing) || 'ease';
    if (e === 'ease' && !classic) continue; // the CSS default, not a choice
    list.push({ ease: canon(e), name: e });
  }
  // 3. tweens in the page's scripts: .to( .from( .fromTo( .fly( .shot( with their ease (or the timeline's defaults)
  const srcs = [];
  for (const s of document.querySelectorAll('script')) {
    if (s.closest('[data-gm-include]') || (s.type && !/javascript|module|babel|jsx/i.test(s.type))) continue;
    const src = s.getAttribute('src');
    if (!src) srcs.push(s.textContent || '');
    else if (!/^\/?__gm\//.test(src) && !/^(https?:)?\/\//.test(src)) { try { srcs.push(await (await fetch(src)).text()); } catch (e) {} }
  }
  for (let code of srcs) {
    code = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\x60])\/\/[^\n]*/g, '$1');
    const dm = /defaults\s*:\s*\{[^}]*?\bease\s*:\s*(['"\x60])([^'"\x60]+)\1/.exec(code), def = dm ? dm[2] : null;
    const re = /(\b[A-Za-z_$][\w$]*)?\.(to|from|fromTo|fly|shot)\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      if (m[1] && /^[A-Z]/.test(m[1])) continue; // Array.from, Buffer.from…
      let i = re.lastIndex, depth = 1, q = null;
      for (; i < code.length && depth; i++) { const c = code[i]; if (q) { if (c === q && code[i - 1] !== '\\') q = null; } else if (c === '"' || c === "'" || c === '\x60') q = c; else if (c === '(') depth++; else if (c === ')') depth--; }
      const args = code.slice(re.lastIndex, i - 1);
      if (!/\{/.test(args)) continue;
      const em = /\bease\s*:\s*(['"\x60])([^'"\x60]+)\1/.exec(args);
      if (em) add(em[2]);
      else if (/\bease\s*:/.test(args)) continue; // computed: unknown
      else if (def) add(def);
      else if (classic) add(m[2] === 'shot' ? 'in-out-cubic' : 'power1.out');
      else add(null, true);
    }
  }
  return { classic, blurOff, blurExplicitOff, eases: list };
})()`;

/**
 * Robotic motion, from the positions sampled during the check pass. Returns issues:
 * camera-stop (a camera that brakes to a halt between moves and sets off again), fast-no-blur (fast moves with motion
 * blur off), straight-move (long straight diagonal moves), same-ease (one easing curve for nearly everything).
 */
export function motionIssues(samples, names, setup, info, step) {
  const out = [];
  if (!setup) return out;
  const W = info.width, H = info.height, PX = Math.min(W, H) / 1080, fps = info.fps, halfDiag = Math.hypot(W, H) / 2;
  const r2 = (x) => Math.round(x * 100) / 100;
  const tracks = new Map();
  for (const { t, els } of samples) for (const e of els) { if (!tracks.has(e[0])) tracks.set(e[0], []); tracks.get(e[0]).push({ t, sx: e[1], sy: e[2], lx: e[3], ly: e[4], pk: e[5], w: e[6], h: e[7], s: e[8], flags: e[9], vx: e[10], vy: e[11] }); }
  const runsOf = (ts, gap) => { const rs = []; for (const x of ts) { const l = rs[rs.length - 1]; if (l && x - l[1] <= gap) l[1] = x; else rs.push([x, x]); } return rs.map(([a, b]) => [r2(a), r2(b)]); };
  const camStops = [], fast = [], straight = [];
  for (const [id, pts] of tracks) {
    if (pts.length < 4) continue;
    const big = pts[0].flags & 1 || pts[0].w * pts[0].h >= 0.4 * W * H;
    // speed per pair of neighbouring samples (screen px per second); a gap in the samples breaks the series
    const sp = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dt = b.t - a.t;
      if (dt <= 0 || dt > 0.2) { sp.push(null); continue; }
      let v, dir = null;
      if (big) {
        // a camera (or a big layer moved like one): how fast the picture under the middle of the view slides, and
        // zooms, in its parent's px (a scene transition that moves the parent is not the camera)
        const k0 = a.s / a.pk, k1 = b.s / b.pk;
        const wa = [(a.vx - (a.lx - a.w / a.pk / 2)) / k0, (a.vy - (a.ly - a.h / a.pk / 2)) / k0], wb = [(b.vx - (b.lx - b.w / b.pk / 2)) / k1, (b.vy - (b.ly - b.h / b.pk / 2)) / k1];
        v = ((Math.hypot(wb[0] - wa[0], wb[1] - wa[1]) * k1 + Math.abs(Math.log(k1 / k0)) * halfDiag) * b.pk) / dt;
        // which way it goes: pan (screen px) and zoom (px at the frame corner), to tell a turn-around from a stop
        dir = { x: (wb[0] - wa[0]) * k1, y: (wb[1] - wa[1]) * k1, z: Math.log(k1 / k0) * halfDiag };
      } else v = (Math.hypot(b.lx - a.lx, b.ly - a.ly) * b.pk) / dt;
      sp.push({ t: (a.t + b.t) / 2, v, i, blurred: (a.flags & 8) && (b.flags & 8), dir });
    }
    // 1. a camera that stops dead between two moves: the speed drops to almost nothing and comes back within ~0.45 s
    if (pts[0].flags & 1 && step <= 0.15) {
      for (let k = 1; k < sp.length - 1; k++) {
        const c = sp[k];
        if (!c) continue;
        let pb = 0, pa = 0, okB = true, okA = true;
        for (let q = k - 1; q >= 0 && sp[q] && c.t - sp[q].t <= 0.7; q--) pb = Math.max(pb, sp[q].v);
        for (let q = k + 1; q < sp.length && sp[q] && sp[q].t - c.t <= 0.7; q++) pa = Math.max(pa, sp[q].v);
        const minPeak = Math.min(pb, pa);
        if (!(minPeak >= 250 * PX) || c.v > 0.12 * minPeak) continue;
        // how long it stays stopped
        let a = k, b = k;
        while (a > 0 && sp[a - 1] && sp[a - 1].v <= 0.12 * minPeak) a--;
        while (b < sp.length - 1 && sp[b + 1] && sp[b + 1].v <= 0.12 * minPeak) b++;
        // A move that turns around (zooms in, then straight back out; pans one way, then back) passes through zero
        // speed for an instant: that is one blended move, not a stop (a real stop dwells, or goes on the same way).
        const before = sp[a - 1], after = sp[b + 1];
        let turn = false;
        if (before && after && before.dir && after.dir && b - a + 1 <= 2) {
          const d0 = before.dir, d1 = after.dir, p0 = Math.hypot(d0.x, d0.y), p1 = Math.hypot(d1.x, d1.y);
          if (Math.abs(d0.z) > p0 && Math.abs(d1.z) > p1) turn = Math.sign(d0.z) !== Math.sign(d1.z);
          else if (p0 > 0 && p1 > 0) turn = (d0.x * d1.x + d0.y * d1.y) / (p0 * p1) < -0.5;
        }
        if (okB && okA && !turn && sp[b].t - sp[a].t <= 0.45) camStops.push({ id, t: r2((sp[a].t + sp[b].t) / 2) });
        k = b + 1;
      }
    }
    // 2. fast moves with no motion blur (per-frame displacement)
    if (setup.blurOff && (big || pts[0].w * pts[0].h >= 0.005 * W * H)) {
      for (let k = 0; k < sp.length; k++) { const c = sp[k]; if (c && !c.blurred && c.v / fps >= 40 * PX) fast.push({ id, t: c.t, d: c.v / fps }); }
    }
    // 3. long straight diagonal moves of an element (not the camera, not along a path)
    if (!big && !(pts[0].flags & 4)) {
      for (let k = 0; k < sp.length; k++) {
        if (!sp[k] || sp[k].v < 80 * PX) continue;
        // (a sharp turn starts a new leg)
        const dir = (q) => { const a = pts[sp[q].i - 1], b = pts[sp[q].i]; return Math.atan2(b.ly - a.ly, b.lx - a.lx); };
        const turn = (q) => { let d = Math.abs(dir(q) - dir(q - 1)); if (d > Math.PI) d = 2 * Math.PI - d; return d > 0.6; };
        let e = k; while (e + 1 < sp.length && sp[e + 1] && sp[e + 1].v >= 80 * PX && !turn(e + 1)) e++;
        const P = pts.slice(sp[k].i - 1, sp[e].i + 1).map((p) => [p.lx * p.pk, p.ly * p.pk]);
        const [x0, y0] = P[0], [x1, y1] = P[P.length - 1], L = Math.hypot(x1 - x0, y1 - y0);
        if (P.length >= 4 && L >= 0.25 * W && Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) >= 0.25 * L) {
          let dev = 0;
          for (const [x, y] of P) dev = Math.max(dev, Math.abs((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)) / L);
          if (dev <= 0.015 * L) straight.push({ id, t0: r2(pts[sp[k].i - 1].t), t1: r2(pts[sp[e].i].t), L: Math.round(L / PX) });
        }
        k = e;
      }
    }
  }
  const classicNote = setup.classic ? ' (data-motion="classic")' : '';
  if (camStops.length) {
    const byId = new Map(); for (const c of camStops) { if (!byId.has(c.id)) byId.set(c.id, []); byId.get(c.id).push(c.t); }
    for (const [id, ts] of byId) out.push({ severity: 'warning', code: 'camera-stop', selector: names[id], time: ts[0], until: ts[ts.length - 1], ranges: ts.map((t) => [t, t]),
      message: `The camera stops dead between moves at ${ts.slice(0, 5).map((t) => t.toFixed(1) + ' s').join(', ')}${ts.length > 5 ? ', …' : ''} (brakes to a halt, then sets off again)${classicNote}.`,
      fix: setup.classic ? 'drop data-motion="classic" so gm.camera blends back-to-back shots, or hold each shot 0.5 s+ on purpose.' : 'chain the moves so the camera keeps moving (back-to-back gm.camera shots, one tween with keyframes), or hold each shot 0.5 s+ on purpose.' });
  }
  if (fast.length) {
    const worst = fast.reduce((a, b) => (b.d > a.d ? b : a));
    const ranges = runsOf(fast.map((f) => f.t).sort((a, b) => a - b), 0.25).filter(([a, b]) => b - a >= 0.05 || fast.filter((f) => f.t >= a - 0.01 && f.t <= b + 0.01).length >= 2);
    if (ranges.length) out.push({ severity: 'warning', code: 'fast-no-blur', selector: names[worst.id], time: ranges[0][0], until: ranges[ranges.length - 1][1], ranges,
      message: `Moves ${Math.round(worst.d / PX)} px per frame (at 1080p) with no motion blur: it strobes${classicNote}.`,
      fix: setup.blurExplicitOff ? 'remove data-motion-blur="off" (fast moves get motion blur by default), or slow the move down.' : 'render with --motion-blur 8, or drop data-motion="classic" (natural motion blurs fast moves).' });
  }
  if (straight.length) {
    const seen = new Set(), list = straight.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
    out.push({ severity: 'warning', code: 'straight-move', selector: names[list[0].id], time: list[0].t0, until: list[0].t1, ranges: list.slice(0, 6).map((s) => [s.t0, s.t1]).sort((a, b) => a[0] - b[0]),
      message: `${list.slice(0, 3).map((s) => names[s.id]).join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''} ${list.length > 1 ? 'move' : 'moves'} ${list[0].L} px on a dead-straight diagonal (real things travel on slight arcs)${classicNote}.`,
      fix: setup.classic ? 'drop data-motion="classic" (moves arc by default), or move along a curve with gm.path.travel.' : 'remove arc: 0, or move along a curve with gm.path.travel (or keyframes through an offset midpoint).' });
  }
  // 4. one easing curve for nearly everything (springs and the natural defaults are not curves of that kind)
  const eases = setup.eases || [];
  if (eases.length >= 8) {
    const count = new Map();
    for (const e of eases) if (/^cubic-bezier\(/.test(e.ease)) count.set(e.ease, (count.get(e.ease) || 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / eases.length > 0.9) {
      const name = eases.find((e) => e.ease === top[0]).name;
      out.push({ severity: 'warning', code: 'same-ease', time: null, message: `${top[1]} of ${eases.length} tweens and entrances use the same curve (${name}): everything moves like one machine${classicNote}.`,
        fix: setup.classic ? "drop data-motion=\"classic\" (natural motion gives moves springs), or vary the eases: 'spring'/'out-back' for arrivals, 'in-*' for exits, 'in-out-sine' for long moves." : "leave ease out for the natural spring default, or vary it: 'spring'/'out-back' for arrivals, 'in-*' for exits, 'in-out-sine' for long moves." });
    }
  }
  return out;
}

// Once: an element with a CSS `scale` property that a gm.timeline also tweens with scale. The timeline writes
// `transform`, which the browser applies on top of the individual property: scale: 0 in CSS and a tween to scale 1
// multiply to 0, so the element never shows. (translate and rotate add up, which is often meant: translate: -50% -50%
// for centering plus a tweened x, a resting tilt plus a tweened rotate.)
const PAGE_CSS_VS_TWEEN = String.raw`(() => {
  if (!gm.__tweenedTransforms) return [];
  const list = gm.__tweenedTransforms(), out = [], seen = new Set();
  if (!list.length) return out;
  const rules = [];
  const visit = (rs) => { for (const r of rs) { if (r.selectorText != null && r.style && r.style.scale) rules.push(r); if (r.cssRules) visit(r.cssRules); } };
  for (const sh of document.styleSheets) { try { visit(sh.cssRules); } catch (e) {} }
  const declared = (el, prop) => {
    const own = el.getAttribute('style') || '';
    const m = new RegExp('(^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(own);
    if (m && !el.closest('[data-morph]')) return m[2].trim();
    let v = null;
    for (const r of rules) { const x = r.style.getPropertyValue(prop); if (!x) continue; try { if (el.matches(r.selectorText)) v = x.trim(); } catch (e) {} }
    return v;
  };
  for (const { el, props } of list) {
    if (seen.has(el) || el.closest('[data-check~="ignore"],[data-gm-internal]')) continue;
    for (const [css, tw] of [['scale', ['scale', 'scaleX', 'scaleY']]]) {
      const used = props.filter((p) => tw.includes(p));
      if (!used.length) continue;
      const v = declared(el, css);
      if (!v || v === 'none' || /^1(\s+1)*$/.test(v)) continue;
      seen.add(el);
      out.push({ severity: 'warning', code: 'css-scale-vs-tween', selector: gm.__selector(el), time: null,
        message: 'This element has CSS ' + css + ': ' + v + ' and a gm.timeline tween on ' + used.join('/') + '. The timeline writes transform, which the browser combines with the ' + css + ' property: they multiply, so scale: 0 in CSS stays 0 whatever the tween does.',
        fix: 'Remove ' + css + ' from the CSS and give the start value to the timeline instead (fromTo / from, or gm.set), or set it with transform in the CSS.' });
      break;
    }
  }
  return out;
})()`;

const PAGE_HIDE_TEXT =`(() => { let s = document.getElementById('__gm_hide'); if (!s) { s = document.createElement('style'); s.id='__gm_hide'; document.head.appendChild(s); }
  s.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke-color:transparent!important;caret-color:transparent!important;text-decoration-color:transparent!important} text,text *{fill:transparent!important;stroke:transparent!important} .gm-caret{visibility:hidden!important}';
  return true; })()`;
const PAGE_SHOW_TEXT = `(() => { const s = document.getElementById('__gm_hide'); if (s) s.remove(); return true; })()`;

function contrastScript(dataUrl, scale) {
  return `(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const S = ${scale};
  const lum = (r, g2, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g2) + 0.0722 * f(b); };
  // Any CSS color (rgb, hsl, oklab, color-mix…) → sRGB bytes, by painting one pixel.
  const pc = document.createElement('canvas'); pc.width = pc.height = 1; const pg = pc.getContext('2d', { willReadFrequently: true });
  const parse = (s) => { pg.clearRect(0, 0, 1, 1); pg.fillStyle = '#000'; pg.fillStyle = s; pg.fillRect(0, 0, 1, 1); const d = pg.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const res = [];
  for (const b of window.__gmTextBoxes || []) {
    const samples = [];
    for (const [x, y, w, h] of b.rects) {
      const X = Math.max(0, Math.floor(x * S)), Y = Math.max(0, Math.floor(y * S)), Wd = Math.min(c.width - X, Math.ceil(w * S)), Hd = Math.min(c.height - Y, Math.ceil(h * S));
      if (Wd <= 0 || Hd <= 0) continue;
      const d = g.getImageData(X, Y, Wd, Hd).data;
      const step = Math.max(1, Math.floor((Wd * Hd) / 4000));
      for (let i = 0; i < Wd * Hd; i += step) samples.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]);
    }
    if (!samples.length) continue;
    const [r, gg, bb, a0] = parse(b.color);
    const a = a0 * b.op;
    const opaque = samples.filter((p) => p[3] >= 128);
    if (opaque.length < samples.length * 0.5) continue; // transparent background (overlay render): nothing to judge against
    const ratios = opaque.map(([R, G, B]) => {
      const tr = r * a + R * (1 - a), tg = gg * a + G * (1 - a), tb = bb * a + B * (1 - a);
      const L1 = lum(tr, tg, tb), L2 = lum(R, G, B);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    }).sort((x, y) => x - y);
    const low = ratios[Math.floor(ratios.length * 0.1)];   // the darkest/brightest 10% behind the text
    const typical = ratios[Math.floor(ratios.length * 0.5)];
    // Targets (WCAG): 4.5:1 for normal text, 3:1 for large text (>= 24px, or bold >= 18.66px at 1080p),
    // 1.6:1 when the text has its own shadow or outline. Error below 2/3 of the target.
    const need = b.backed ? 1.6 : b.large ? 3 : 4.5;
    const kind = b.backed ? 'text with a shadow/outline' : b.large ? 'large text' : 'normal text';
    const partly = typical >= need && typical < need * 1.5 && low < need * 0.66;
    if (typical < need || partly) {
      const val = partly ? low : typical;
      res.push({ severity: val < need * 0.66 ? 'error' : 'warning', code: 'low-contrast', selector: b.sel, text: b.text,
        message: (partly ? 'Parts of this text have low contrast (' + low.toFixed(1) + ':1 where the background is busiest, ' + typical.toFixed(1) + ':1 typical)' : 'Text contrast is ' + typical.toFixed(1) + ':1') + '. Target for ' + kind + ' is ' + need + ':1.',
        fix: partly ? 'Put a solid or semi-opaque backing behind the text, or add a text-shadow.' : 'Use a lighter/darker text color, add a backing, or a text-shadow.', sig: partly ? null : b.sig });
    }
  }
  return res;
})()`;
}

/** Pick moments worth looking at: each clip once it has settled (late in the clip, before it leaves). */
function keyTimes(info, max = 12) {
  const fps = info.fps, dur = info.duration;
  const lastT = Math.max(0, dur - 1 / fps);
  const set = new Set();
  const add = (t) => set.add(Math.round(Math.min(lastT, Math.max(0, t)) * fps) / fps);
  const clips = info.clips.filter((c) => c.end - c.start > 0.3);
  if (!clips.length) { for (let i = 0; i < 6; i++) add((dur * (i + 0.5)) / 6); }
  for (const c of clips) {
    const d = c.end - c.start;
    // ~85% through the clip: entrances are done, exits/transitions have not started yet
    add(c.start + Math.max(Math.min(d * 0.85, d - 0.75), Math.min(d * 0.5, 1)));
    // long clips (one long scene driven by code) also get evenly spaced moments
    if (d > 4.5) { const n = Math.min(8, Math.floor(d / 1.2)); for (let k = 1; k <= n; k++) add(c.start + (d * k) / (n + 1)); }
  }
  // one long camera scene: each shot once the camera has arrived (and before it leaves)
  for (const c of info.cameraShots || []) {
    const end = c.next ?? dur;
    if (end - c.arrive > 0.25) add(Math.min(c.arrive + Math.max(0.3, (end - c.arrive) * 0.6), end - 0.1));
  }
  add(Math.min(0.5, dur / 2));
  add(lastT);
  let times = [...set].sort((a, b) => a - b);
  times = times.filter((t, i) => i === 0 || t - times[i - 1] > 0.25);
  while (times.length > max) {
    let bi = 1, bd = Infinity;
    for (let i = 1; i < times.length - 1; i++) { const dd = times[i + 1] - times[i - 1]; if (dd < bd) { bd = dd; bi = i; } }
    times.splice(bi, 1);
  }
  return times;
}

/**
 * Check a composition for problems. Returns { ok, errors, warnings, issues, info }.
 */
export async function check(input, opts = {}) {
  const ctx = await openComposition(input, { ...opts, mode: 'render' });
  const issues = [];
  await autoTransparent(ctx, opts);
  const push = (arr, t) => { for (const i of arr) issues.push({ time: t == null ? i.time ?? null : Math.round(t * 100) / 100, ...i }); };
  try {
    const info = ctx.info;
    push(info.issues);
    const fps = info.fps;
    const lastT = Math.max(0, info.duration - 1 / fps);
    // One forward pass over the video (works for stateful pages too). Elements that are moving
    // (seen by comparing samples) are skipped; problems must last 2 samples to count.
    const from = opts.from != null ? Math.max(0, +opts.from) : 0, to = opts.to != null ? Math.min(lastT, +opts.to) : lastT;
    const step = opts.at != null ? 1 / fps : Math.max(1 / fps, Math.min(opts.fast ? 0.25 : 0.12, info.duration / 300));
    const planned = new Set();
    if (opts.at != null) { const at = +opts.at; for (const d of [-2, -1, 0]) planned.add(Math.round(Math.max(0, at + d / fps) * fps) / fps); }
    else {
      for (let t = from; t <= to + 1e-9; t += step) planned.add(Math.round(t * fps) / fps);
      for (const k of keyTimes(info, 24)) if (k >= from && k <= to) planned.add(k);
    }
    const times = [...planned].sort((a, b) => a - b);
    const contrastEvery = opts.at != null ? 0 : Math.max((to - from) / (opts.contrastSamples || 10), 0.4);
    let lastContrast = -Infinity, prevT = null;
    const perSample = [];
    // Pacing: a tiny grey picture of the frame every half second finds long stretches where nothing moves.
    const GW = 192, GH = 108;
    const pace = opts.at == null && opts.pacing !== false;
    if (pace) await ctx.page.evaluate(`window.__gmGrid = async (src) => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = ${GW}; c.height = ${GH}; const g = c.getContext('2d'); g.drawImage(im, 0, 0, ${GW}, ${GH}); const d = g.getImageData(0, 0, ${GW}, ${GH}).data; const o = new Array(${GW * GH}); for (let i = 0, j = 0; i < d.length; i += 4, j++) o[j] = (54 * d[i] + 183 * d[i + 1] + 19 * d[i + 2]) >> 8; return o; }`);
    let lastGrid = null, lastGridT = -Infinity, busy = false;
    let motion = null;
    const openFrames = []; // the first half second: is anything on screen?
    const emptyGrid = []; // [t, almost nothing on screen] every half second
    const change = []; // [t, fraction of the picture that changed since the previous grid]
    // robotic motion: where the moving things are at every sample, and the easing curves in use
    const watchMotion = opts.at == null && opts.motion !== false;
    let moSetup = null;
    const moSamples = [], moNames = {};
    if (watchMotion) { try { moSetup = await ctx.page.evaluate(PAGE_EASES); } catch (e) { moSetup = null; } }
    if (opts.at == null) { try { push(await ctx.page.evaluate(PAGE_CSS_VS_TWEEN)); } catch (e) {} }
    for (const t of times) {
      await ctx.page.seek(t);
      const a = await ctx.page.evaluate(`(${PAGE_ANALYZE})(${prevT == null ? 0 : t - prevT}, ${JSON.stringify({ safeZone: opts.safeZone || null, t })})`);
      prevT = t;
      if (moSetup) { try { const m = await ctx.page.evaluate(PAGE_MOTION); moSamples.push({ t, els: m.els }); Object.assign(moNames, m.names); } catch (e) {} }
      if (opts.at != null && Math.abs(t - +opts.at) > 0.5 / fps) continue; // warm-up samples only feed motion detection
      perSample.push({ t, issues: a.issues });
      busy = busy || !!a.busy; // an entrance, exit or moving text since the last grid
      if (pace && t - lastGridT >= 0.49) {
        const jpg = await ctx.page.capture('jpeg', 60);
        const g = await ctx.page.evaluate(`window.__gmGrid('data:image/jpeg;base64,${jpg.toString('base64')}')`);
        { const srt = [...g].sort((x, y) => x - y), med = srt[srt.length >> 1]; let off = 0; for (const v of g) if (Math.abs(v - med) > 10) off++;
          // (the opening frame: empty = no readable text and almost no edges; a smooth gradient or a flat color is empty)
          if (t < 0.6) { let edge = 0; for (let i = 0; i < g.length; i++) if ((i % GW < GW - 1 && Math.abs(g[i] - g[i + 1]) > 12) || (i + GW < g.length && Math.abs(g[i] - g[i + GW]) > 12)) edge++; openFrames.push({ t, empty: edge / g.length < 0.01 && !(a.maxFont >= 24) }); }
          emptyGrid.push([t, off / g.length < 0.015 && !(a.maxFont >= 24)]); }
        if (lastGrid) { let n = 0; for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - lastGrid[i]) > 6) n++; change.push([t, n / g.length, busy]); }
        lastGrid = g; lastGridT = t; busy = false;
      }
      if (a.boxes && t - lastContrast >= contrastEvery) {
        lastContrast = t;
        await ctx.page.evaluate(PAGE_HIDE_TEXT);
        const png = await ctx.page.capture('png');
        await ctx.page.evaluate(PAGE_SHOW_TEXT);
        const c = await ctx.page.evaluate(contrastScript('data:image/png;base64,' + png.toString('base64'), opts.scale || 1));
        push(c, t);
      }
    }
    // Keep layout problems that last at least two samples in a row (or the single --at moment).
    const key = (i) => i.code + '|' + i.selector;
    for (let k = 0; k < perSample.length; k++) {
      const { t, issues: list } = perSample[k];
      const nb = new Set([...(perSample[k - 1]?.issues || []), ...(perSample[k + 1]?.issues || [])].map(key));
      push(list.filter((i) => opts.at != null || nb.has(key(i)) || i.code === 'image-broken'), t);
    }
    // Same text color on the same flat backing at the same size class: same contrast verdict for every such text
    // (only some of them were on screen and settled when a contrast picture was taken).
    if (opts.at == null) {
      const flagged = issues.filter((i) => i.code === 'low-contrast' && i.sig);
      if (flagged.length) {
        const sigs = await ctx.page.evaluate('window.__gmSigs || {}');
        const has = new Set(issues.filter((i) => i.code === 'low-contrast').map((i) => i.selector));
        for (const [selector, g] of Object.entries(sigs)) {
          if (has.has(selector)) continue;
          const src = flagged.find((i) => i.sig === g.sig);
          if (!src) continue;
          has.add(selector);
          const ts = g.times.filter((t) => t >= from - 1e-6 && t <= to + 1e-6);
          for (const t of pickSpread(ts, 12)) issues.push({ ...src, selector, text: g.text, time: Math.round(t * 100) / 100 });
        }
      }
    }
    for (const i of issues) delete i.sig;
    const logs = groupLogs(await ctx.page.evaluate('window.gm && gm.__logs ? gm.__logs(0) : []'));
    if (change.length) issues.push(...stillStretches(change, info, from, to));
    if (moSetup) issues.push(...motionIssues(moSamples, moNames, moSetup, info, step));
    if (from === 0 && openFrames.length >= 2 && openFrames.every((o) => o.empty)) issues.push({ severity: 'warning', code: 'empty-start', time: 0, message: 'The first half second shows only the background. The first frame is often the thumbnail, and the hook: viewers decide in the first second.', fix: 'Show something from frame 0 (a shape, the background art, the first word already in place), or start the first entrance at 0.' });
    // Almost nothing on screen for a second or more in the middle (a camera between two far-apart parts, a gap
    // between scenes, a zoom so far out that everything is a speck)
    for (let i = 0; i < emptyGrid.length; i++) {
      if (!emptyGrid[i][1]) continue;
      let j = i; while (j + 1 < emptyGrid.length && emptyGrid[j + 1][1]) j++;
      const a0 = emptyGrid[i][0], b0 = emptyGrid[j][0];
      if (j > i && a0 > 0.6) issues.push({ severity: 'warning', code: 'empty-frame', time: Math.round(a0 * 100) / 100, until: Math.round(b0 * 100) / 100, ranges: [[Math.round(a0 * 100) / 100, Math.round(b0 * 100) / 100]], message: 'Almost nothing is on screen from ' + a0.toFixed(1) + ' s to ' + b0.toFixed(1) + ' s.', fix: 'Keep something in view: move the camera between parts that are closer together (or faster), start the next element sooner, or do not zoom out that far.' });
      i = j;
    }
    motion = change.length ? { every: 0.5, from: change[0][0] - 0.5, values: change.map(([, f, b]) => Math.round((b ? Math.max(f, 0.06) : f) * 1000) / 1000) } : null;
    let merged = mergeIssues(issues, step * 2.5, Math.max(step * 2.5, contrastEvery * 1.6));
    // Some problems only matter if they last (a label sliding past the frame edge during a pan is fine).
    if (opts.at == null) merged = merged.filter((i) => {
      if (!i.minSpan) return true;
      if (i.ranges) i.ranges = i.ranges.filter(([a, b]) => b - a >= i.minSpan - 1e-6);
      if (!i.ranges || !i.ranges.length) return false;
      i.time = i.ranges[0][0]; i.until = i.ranges[i.ranges.length - 1][1];
      return true;
    });
    for (const i of merged) delete i.minSpan;
    merged = groupMany(merged);
    // A script that failed can make the video look still or empty: say so instead of sending the reader on a hunt.
    if (merged.some((i) => i.code === 'script-error')) for (const i of merged) if (i.code === 'still' || i.code === 'empty-start') i.message += ' This may only be because of the script error: fix that first.';
    const errors = merged.filter((i) => i.severity === 'error').length;
    const warnings = merged.filter((i) => i.severity === 'warning').length;
    return { ok: errors === 0, errors, warnings, issues: merged, info: summarizeInfo(info), motion, logs };
  } finally {
    await ctx.page.close();
    await ctx.server.close();
  }
}

/** gm.log() lines: the same message at neighbouring times becomes one line with a time range and a count. */
export function groupLogs(list) {
  const out = [];
  for (const l of list || []) {
    const last = out[out.length - 1];
    if (last && last.msg === l.msg && l.t - last.until <= 0.6) { last.until = l.t; last.count++; }
    else out.push({ time: l.t, until: l.t, count: 1, msg: l.msg });
  }
  return out;
}

/** Long stretches where (almost) nothing on screen changes: viewers read these as the video stalling. */
function stillStretches(change, info, from, to) {
  const out = [];
  const QUIET = 0.05; // under 5% of the picture changed in half a second, and nothing entering, leaving or moving
  let start = null, prevT = from;
  const flush = (end, atEnd) => {
    if (start == null) return;
    const len = end - start;
    // (an end card that sits still for ~2 s already reads as dead air: judges named it in most videos of round 8)
    if (len >= (atEnd ? 1.9 : 2.5) - 1e-6) {
      const r = (x) => Math.round(x * 100) / 100;
      out.push({ severity: 'warning', code: 'still', time: r(start), until: r(end), ranges: [[r(start), r(end)]],
        message: 'Little changes on screen from ' + start.toFixed(1) + ' s to ' + end.toFixed(1) + ' s (' + len.toFixed(1) + ' s' + (atEnd ? ', at the end' : '') + '). Viewers read this as the video stalling.',
        fix: atEnd ? 'End sooner (shorter last scene), or keep a little life in the end card: a slow camera push, a shine, a looping accent.' : 'Cut this hold shorter, or start the next beat earlier: a camera move, the next element entering, a counter or a highlight.' });
    }
    start = null;
  };
  for (const [t, f, busy] of change) {
    if (f < QUIET && !busy) { if (start == null) start = prevT; }
    else flush(prevT, false);
    prevT = t;
  }
  flush(Math.min(to + 1 / info.fps, info.duration), to >= info.duration - 2 / info.fps);
  return out;
}

/** Many pieces of text with the same problem at the same times (e.g. every token of a code block
 *  after one camera move) → one issue that names their common parent. */
function groupMany(list) {
  const groups = new Map();
  for (const i of list) {
    if (!i.selector || !i.ranges) continue;
    const k = i.code + '|' + i.severity + '|' + JSON.stringify(i.ranges);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const drop = new Set(), add = [];
  for (const g of groups.values()) {
    if (g.length < 4) continue;
    const parts = g.map((i) => i.selector.split(' > '));
    let common = [];
    for (let d = 0; d < parts[0].length; d++) { const seg = parts[0][d]; if (parts.every((p) => p[d] === seg)) common.push(seg); else break; }
    for (const i of g) drop.add(i);
    add.push({ ...g[0], selector: common.length ? common.join(' > ') : g[0].selector, text: g.length + ' pieces of text, e.g. "' + (g[0].text || '') + '"', message: g[0].message + ' (the same for ' + (g.length - 1) + ' more inside it)' });
  }
  if (!drop.size) return list;
  const rank = { error: 0, warning: 1, info: 2 };
  return [...list.filter((i) => !drop.has(i)), ...add].sort((a, b) => rank[a.severity] - rank[b.severity] || (a.time ?? -1) - (b.time ?? -1));
}

function pickSpread(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** Same issue at many times → one entry listing when it happens (separate ranges). */
function mergeIssues(list, gap = 0.3, contrastGap = gap) {
  const rank = { error: 0, warning: 1, info: 2 };
  const map = new Map();
  for (const i of list) {
    const k = [i.code, i.selector || i.message].join('|');
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...i, times: i.time != null ? [i.time] : [], own: i.ranges || null }); continue; }
    if (i.time != null) cur.times.push(i.time);
    if (rank[i.severity] < rank[cur.severity]) { cur.severity = i.severity; cur.message = i.message; }
  }
  const out = [...map.values()].map((i) => {
    const ts = [...new Set(i.times)].sort((a, b) => a - b);
    const r = { ...i };
    delete r.times; delete r.own;
    // an issue that knows its own time span (a still stretch, an empty stretch) keeps it
    if (i.own && ts.length <= 1) { r.ranges = i.own; r.time = i.own[0][0]; r.until = i.own[i.own.length - 1][1]; }
    else if (ts.length) {
      const ranges = [];
      const g = i.code === 'low-contrast' ? contrastGap : gap;
      for (const t of ts) { const l = ranges[ranges.length - 1]; if (l && t - l[1] <= g + 1e-6) l[1] = t; else ranges.push([t, t]); }
      r.time = ts[0];
      if (ts.length > 1) r.until = ts[ts.length - 1];
      r.ranges = ranges;
    }
    return r;
  });
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.time ?? -1) - (b.time ?? -1));
}

function summarizeInfo(info) {
  return { width: info.width, height: info.height, fps: info.fps, duration: info.duration, frames: info.frames, clips: info.clips.length, media: info.media.length };
}

/** How much changes on screen over time, as a text strip (one mark per half second). */
export function motionStrip(m) {
  const bars = ' ▁▂▃▄▅▆▇█';
  const marks = m.values.map((f) => bars[f < 0.02 ? 0 : Math.max(1, Math.min(8, Math.ceil((f / 0.5) * 8)))]).join('');
  let ruler = '';
  for (let i = 0; i < m.values.length; i += 4) ruler += String(Math.round(m.from + i * m.every)).padEnd(4).slice(0, 4);
  return ['motion  |' + marks + '|  (one mark = ' + m.every + ' s, taller = more of the picture changing)', '        ' + ' ' + ruler + 's'];
}

export function formatReport(rep, { file } = {}) {
  const lines = [];
  const i = rep.info;
  lines.push(`${file ? basename(file) + ': ' : ''}${i.width}x${i.height} ${i.fps}fps ${i.duration.toFixed(2)}s, ${i.clips} timed elements`);
  if (rep.motion) lines.push(...motionStrip(rep.motion));
  if (rep.logs && rep.logs.length) {
    for (const l of rep.logs.slice(0, 30)) lines.push(`log ${l.time.toFixed(2)}s${l.until > l.time ? '–' + l.until.toFixed(2) + 's' : ''}${l.count > 1 ? ' (' + l.count + 'x)' : ''}  ${l.msg}`);
    if (rep.logs.length > 30) lines.push(`log … ${rep.logs.length - 30} more (--json for all)`);
  }
  if (!rep.issues.length) { lines.push('✓ No problems found.'); return lines.join('\n'); }
  for (const x of rep.issues) {
    const rg = (r) => (r[0] === r[1] ? `${r[0].toFixed(2)}s` : `${r[0].toFixed(2)}–${r[1].toFixed(2)}s`);
    let when = x.time == null ? '' : x.ranges ? ' at ' + x.ranges.slice(0, 4).map(rg).join(', ') + (x.ranges.length > 4 ? ` (+${x.ranges.length - 4} more)` : '') : ` at ${x.time.toFixed(2)}s`;
    if (x.time != null && x.scene && x.sceneStart > 0) when += ` (${(x.time - x.sceneStart).toFixed(2)}s into ${x.scene})`;
    lines.push(`${x.severity === 'error' ? '✖' : x.severity === 'warning' ? '⚠' : 'ℹ'} [${x.code}]${when}${x.selector ? '  ' + x.selector : ''}${x.text ? '  "' + x.text + '"' : ''}`);
    lines.push(`    ${x.message}`);
    if (x.fix) lines.push(`    fix: ${x.fix}`);
  }
  lines.push(`${rep.errors} error${rep.errors === 1 ? '' : 's'}, ${rep.warnings} warning${rep.warnings === 1 ? '' : 's'}`);
  return lines.join('\n');
}

/**
 * Snapshot: render key moments into PNGs plus one contact sheet image.
 */
export async function snapshot(input, opts = {}) {
  const ctx = await openComposition(input, { ...opts, mode: 'render' });
  try {
    const info = ctx.info;
    opts = { ...opts, transparent: await autoTransparent(ctx, opts) };
    const fps = info.fps;
    const lastT = Math.max(0, info.duration - 1 / fps);
    let times;
    const sec = (v) => { const s0 = String(v).trim(); return /f$/.test(s0) ? parseFloat(s0) / fps : parseFloat(s0); };
    const from = opts.from != null ? sec(opts.from) : 0, to = opts.to != null ? Math.min(lastT, sec(opts.to)) : lastT;
    if (opts.times) {
      // (with --from/--to too: only the times inside that range)
      times = String(opts.times).split(',').map(sec).filter((x) => isFinite(x));
      if (opts.from != null || opts.to != null) {
        const all = times, hi = opts.to != null ? sec(opts.to) : Infinity;
        times = all.filter((t) => t >= from - 1e-9 && t <= hi + 1e-9);
        if (!times.length) throw new Error(`None of the --times (${all.join(', ')}) is inside --from ${opts.from ?? 0} --to ${opts.to ?? 'end'}.`);
      }
    }
    else if (opts.every) { times = []; const st = Math.max(1 / fps, sec(opts.every)); for (let t = from; t <= to + 1e-9; t += st) times.push(t); }
    else if (opts.transitions) {
      // start, middle and end of every scene transition, plus each scene's first frame
      times = [];
      for (const c of info.clips) if (c.scene) times.push(c.start);
      for (const tr of info.transitions || []) times.push(tr.start, (tr.start + tr.end) / 2, tr.end);
      times = times.filter((t) => t >= from && t <= to);
    }
    else times = [...(from === 0 ? [0] : []), ...keyTimes(info, opts.max || 12).filter((t) => t >= from && t <= to)];
    times = [...new Set(times.map((t) => Math.round(t * fps) / fps))].sort((a, b) => a - b);
    if (times.length > 120) throw new Error(`That is ${times.length} frames; use a shorter range (--from/--to) or a bigger --every.`);
    times = times.map((t) => Math.round(Math.min(lastT, Math.max(0, t)) * fps) / fps);
    const dir = resolve(opts.output || join(dirname(ctx.file), 'snapshots'));
    mkdirSync(dir, { recursive: true });
    const files = [];
    const thumbs = [];
    let n = 0;
    for (const t of times) {
      if (opts.onProgress) opts.onProgress(++n, times.length);
      await ctx.page.seek(t);
      const png = await ctx.page.capture('png');
      const f = join(dir, `t${t.toFixed(2).replace('.', '_')}s.png`);
      if (!opts.sheetOnly) { writeFileSync(f, png); files.push(f); }
      const thumb = opts.transparent ? png : await ctx.page.capture('jpeg', 88);
      thumbs.push({ t, data: thumb.toString('base64'), mime: opts.transparent ? 'png' : 'jpeg', frame: Math.round(t * fps), scene: sceneAt(info, t) });
    }
    const sheet = join(dir, 'sheet.png');
    // --grid: thirds, the center and the safe zone (if any) drawn over every picture, to judge placement
    let overlay = '';
    if (opts.grid) {
      const W = info.width, H = info.height, PX = Math.min(W, H) / 1080;
      const zn = opts.safeZone || await ctx.page.evaluate(`document.documentElement.getAttribute('data-safe-zone')`).catch(() => null);
      const Z = { shorts: [220, 60, 380, 60], reels: [220, 60, 380, 60], tiktok: [220, 120, 380, 60] }[zn] || (zn && String(zn).split(/[\s,]+/).map(Number).length === 4 ? String(zn).split(/[\s,]+/).map(Number) : null);
      const ln = (x1, y1, x2, y2, c) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${2 * PX}" vector-effect="non-scaling-stroke"/>`;
      overlay = `<svg class="ov" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ln(W / 3, 0, W / 3, H, '#0ff8')}${ln((2 * W) / 3, 0, (2 * W) / 3, H, '#0ff8')}${ln(0, H / 3, W, H / 3, '#0ff8')}${ln(0, (2 * H) / 3, W, (2 * H) / 3, '#0ff8')}${ln(W / 2 - 30 * PX, H / 2, W / 2 + 30 * PX, H / 2, '#f0f')}${ln(W / 2, H / 2 - 30 * PX, W / 2, H / 2 + 30 * PX, '#f0f')}${Z ? `<rect x="${Z[3] * PX}" y="${Z[0] * PX}" width="${W - (Z[1] + Z[3]) * PX}" height="${H - (Z[0] + Z[2]) * PX}" fill="none" stroke="#ff0" stroke-width="2" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>` : ''}</svg>`;
    }
    const cols = opts.cols || (times.length <= 4 ? 2 : times.length <= 9 ? 3 : 4);
    const cellW = Math.round(Math.min(640, 1920 / cols));
    const cellH = Math.round((cellW * info.height) / info.width);
    const rows = Math.ceil(thumbs.length / cols);
    const sheetW = cols * cellW + (cols + 1) * 12;
    const sheetH = rows * (cellH + 34) + (rows + 1) * 12 + 40;
    const html = `<!doctype html><html><head><style>
      html,body{margin:0;background:#111;font:14px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ddd;width:${sheetW}px;height:${sheetH}px;overflow:hidden}
      header{height:40px;display:flex;align-items:center;padding:0 12px;color:#aaa}
      .g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:12px;padding:0 12px 12px}
      figure{margin:0;position:relative} .ov{position:absolute;left:0;top:0;width:${cellW}px;height:${cellH}px;pointer-events:none} img{display:block;width:${cellW}px;height:${cellH}px;outline:1px solid #333;background:repeating-conic-gradient(#3a3a3a 0% 25%,#2a2a2a 0% 50%) 50%/24px 24px}
      figcaption{height:34px;display:flex;align-items:center;gap:8px;color:#eee} b{color:#fff} span{color:#999}
    </style></head><body><header>${escapeHtml(basename(ctx.file))} · ${info.width}x${info.height} · ${info.fps}fps · ${info.duration.toFixed(2)}s</header><div class="g">${thumbs.map((x) => `<figure><img src="data:image/${x.mime};base64,${x.data}">${overlay}<figcaption><b>${x.t.toFixed(2)}s</b><span>frame ${x.frame}${x.scene ? ' · ' + escapeHtml(x.scene) : ''}</span></figcaption></figure>`).join('')}</div></body></html>`;
    const png = await renderHtmlToPng(ctx.page, html, sheetW, sheetH);
    writeFileSync(sheet, png);
    const problems = [...info.issues.filter((i) => i.severity === 'error'), ...ctx.page.errors];
    return { sheet, files, times, info: summarizeInfo(info), errors: ctx.page.errors, problems };
  } finally {
    await ctx.page.close();
    await ctx.server.close();
  }
}

function sceneAt(info, t) {
  // The deepest clip that is active at t and lasts > 0.3s
  const act = info.clips.filter((c) => t >= c.start && t < c.end && c.end - c.start > 0.3);
  if (!act.length) return '';
  act.sort((a, b) => (b.start - a.start) || (a.end - a.start) - (b.end - b.start));
  return act[0].selector || '';
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderHtmlToPng(page, html, w, h) {
  await page.setViewport(w, h);
  const { frameTree } = await page.s('Page.getFrameTree');
  await page.s('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  await page.evaluate(`Promise.all([...document.images].map(i => i.decode().catch(()=>{}))).then(() => document.fonts.ready).then(() => true)`);
  return page.capture('png');
}
