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
  const W = mw.width, H = mw.height, PX = mw.px;
  // Safe zone for vertical social video (app buttons and titles cover the edges), in px at 1080p
  const ZONES = { shorts: [220, 60, 380, 60], reels: [220, 60, 380, 60], tiktok: [220, 120, 380, 60] };
  const zname = (opt && opt.safeZone) || document.documentElement.getAttribute('data-safe-zone');
  let zone = null;
  if (zname && zname !== 'none' && zname !== 'off') { const z = ZONES[zname] || String(zname).split(/[\s,]+/).map(Number); if (z.length === 4 && z.every((v) => isFinite(v))) zone = { left: z[3] * PX, top: z[0] * PX, right: W - z[1] * PX, bottom: H - z[2] * PX, name: ZONES[zname] ? zname : 'custom' }; }
  const out = [];
  const ignored = (el) => !!el.closest('[data-check="ignore"],[aria-hidden="true"],[data-mw-internal]');
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
  const sel = (el) => mw.__selector(el);
  // Glyph boxes are taller than the visible letters; shrink them for clip/overlap tests.
  const tight = (r) => { const h = r.bottom - r.top; return { left: r.left, right: r.right, top: r.top + h * 0.2, bottom: r.bottom - h * 0.22, width: r.right - r.left, height: h * 0.58 }; };
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const inter = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  // 1. Short animations (entrances, exits, transitions) mean "moving". Camera moves and long
  //    looping/ambient animations do not: they would hide every problem.
  const animating = new Set();
  for (const a of document.getAnimations()) {
    try {
      if (a.__mwCamera) continue;
      const ct = a.effect.getComputedTiming();
      const lt = ct.localTime, d = ct.delay || 0, ad = ct.activeDuration;
      if (ct.progress != null && lt > d && lt < d + ad && isFinite(ad) && ad <= 2500) animating.add(a.effect.target);
    } catch (e) {}
  }
  const inAnim = (el) => { for (let c = el; c; c = c.parentElement) if (animating.has(c)) return true; return false; };
  const transitioning = [...animating].some((m) => m && m.parentElement && m.parentElement.hasAttribute('data-sequence'));
  // 2. Motion from any code (timeline, React, onFrame): compare with the previous sample.
  const prev = window.__mwPrevBoxes || new Map();
  const next = new Map();
  const snippet = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-mw-hidden]') || ignored(el)) continue;
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
    const box = { cx: bx, cy: by, k, w: (u.right - u.left) / k, h: (u.bottom - u.top) / k, op, cam };
    next.set(el, box);
    const p = prev.get(el);
    let speedMoving = false;
    if (p && dt > 0 && p.cam === box.cam) {
      const v = (Math.hypot(box.cx - p.cx, box.cy - p.cy) * box.k) / dt;
      const sz = Math.abs(box.w - p.w) / Math.max(1, p.w) / dt + Math.abs(box.h - p.h) / Math.max(1, p.h) / dt;
      const fo = Math.abs(box.op - p.op) / dt;
      speedMoving = v > 40 * PX || sz > 0.25 || fo > 0.4;
    }
    texts.push({ el, rs, u, op, moving: inAnim(el) || speedMoving, fading: !!(p && Math.abs(box.op - p.op) > 0.02) });
  }
  window.__mwPrevBoxes = next;
  // Is a camera world moving right now? Labels the camera passes over on its way to the next shot are not framing mistakes.
  const focus = (window.mw && mw.__cameraFocus) ? mw.__cameraFocus() : [];
  const prevCam = window.__mwPrevCam || new Map(), nextCam = new Map(), camMoving = new Set();
  for (const wEl of document.querySelectorAll('[data-mw-camera-world]')) {
    const r = wEl.getBoundingClientRect(), c = { x: r.left, y: r.top, s: r.width / (wEl.offsetWidth || r.width || 1) };
    nextCam.set(wEl, c);
    const p = prevCam.get(wEl);
    if (p && dt > 0 && (Math.hypot(c.x - p.x, c.y - p.y) / dt > 60 * PX || Math.abs(Math.log(c.s / p.s)) / dt > 0.03)) camMoving.add(wEl);
  }
  window.__mwPrevCam = nextCam;
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
    for (const q of t.rs.slice(0, 3)) {
      for (const fx of [0.15, 0.5, 0.85]) {
        const x = q.left + (q.right - q.left) * fx, y = (q.top + q.bottom) / 2;
        if (x < 0 || y < 0 || x > W || y > H) continue;
        n++;
        // Walk down the stack of things at that point until we reach the text.
        for (const c of document.elementsFromPoint(x, y)) {
          if (c === t.el || c.contains(t.el) || t.el.contains(c)) break;
          if (paintsSolid(c)) { hits++; by = by || c; break; }
        }
      }
    }
    return { n, hits, by };
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
    const cov = t.hidden ? { n: 0, hits: 0 } : coverOf(t);
    t.covered = cov.n > 0 && cov.hits === cov.n;
    if (t.moving || t.hidden || t.covered) continue;
    // Partly hidden behind a shape or box that is drawn on top of it
    if (cov.hits > 0 && cov.by && t.op >= 0.5 && !transitioning && !ignored(cov.by) && !cov.by.closest('[data-mw-internal]')) {
      out.push({ severity: 'warning', code: 'text-covered', selector: sel(el), text: snippet(el), message: 'Part of the text is hidden behind ' + sel(cov.by) + ', which is drawn on top of it.', minSpan: 0.3, fix: 'Move one of them, or put the text above it (z-index, or later in the HTML).' });
    }
    // Inside a camera world (or data-check="crop-ok"), being cut by the frame edge is framing, not a mistake.
    const cropOk = !!el.closest('[data-mw-camera-world],[data-check~="crop-ok"]');
    // 1. Text partly outside the frame (fully outside = not shown, which is fine)
    const outX = Math.max(0, -tu.left) + Math.max(0, tu.right - W);
    const outY = Math.max(0, -tu.top) + Math.max(0, tu.bottom - H);
    // In a camera world, text passing by the edge is fine, but a label that is mostly in view and cut is still worth a look.
    const visFrac = area(inter(tu, frame)) / Math.max(1, area(tu));
    const cropMeant = !!el.closest('[data-check~="crop-ok"]');
    const camWorld = el.closest('[data-mw-camera-world]');
    // (a label of another part of the drawing that sits half in frame is still reported: judges and viewers read a
    //  half-cut label as a mistake, whatever the shot is about)
    const overview = camWorld && focus.some((f) => f.world === camWorld && f.overview);
    if ((outX > 2 || outY > 2) && cropOk && !cropMeant && visFrac >= 0.5 && !(camWorld && camMoving.has(camWorld))) out.push({ severity: 'warning', code: 'text-offscreen', selector: sel(el), text: snippet(el), message: 'Text is cut by the frame edge while the camera is on it.', minSpan: 0.3, fix: 'Frame the shot so labels are fully in view or fully out (more padding, a slightly different center, or move the label); a neighbour half in frame reads as a mistake. If the crop is on purpose, add data-check="crop-ok" to that text or a parent.' });
    if ((outX > 2 || outY > 2) && !cropOk) out.push({ severity: 'error', code: 'text-offscreen', selector: sel(el), text: snippet(el), message: 'Text runs past the edge of the frame by ' + Math.round(Math.max(outX, outY)) + 'px.', fix: 'Reduce font-size, allow wrapping (max-width), or move it inside the frame.' });
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
          out.push({ severity: 'warning', code: 'text-overflows-box', selector: sel(el), text: snippet(el), message: 'Text spills outside its box ' + sel(anc) + '.', fix: 'Add padding/width to the box, shorten the text, or reduce font-size.' });
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
    if (visualFs < 18 * PX && lineH > 0 && !overview && !(camWorld && camMoving.has(camWorld))) out.push({ severity: 'warning', code: 'tiny-text', selector: sel(el), text: snippet(el), message: 'Text is ' + Math.round(visualFs) + 'px tall in a ' + W + 'x' + H + ' frame, which is hard to read in a video.', fix: 'Use at least ' + Math.round(24 * PX) + 'px (' + Math.round(28 * PX) + 'px+ for body text).' });
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
    if (sh.closest('defs,clipPath,mask,marker,pattern,symbol,[data-mw-sketch-guide],[data-mw-sketch-fill],.mw-sketch-mark,[data-mw-internal]') || ignored(sh)) continue;
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
    strokes.push({ sh, b, inv: ctm.inverse() });
  }
  // Is the stroke covered at this point by something opaque drawn above it (a panel, a filled shape)?
  // (hit testing skips pointer-events:none, so a stroke that is not found counts as visible)
  const opaqueEl = (e) => {
    const cs = getComputedStyle(e);
    let solid = false;
    if (e instanceof SVGElement) solid = !/^(svg|g|text|tspan|use|foreignObject)$/i.test(e.tagName) && cs.fill !== 'none' && !/rgba\([^)]*,\s*0(\.\d+)?\)/.test(cs.fill) && parseFloat(cs.fillOpacity) >= 0.9;
    else solid = /^(IMG|VIDEO|CANVAS)$/.test(e.tagName) || cs.backgroundImage !== 'none' || (!/rgba\([^)]*,\s*0(\.\d+)?\)|transparent/.test(cs.backgroundColor));
    if (!solid) return false;
    let op = 1;
    for (let a = e; a && a.nodeType === 1 && op >= 0.9; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
    return op >= 0.9;
  };
  const coveredAt = (x, y, sh) => {
    const stack = document.elementsFromPoint(x, y);
    const k = stack.indexOf(sh);
    if (k < 0) return false;
    for (let i = 0; i < k; i++) if (stack[i] !== document.documentElement && stack[i] !== document.body && !stack[i].contains(sh) && opaqueEl(stack[i])) return true;
    return false;
  };
  if (strokes.length) for (const t of texts) {
    if (t.moving || t.hidden || t.covered || t.op < 0.5) continue;
    const tu = tight(t.u);
    let hit = null;
    for (const st of strokes) {
      const b = st.b;
      if (b.right < tu.left || b.left > tu.right || b.bottom < tu.top || b.top > tu.bottom || st.sh.closest('svg') === t.el.closest('svg') && t.el.closest('text') && false) continue;
      // (rows about 4 px apart at 1080p, so a thin line between two rows is not missed)
      const ny = Math.min(8, Math.max(3, Math.ceil((tu.bottom - tu.top) / (4 * PX))));
      for (let iy = 0; iy < ny && !hit; iy++) for (let ix = 0; ix < 7 && !hit; ix++) {
        const x = tu.left + (tu.right - tu.left) * (ix + 0.5) / 7, y = tu.top + (tu.bottom - tu.top) * (iy + 0.5) / ny;
        const pt = new DOMPoint(x, y).matrixTransform(st.inv);
        try { if (st.sh.isPointInStroke(pt) && !coveredAt(x, y, st.sh)) hit = st.sh; } catch (e) {}
      }
      if (hit) break;
    }
    if (hit) out.push({ severity: 'warning', code: 'text-over-line', selector: sel(t.el), text: snippet(t.el), message: 'A line runs through this text: ' + sel(hit) + '.', minSpan: 0.3, fix: 'Move the label off the line (or the line around it), or give the label a paper-colored backing.' });
  }
  // 5a. During a scene change: text of the old scene and text of the new one on top of each other, both half visible
  //     (a crossfade of two headlines reads as a smudge; judges call it "ghosted text")
  if (transitioning) {
    const sceneOf = (e) => { for (let c = e; c && c.parentElement; c = c.parentElement) if (c.parentElement.hasAttribute('data-sequence')) return c; return null; };
    const vis = texts.filter((t) => !t.hidden && !t.covered && t.op >= 0.25 && sceneOf(t.el));
    const seen = new Set();
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j], sa = sceneOf(a.el), sb = sceneOf(b.el);
      if (sa === sb || seen.has(a.el) || seen.has(b.el)) continue;
      let ov = 0;
      for (const ra0 of a.rs) for (const rb0 of b.rs) ov += area(inter(tight(ra0), tight(rb0)));
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
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const splitParent = (e) => e.closest('[data-split]');
      if (splitParent(a.el) && splitParent(a.el) === splitParent(b.el)) continue;
      // letters or short pieces of one word (tight kinetic type) are not "overlapping text"
      if (a.el.parentElement === b.el.parentElement && (a.el.textContent.trim().length <= 2 || b.el.textContent.trim().length <= 2)) continue;
      let ov = 0;
      for (const ra0 of a.rs) for (const rb0 of b.rs) ov += area(inter(tight(ra0), tight(rb0)));
      const ar = (t) => t.rs.reduce((s, r) => s + r.width * r.height * 0.58, 0);
      if (ov > 0.12 * Math.min(ar(a), ar(b))) {
        out.push({ severity: 'warning', code: 'text-overlap', selector: sel(a.el), text: snippet(a.el), message: 'Text overlaps other text: ' + sel(b.el) + ' ("' + snippet(b.el) + '").', fix: 'Move one of them, or make sure they are not visible at the same time.' });
      }
    }
  }
  // 6. Broken images
  for (const img of document.images) {
    if (img.closest('[data-mw-hidden]') || ignored(img)) continue;
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
      if (k > 0 && st.slice(0, k).some((e) => !e.contains(t.el) && !e.closest('[data-mw-internal]'))) return true;
    }
    return false;
  };
  window.__mwTextBoxes = transitioning ? [] : live.filter((t) => !t.clipText && t.op >= 0.75 && !t.fading && inFrame(t) && !underSomething(t)).map((t) => {
    const cs = getComputedStyle(t.el);
    // A dark/light text-shadow or outline gives text its own backing; be lenient then.
    const backed = (cs.textShadow && cs.textShadow !== 'none') || parseFloat(cs.webkitTextStrokeWidth) > 0;
    return { sel: sel(t.el), text: snippet(t.el), rects: t.rs.map((r) => [r.left, r.top, r.width, r.height]), color: t.color, op: t.op, backed, large: t.fontPx >= 32 * PX || (t.bold && t.fontPx >= 24 * PX) };
  });
  // where each issue's element sits: its scene and when that scene starts (for scene-local times)
  for (const i of out) {
    try { const e = i.selector && document.querySelector(i.selector); const sc = e && (e.closest('.scene') || e.closest('[data-start],[data-duration]')); if (sc) { i.scene = sel(sc); i.sceneStart = mw.timing(sc).start; } } catch (er) {}
  }
  // the biggest readable text on screen (an "empty" frame with a heading on it is not empty)
  let maxFont = 0;
  for (const t of texts) { if (t.hidden || t.covered) continue; const k = t.el.offsetHeight ? t.el.getBoundingClientRect().height / t.el.offsetHeight : 1; maxFont = Math.max(maxFont, parseFloat(getComputedStyle(t.el).fontSize) * (isFinite(k) && k > 0 ? k : 1)); }
  return { issues: out, textCount: texts.length, maxFont: maxFont / PX, boxes: window.__mwTextBoxes.length, busy: animating.size > 0 || texts.some((t) => t.moving && !t.hidden) };
})`;

const PAGE_HIDE_TEXT = `(() => { let s = document.getElementById('__mw_hide'); if (!s) { s = document.createElement('style'); s.id='__mw_hide'; document.head.appendChild(s); }
  s.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke-color:transparent!important;caret-color:transparent!important;text-decoration-color:transparent!important} text,text *{fill:transparent!important;stroke:transparent!important} .mw-caret{visibility:hidden!important}';
  return true; })()`;
const PAGE_SHOW_TEXT = `(() => { const s = document.getElementById('__mw_hide'); if (s) s.remove(); return true; })()`;

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
  for (const b of window.__mwTextBoxes || []) {
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
    // Targets (WCAG): 4.5:1 for normal text, 3:1 for large text (>= 32px, or bold >= 24px at 1080p),
    // 1.6:1 when the text has its own shadow or outline. Error below 2/3 of the target.
    const need = b.backed ? 1.6 : b.large ? 3 : 4.5;
    const kind = b.backed ? 'text with a shadow/outline' : b.large ? 'large text' : 'normal text';
    const partly = typical >= need && typical < need * 1.5 && low < need * 0.66;
    if (typical < need || partly) {
      const val = partly ? low : typical;
      res.push({ severity: val < need * 0.66 ? 'error' : 'warning', code: 'low-contrast', selector: b.sel, text: b.text,
        message: (partly ? 'Parts of this text have low contrast (' + low.toFixed(1) + ':1 where the background is busiest, ' + typical.toFixed(1) + ':1 typical)' : 'Text contrast is ' + typical.toFixed(1) + ':1') + '. Target for ' + kind + ' is ' + need + ':1.',
        fix: partly ? 'Put a solid or semi-opaque backing behind the text, or add a text-shadow.' : 'Use a lighter/darker text color, add a backing, or a text-shadow.' });
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
    if (pace) await ctx.page.evaluate(`window.__mwGrid = async (src) => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = ${GW}; c.height = ${GH}; const g = c.getContext('2d'); g.drawImage(im, 0, 0, ${GW}, ${GH}); const d = g.getImageData(0, 0, ${GW}, ${GH}).data; const o = new Array(${GW * GH}); for (let i = 0, j = 0; i < d.length; i += 4, j++) o[j] = (54 * d[i] + 183 * d[i + 1] + 19 * d[i + 2]) >> 8; return o; }`);
    let lastGrid = null, lastGridT = -Infinity, busy = false;
    let motion = null;
    const openFrames = []; // the first half second: is anything on screen?
    const emptyGrid = []; // [t, almost nothing on screen] every half second
    const change = []; // [t, fraction of the picture that changed since the previous grid]
    for (const t of times) {
      await ctx.page.seek(t);
      const a = await ctx.page.evaluate(`(${PAGE_ANALYZE})(${prevT == null ? 0 : t - prevT}, ${JSON.stringify({ safeZone: opts.safeZone || null })})`);
      prevT = t;
      if (opts.at != null && Math.abs(t - +opts.at) > 0.5 / fps) continue; // warm-up samples only feed motion detection
      perSample.push({ t, issues: a.issues });
      busy = busy || !!a.busy; // an entrance, exit or moving text since the last grid
      if (pace && t - lastGridT >= 0.49) {
        const jpg = await ctx.page.capture('jpeg', 60);
        const g = await ctx.page.evaluate(`window.__mwGrid('data:image/jpeg;base64,${jpg.toString('base64')}')`);
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
    for (const e of ctx.page.errors) issues.push({ severity: 'error', code: e.code, message: e.message, time: null });
    const logs = groupLogs(await ctx.page.evaluate('window.mw && mw.__logs ? mw.__logs(0) : []'));
    if (change.length) issues.push(...stillStretches(change, info, from, to));
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

/** mw.log() lines: the same message at neighbouring times becomes one line with a time range and a count. */
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
    if (opts.times) times = String(opts.times).split(',').map(sec).filter((x) => isFinite(x));
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
