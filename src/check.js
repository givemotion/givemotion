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
const PAGE_ANALYZE = String.raw`(() => {
  const W = mw.width, H = mw.height, PX = mw.px;
  const out = [];
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
  // Elements that are mid-animation right now are skipped (they are moving into place).
  const moving = new Set();
  for (const a of document.getAnimations()) {
    try {
      const ct = a.effect.getComputedTiming();
      const lt = ct.localTime, d = ct.delay || 0, ad = ct.activeDuration;
      if (ct.progress != null && lt > d && lt < d + ad && isFinite(ad)) moving.add(a.effect.target);
    } catch (e) {}
  }
  const isMoving = (el) => { for (let c = el; c; c = c.parentElement) if (moving.has(c)) return true; return false; };
  // A scene transition (a direct child of a data-sequence animating) puts two scenes on screen at once.
  const transitioning = [...moving].some((m) => m && m.parentElement && m.parentElement.hasAttribute('data-sequence'));
  // Glyph boxes are taller than the visible letters; shrink them for overlap tests.
  const tight = (r) => ({ left: r.left, right: r.right, top: r.top + r.height * 0.2, bottom: r.bottom - r.height * 0.22, width: r.width, height: r.height * 0.58 });
  const snippet = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('[data-mw-hidden]')) continue;
    if (!isTextEl(el)) continue;
    const op = visible(el);
    if (!op) continue;
    const rs = textRects(el);
    if (!rs.length) continue;
    const u = union(rs);
    texts.push({ el, rs, u, op, moving: isMoving(el) });
  }
  const reportedBox = new Set(); // one report per container per frame
  for (const t of texts) {
    const { el, u } = t;
    const cs = getComputedStyle(el);
    if (t.moving) continue;
    // 1. Off-screen text
    const outX = Math.max(0, -u.left) + Math.max(0, u.right - W);
    const outY = Math.max(0, -u.top) + Math.max(0, u.bottom - H);
    if (outX > 2 || outY > 2) {
      const full = u.right < 0 || u.left > W || u.bottom < 0 || u.top > H;
      out.push({ severity: full ? 'warning' : 'error', code: 'text-offscreen', selector: sel(el), text: snippet(el), message: full ? 'Text is completely outside the frame.' : 'Text runs past the edge of the frame by ' + Math.round(Math.max(outX, outY)) + 'px.', fix: 'Reduce font-size, allow wrapping (max-width), or move it inside the frame.' });
    }
    // 2. Clipped by an ancestor with overflow hidden/clip
    let anc = el;
    while (anc && anc !== document.body) {
      const acs = getComputedStyle(anc);
      if (/(hidden|clip)/.test(acs.overflowX + acs.overflowY) && !anc.classList.contains('scene') && anc.getAttribute('data-sequence') == null) {
        const r = anc.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (u.left < r.left - 2 || u.right > r.right + 2 || u.top < r.top - 2 || u.bottom > r.bottom + 2)) {
          if (reportedBox.has(anc)) break;
          reportedBox.add(anc);
          out.push({ severity: 'error', code: 'text-clipped', selector: sel(el), text: snippet(el), message: 'Text is cut off by ' + (anc === el ? 'its own box' : sel(anc)) + ' (overflow: hidden).', fix: 'Make the text smaller, let it wrap, or make the container bigger.' });
          break;
        }
      }
      anc = anc.parentElement;
    }
    // 3. Spills out of its card (nearest ancestor with a visible background or border)
    anc = el.parentElement;
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
    // 4. Tiny text (visual size, after transforms)
    const fs = parseFloat(cs.fontSize);
    const lineH = t.rs.reduce((m, r) => Math.max(m, r.height), 0);
    const scaleY = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
    const visualFs = fs * (isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
    if (visualFs < 18 * PX && lineH > 0) out.push({ severity: 'warning', code: 'tiny-text', selector: sel(el), text: snippet(el), message: 'Text is ' + Math.round(visualFs) + 'px tall in a ' + W + 'x' + H + ' frame, which is hard to read in a video.', fix: 'Use at least ' + Math.round(24 * PX) + 'px (' + Math.round(28 * PX) + 'px+ for body text).' });
    t.fontPx = visualFs;
    t.bold = parseInt(cs.fontWeight, 10) >= 600;
    t.color = cs.color;
    t.clipText = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text' || /transparent|rgba\(\d+, \d+, \d+, 0\)/.test(cs.webkitTextFillColor || '');
  }
  // 5. Overlapping text
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.moving || b.moving || transitioning) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const splitParent = (e) => e.closest('[data-split]');
      if (splitParent(a.el) && splitParent(a.el) === splitParent(b.el)) continue;
      let inter = 0;
      for (const ra0 of a.rs) for (const rb0 of b.rs) {
        const ra = tight(ra0), rb = tight(rb0);
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 0 && h > 0) inter += w * h;
      }
      const area = (t) => t.rs.reduce((s, r) => s + r.width * r.height * 0.58, 0);
      if (inter > 0.12 * Math.min(area(a), area(b))) {
        out.push({ severity: 'warning', code: 'text-overlap', selector: sel(a.el), text: snippet(a.el), message: 'Text overlaps other text: ' + sel(b.el) + ' ("' + snippet(b.el) + '").', fix: 'Move one of them, or make sure they are not visible at the same time.' });
      }
    }
  }
  // 6. Broken images
  for (const img of document.images) {
    if (img.closest('[data-mw-hidden]')) continue;
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) out.push({ severity: 'error', code: 'image-broken', selector: sel(img), message: 'Image did not load: ' + img.getAttribute('src'), fix: 'Check the file path (relative to the HTML file).' });
  }
  // Text boxes for the contrast pass
  // Text that is mostly transparent is usually fading in or out; don't judge its contrast.
  window.__mwTextBoxes = transitioning ? [] : texts.filter((t) => !t.clipText && !t.moving && t.op >= 0.75).map((t) => {
    const cs = getComputedStyle(t.el);
    // A dark/light text-shadow or outline gives text its own backing; be lenient then.
    const backed = (cs.textShadow && cs.textShadow !== 'none') || parseFloat(cs.webkitTextStrokeWidth) > 0;
    return { sel: sel(t.el), text: snippet(t.el), rects: t.rs.map((r) => [r.left, r.top, r.width, r.height]), color: t.color, op: t.op, backed, large: t.fontPx >= 32 * PX || (t.bold && t.fontPx >= 24 * PX) };
  });
  return { issues: out, textCount: texts.length, boxes: window.__mwTextBoxes.length };
})()`;

const PAGE_HIDE_TEXT = `(() => { let s = document.getElementById('__mw_hide'); if (!s) { s = document.createElement('style'); s.id='__mw_hide'; document.head.appendChild(s); }
  s.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke-color:transparent!important;caret-color:transparent!important;text-decoration-color:transparent!important} .mw-caret{visibility:hidden!important}';
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
    // One forward pass over the video (works for stateful pages too). Every sample is analysed;
    // elements that are mid-animation at that moment are skipped by the page-side analyser.
    const step = Math.max(1 / fps, Math.min(0.1, info.duration / 300));
    const planned = new Set();
    for (let t = 0; t <= lastT + 1e-9; t += step) planned.add(Math.round(t * fps) / fps);
    for (const k of keyTimes(info, 24)) planned.add(k);
    const times = [...planned].sort((a, b) => a - b);
    const contrastEvery = Math.max(info.duration / (opts.contrastSamples || 10), 0.4);
    let lastContrast = -Infinity;
    for (const t of times) {
      await ctx.page.seek(t);
      const a = await ctx.page.evaluate(PAGE_ANALYZE);
      push(a.issues, t);
      if (a.boxes && t - lastContrast >= contrastEvery) {
        lastContrast = t;
        await ctx.page.evaluate(PAGE_HIDE_TEXT);
        const png = await ctx.page.capture('png');
        await ctx.page.evaluate(PAGE_SHOW_TEXT);
        const c = await ctx.page.evaluate(contrastScript('data:image/png;base64,' + png.toString('base64'), opts.scale || 1));
        push(c, t);
      }
    }
    for (const e of ctx.page.errors) issues.push({ severity: 'error', code: e.code, message: e.message, time: null });
    const merged = mergeIssues(issues);
    const errors = merged.filter((i) => i.severity === 'error').length;
    const warnings = merged.filter((i) => i.severity === 'warning').length;
    return { ok: errors === 0, errors, warnings, issues: merged, info: summarizeInfo(info) };
  } finally {
    await ctx.page.close();
    await ctx.server.close();
  }
}

function pickSpread(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

/** Same issue at many times → one entry with a time range (the worst message is kept). */
function mergeIssues(list) {
  const rank = { error: 0, warning: 1, info: 2 };
  const map = new Map();
  for (const i of list) {
    const k = [i.code, i.selector || i.message].join('|');
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...i, times: i.time != null ? [i.time] : [] }); continue; }
    if (i.time != null) cur.times.push(i.time);
    if (rank[i.severity] < rank[cur.severity]) { cur.severity = i.severity; cur.message = i.message; }
  }
  const out = [...map.values()].map((i) => {
    const ts = i.times.sort((a, b) => a - b);
    const r = { ...i };
    delete r.times;
    if (ts.length) { r.time = ts[0]; if (ts.length > 1) r.until = ts[ts.length - 1]; }
    return r;
  });
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.time ?? -1) - (b.time ?? -1));
}

function summarizeInfo(info) {
  return { width: info.width, height: info.height, fps: info.fps, duration: info.duration, frames: info.frames, clips: info.clips.length, media: info.media.length };
}

export function formatReport(rep, { file } = {}) {
  const lines = [];
  const i = rep.info;
  lines.push(`${file ? basename(file) + ': ' : ''}${i.width}x${i.height} ${i.fps}fps ${i.duration.toFixed(2)}s, ${i.clips} timed elements`);
  if (!rep.issues.length) { lines.push('✓ No problems found.'); return lines.join('\n'); }
  for (const x of rep.issues) {
    const when = x.time == null ? '' : x.until != null ? ` at ${x.time.toFixed(2)}–${x.until.toFixed(2)}s` : ` at ${x.time.toFixed(2)}s`;
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
    if (opts.times) times = String(opts.times).split(',').map((s) => parseFloat(s)).filter((x) => isFinite(x));
    else if (opts.every) { times = []; for (let t = 0; t <= lastT + 1e-9; t += parseFloat(opts.every)) times.push(t); }
    else times = keyTimes(info, opts.max || 12);
    times = times.map((t) => Math.round(Math.min(lastT, Math.max(0, t)) * fps) / fps);
    const dir = resolve(opts.output || join(dirname(ctx.file), 'snapshots'));
    mkdirSync(dir, { recursive: true });
    const files = [];
    const thumbs = [];
    for (const t of times) {
      await ctx.page.seek(t);
      const png = await ctx.page.capture('png');
      const f = join(dir, `t${t.toFixed(2).replace('.', '_')}s.png`);
      if (!opts.sheetOnly) { writeFileSync(f, png); files.push(f); }
      const thumb = opts.transparent ? png : await ctx.page.capture('jpeg', 88);
      thumbs.push({ t, data: thumb.toString('base64'), mime: opts.transparent ? 'png' : 'jpeg', frame: Math.round(t * fps), scene: sceneAt(info, t) });
    }
    const sheet = join(dir, 'sheet.png');
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
      figure{margin:0} img{display:block;width:${cellW}px;height:${cellH}px;outline:1px solid #333;background:repeating-conic-gradient(#3a3a3a 0% 25%,#2a2a2a 0% 50%) 50%/24px 24px}
      figcaption{height:34px;display:flex;align-items:center;gap:8px;color:#eee} b{color:#fff} span{color:#999}
    </style></head><body><header>${escapeHtml(basename(ctx.file))} · ${info.width}x${info.height} · ${info.fps}fps · ${info.duration.toFixed(2)}s</header><div class="g">${thumbs.map((x) => `<figure><img src="data:image/${x.mime};base64,${x.data}"><figcaption><b>${x.t.toFixed(2)}s</b><span>frame ${x.frame}${x.scene ? ' · ' + escapeHtml(x.scene) : ''}</span></figcaption></figure>`).join('')}</div></body></html>`;
    const png = await renderHtmlToPng(ctx.page, html, sheetW, sheetH);
    writeFileSync(sheet, png);
    return { sheet, files, times, info: summarizeInfo(info), errors: ctx.page.errors };
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

async function renderHtmlToPng(page, html, w, h) {
  await page.setViewport(w, h);
  const { frameTree } = await page.s('Page.getFrameTree');
  await page.s('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  await page.evaluate(`Promise.all([...document.images].map(i => i.decode().catch(()=>{}))).then(() => document.fonts.ready).then(() => true)`);
  return page.capture('png');
}
