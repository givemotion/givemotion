// `motionwright analyze <video>`: turn any video (a reference, or our own render) into a report an agent can read.
// Cuts and shot lengths, transitions, camera moves, pacing, palette, music sync and contact sheets.
// Everything is computed from small decoded frames, so the same video always gives the same report.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { ffmpegPath, ffprobePath } from './ffmpeg.js';

const GW = 96, GH = 54; // analysis grid (16:9); other aspect ratios keep 96 on the long side

/** ffprobe: duration, fps, size, audio. */
export function probeVideo(file) {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`ffprobe could not read ${file}${r.stderr ? ': ' + r.stderr.trim().split('\n').pop() : ''}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`${basename(file)} has no video stream.`);
  const rate = (s) => { const [a, b] = String(s || '0/1').split('/').map(Number); return b ? a / b : a; };
  const fps = rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30;
  let width = v.width, height = v.height;
  const rot = Math.abs(parseInt((v.tags && v.tags.rotate) || (v.side_data_list || []).find((d) => d.rotation != null)?.rotation || 0, 10));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  return { duration: parseFloat(j.format.duration) || parseFloat(v.duration) || 0, fps: Math.round(fps * 1000) / 1000, width, height, hasAudio: j.streams.some((s) => s.codec_type === 'audio'), codec: v.codec_name };
}

function gridSize(w, h) {
  if (w >= h) return [GW, Math.max(8, Math.round((GW * h) / w / 2) * 2)];
  return [Math.max(8, Math.round((GW * w) / h / 2) * 2), GW];
}

/** Decode every frame (at most `maxFps`) as a tiny RGB picture. Calls onFrame(index, rgb). */
function decodeSmall(file, { w, h, fps }, onFrame) {
  return new Promise((res, rej) => {
    const args = ['-v', 'error', '-i', file, '-an', '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'];
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = w * h * 3;
    let buf = Buffer.alloc(0), n = 0, err = '';
    p.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= size) { onFrame(n++, new Uint8Array(buf.subarray(0, size))); buf = buf.subarray(size); }
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => rej(new Error(`ffmpeg not available: ${e.message}`)));
    p.on('exit', (code) => (code === 0 ? res(n) : rej(new Error(`ffmpeg could not decode ${basename(file)}: ${err.trim().split('\n').slice(-2).join(' ')}`))));
  });
}

/** Grab chosen frames (by time) as JPEGs in one decoding pass. */
export function grabFrames(file, times, { fps, width = 480 } = {}) {
  const nums = [...new Set(times.map((t) => Math.max(0, Math.round(t * fps))))].sort((a, b) => a - b);
  if (!nums.length) return Promise.resolve(new Map());
  const expr = nums.map((n) => `eq(n\\,${n})`).join('+');
  const run = (sync) => new Promise((res, rej) => {
    const args = ['-v', 'error', '-i', file, '-an', '-vf', `select='${expr}',scale=${width}:-2:flags=lanczos`, ...sync, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-'];
    const p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res(Buffer.concat(chunks)) : rej(new Error(err.trim().split('\n').pop()))));
  });
  return run(['-fps_mode', 'passthrough']).catch(() => run(['-vsync', '0'])).then((all) => {
    // split the MJPEG stream at each JPEG start marker
    const jpgs = [];
    let start = -1;
    for (let i = 0; i < all.length - 1; i++) {
      if (all[i] === 0xff && all[i + 1] === 0xd8 && (i === 0 || (all[i - 2] === 0xff && all[i - 1] === 0xd9))) { if (start >= 0) jpgs.push(all.subarray(start, i)); start = i; }
    }
    if (start >= 0) jpgs.push(all.subarray(start));
    const out = new Map();
    // frames past the end of the video come back missing: give them the last frame
    nums.forEach((n, i) => out.set(n, jpgs[Math.min(i, jpgs.length - 1)]));
    return out;
  });
}

// ---------------------------------------------------------------------------
// Picture measures
// ---------------------------------------------------------------------------
const lumaOf = (rgb) => { const n = rgb.length / 3, o = new Uint8Array(n); for (let i = 0, j = 0; j < n; i += 3, j++) o[j] = (54 * rgb[i] + 183 * rgb[i + 1] + 19 * rgb[i + 2]) >> 8; return o; };
/** Best global move from frame a to frame b (camera estimate): shift in grid px and zoom around the center. */
function globalMotion(a, b, w, h) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, mx = Math.round(w * 0.12), my = Math.round(h * 0.12);
  const cost = (dx, dy, z) => {
    let s = 0, n = 0;
    for (let y = my; y < h - my; y += 1) {
      for (let x = mx; x < w - mx; x += 1) {
        // where this pixel of b was in a
        const ax = Math.round(cx + (x - cx) / z - dx), ay = Math.round(cy + (y - cy) / z - dy);
        if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
        s += Math.abs(b[y * w + x] - a[ay * w + ax]); n++;
      }
    }
    return n ? s / n : 255;
  };
  const still = cost(0, 0, 1);
  let best = { dx: 0, dy: 0, z: 1, c: still };
  const R = 8;
  for (const z of [0.94, 0.97, 1, 1.03, 1.06]) {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const c = cost(dx, dy, z);
      if (c < best.c - 1e-9) best = { dx, dy, z, c };
    }
  }
  // sub-pixel: fit a parabola through the costs next to the best shift
  const sub = (c0, cm, cp) => { const d = cm - 2 * c0 + cp; return d > 1e-9 ? Math.max(-0.5, Math.min(0.5, (cm - cp) / (2 * d))) : 0; };
  const fx = sub(best.c, cost(best.dx - 1, best.dy, best.z), cost(best.dx + 1, best.dy, best.z));
  const fy = sub(best.c, cost(best.dx, best.dy - 1, best.z), cost(best.dx, best.dy + 1, best.z));
  return { ...best, dx: best.dx + fx, dy: best.dy + fy, still };
}

// OKLab, for palette clustering
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
function toLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** k-means in OKLab with a fixed start (deterministic). pixels: [[r,g,b,weight]] */
function palette(pixels, k = 8) {
  if (!pixels.length) return [];
  const pts = pixels.map(([r, g, b, wt]) => ({ lab: toLab(r, g, b), rgb: [r, g, b], w: wt ?? 1 }));
  // start: farthest-point picks from the most common color
  const cents = [pts[0].lab];
  const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const minD = pts.map((p) => dist(p.lab, cents[0]));
  while (cents.length < k) {
    let bi = -1, bd = 0;
    for (let i = 0; i < pts.length; i++) { const d = minD[i] * Math.sqrt(pts[i].w); if (d > bd) { bd = d; bi = i; } }
    if (bi < 0 || bd < 1e-4) break;
    cents.push(pts[bi].lab);
    for (let i = 0; i < pts.length; i++) minD[i] = Math.min(minD[i], dist(pts[i].lab, pts[bi].lab));
  }
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < pts.length; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < cents.length; j++) { const d = dist(pts[i].lab, cents[j]); if (d < bd) { bd = d; bj = j; } } assign[i] = bj; }
    const acc = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p.lab[0] * p.w; a[1] += p.lab[1] * p.w; a[2] += p.lab[2] * p.w; a[3] += p.w; });
    acc.forEach((a, j) => { if (a[3] > 0) cents[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const groups = cents.map(() => ({ w: 0, r: 0, g: 0, b: 0, chroma: 0 }));
  const total = pts.reduce((s, p) => s + p.w, 0);
  pts.forEach((p, i) => { const g = groups[assign[i]]; g.w += p.w; g.r += p.rgb[0] * p.w; g.g += p.rgb[1] * p.w; g.b += p.rgb[2] * p.w; });
  return groups.map((g, j) => ({ hex: hex(g.r / g.w, g.g / g.w, g.b / g.w), share: g.w / total, L: cents[j][0], chroma: Math.hypot(cents[j][1], cents[j][2]) }))
    .filter((g) => g.share > 0.004).sort((a, b) => b.share - a.share)
    .map((g) => ({ hex: g.hex, share: Math.round(g.share * 1000) / 1000, light: Math.round(g.L * 100) / 100, chroma: Math.round(g.chroma * 1000) / 1000 }));
}
/** Pixels of a frame, quantized to 5 bits per channel and counted (fewer points for k-means). */
function addPixels(map, rgb, step = 1) {
  for (let i = 0; i < rgb.length; i += 3 * step) {
    const key = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
    const e = map.get(key);
    if (e) { e[0] += rgb[i]; e[1] += rgb[i + 1]; e[2] += rgb[i + 2]; e[3]++; } else map.set(key, [rgb[i], rgb[i + 1], rgb[i + 2], 1]);
  }
}
const pixelsOf = (map) => [...map.values()].map(([r, g, b, n]) => [r / n, g / n, b / n, n]).sort((a, b) => b[3] - a[3]).slice(0, 3000).map(([r, g, b, n]) => [Math.round(r), Math.round(g), Math.round(b), n]);

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

/**
 * Analyze a video file. opts: { output (folder), sheets (default true), every (sheet spacing, s), audio (default true), chrome }
 * Returns the report object (also written to report.json / report.md in the output folder).
 */
export async function analyzeVideo(input, opts = {}) {
  const file = resolve(input);
  if (!existsSync(file)) throw new Error(`Video not found: ${file}`);
  const t0 = Date.now();
  const meta = probeVideo(file);
  const [w, h] = gridSize(meta.width, meta.height);
  const fps = Math.min(meta.fps || 30, meta.duration > 300 ? 15 : 30);
  const lum = [], rgbs = [], rgbsAll = [];
  const pal = new Map(), border = new Map();
  const sampleEvery = Math.max(1, Math.round(fps / 2));
  await decodeSmall(file, { w, h, fps }, (i, rgb) => {
    lum.push(lumaOf(rgb));
    rgbsAll.push(rgb);
    if (i % sampleEvery === 0) {
      rgbs[i] = rgb;
      addPixels(pal, rgb);
      // the border of the picture says what the background is
      const edge = [];
      for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) edge.push(rgb[(y * w + x) * 3], rgb[(y * w + x) * 3 + 1], rgb[(y * w + x) * 3 + 2]);
      for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) edge.push(rgb[(y * w + x) * 3], rgb[(y * w + x) * 3 + 1], rgb[(y * w + x) * 3 + 2]);
      addPixels(border, Uint8Array.from(edge));
    }
  });
  const n = lum.length;
  if (n < 2) throw new Error(`${basename(file)} has fewer than 2 frames.`);
  const duration = n / fps;

  // 1. How different two frames are: the share of pixels whose color changed visibly
  const all = rgbsAll;
  // Detail (text, shapes, edges) of each frame: on a shared background a scene change only touches the detail.
  const detail = lum.map((L) => {
    const m = new Uint8Array(L.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const q = y * w + x;
      if (Math.abs(L[q + 1] - L[q - 1]) + Math.abs(L[q + w] - L[q - w]) > 36) { m[q] = 1; m[q - 1] = 1; m[q + 1] = 1; m[q - w] = 1; m[q + w] = 1; }
    }
    return m;
  });
  const minDetail = w * h * 0.015;
  /** 0..1: how much of the picture is new (the whole frame, or the detail when the background stays). */
  const dist = (i, j) => {
    const a = all[i], b = all[j], da = detail[i], db = detail[j];
    let c = 0, fc = 0, fn = 0;
    for (let k = 0, q = 0; k < a.length; k += 3, q++) {
      const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2]));
      // a big color change anywhere counts; a small one only on detail (soft backgrounds drift all the time)
      if (d > 40) c++;
      if (da[q] || db[q]) { fn++; if (d > 14) fc++; }
    }
    const full = c / (a.length / 3);
    return fn >= minDetail ? Math.max(full, 0.85 * (fc / fn)) : full;
  };
  const pd = new Float32Array(n); // frame to frame
  for (let i = 1; i < n; i++) pd[i] = dist(i - 1, i);
  // 2. Scene changes. Novelty: the picture just before and just after a moment differ much more than the
  //    picture changes within each side. Things that move all the time (a ticker, particles) or elements
  //    that enter one by one give low novelty; a cut or a transition gives a peak. Two scales catch
  //    quick changes and slow ones (a dip, a long dissolve).
  /** Share of the earlier frame's detail that is still there later (an entrance keeps the old content, a scene change does not). */
  const persist = (i, j) => {
    const a = all[i], b = all[j], da = detail[i];
    let n0 = 0, same = 0;
    for (let k = 0, q = 0; k < a.length; k += 3, q++) {
      if (!da[q]) continue;
      n0++;
      if (Math.abs(a[k] - b[k]) <= 20 && Math.abs(a[k + 1] - b[k + 1]) <= 20 && Math.abs(a[k + 2] - b[k + 2]) <= 20) same++;
    }
    return n0 >= minDetail ? same / n0 : null;
  };
  const cutAt = (S, E) => {
    // one frame carries the change: before it the picture is still S, after it already E
    let best = -1, bv = 0;
    for (let f = S + 1; f <= E; f++) if (pd[f] > bv) { bv = pd[f]; best = f; }
    if (best < 0 || bv < 0.25) return -1;
    return dist(S, best - 1) < 0.15 && dist(best, E) < 0.15 ? best : -1;
  };
  const cands = [];
  for (const sec of [0.1, 0.2, 0.45]) {
    const m = Math.max(2, Math.round(fps * sec));
    const nov = new Float32Array(n);
    for (let f = m; f + m < n; f++) {
      const before = f - 2 * m >= 0 ? dist(f - 2 * m, f - m) : 0, after = f + 2 * m < n ? dist(f + m, f + 2 * m) : 0;
      nov[f] = dist(f - m, f + m) - (before + after) / 2 - 0.25 * Math.abs(before - after);
    }
    for (let f = m; f + m < n; f++) {
      if (nov[f] < 0.3) continue;
      let peak = true;
      for (let r = Math.max(0, f - m); r <= Math.min(n - 1, f + m); r++) if (nov[r] > nov[f] || (nov[r] === nov[f] && r < f)) peak = false;
      if (peak) cands.push({ f, m, v: nov[f] });
    }
  }
  // the strongest candidate wins where two scales found the same change
  cands.sort((a, b) => b.v - a.v);
  const transitionsRaw = [];
  const taken = [];
  for (const c of cands) {
    if (taken.some(([a, b]) => (c.f >= a - 2 && c.f <= b + 2) || ((a + b) / 2 >= c.f - c.m && (a + b) / 2 <= c.f + c.m))) continue;
    let S = c.f - c.m, E = c.f + c.m;
    const S0 = S, E0 = E;
    // tighten to where the change starts and ends
    while (S + 1 < E && dist(S + 1, S0) < 0.08) S++;
    while (E - 1 > S && dist(E - 1, E0) < 0.08) E--;
    taken.push([S0, E0]);
    const p = persist(S, E);
    const full = (() => { const a = all[S], b = all[E]; let k2 = 0; for (let k = 0; k < a.length; k += 3) if (Math.abs(a[k] - b[k]) > 14 || Math.abs(a[k + 1] - b[k + 1]) > 14 || Math.abs(a[k + 2] - b[k + 2]) > 14) k2++; return k2 / (a.length / 3); })();
    if ((p == null || p > 0.45) && full < 0.35) continue; // something entered, or a flash: the old picture is still there
    const gm = globalMotion(lum[S], lum[E], w, h);
    if (gm.still > 3 && gm.c < gm.still * 0.45) continue; // the camera moved; the picture is the same
    const cf = cutAt(S, E);
    if (cf >= 0) transitionsRaw.push({ type: 'cut', S: cf - 1, E: cf, frame: cf });
    else transitionsRaw.push({ type: null, S, E });
  }
  const isCut = new Set(transitionsRaw.filter((t) => t.type === 'cut').map((t) => t.frame));

  // 3. Classify each gradual change by how the new picture arrives
  const classify = (S, E) => {
    const a = lum[S], b = lum[E];
    const reg = { left: [], right: [], top: [], bottom: [], center: [], ring: [] };
    let dipLuma = Infinity, blendErr = 0, blendBase = 0;
    const meanL = (f) => { let s = 0; for (const v of f) s += v; return s / f.length; };
    const la = meanL(a), lb = meanL(b);
    const moves = [];
    const stride = Math.max(1, Math.round((E - S) / 4));
    const zooms = [];
    for (let f = S + stride; f <= E; f += stride) zooms.push(globalMotion(lum[f - stride], lum[f], w, h));
    for (let f = S + 1; f <= E; f++) moves.push(globalMotion(lum[f - 1], lum[f], w, h));
    for (let f = S + 1; f < E; f++) {
      const c = lum[f];
      dipLuma = Math.min(dipLuma, meanL(c));
      const cnt = { left: [0, 0], right: [0, 0], top: [0, 0], bottom: [0, 0], center: [0, 0], ring: [0, 0] };
      // best blend factor for a crossfade, and how far the frame is from that blend
      let num = 0, den = 0;
      for (let q = 0; q < c.length; q++) { const d = b[q] - a[q]; num += (c[q] - a[q]) * d; den += d * d; }
      const al = den ? Math.max(0, Math.min(1, num / den)) : 0;
      for (let q = 0; q < c.length; q++) {
        const d = Math.abs(a[q] - b[q]);
        if (d <= 12) continue;
        blendErr += Math.abs(c[q] - (a[q] + al * (b[q] - a[q]))); blendBase += d;
        const done = Math.abs(c[q] - b[q]) < Math.abs(c[q] - a[q]) ? 1 : 0;
        const x = q % w, y = (q / w) | 0;
        const put = (r) => { cnt[r][0] += done; cnt[r][1]++; };
        put(x < w / 3 ? 'left' : x >= (2 * w) / 3 ? 'right' : 'center');
        put(y < h / 3 ? 'top' : y >= (2 * h) / 3 ? 'bottom' : 'center');
        if (Math.abs(x - w / 2) > w * 0.35 || Math.abs(y - h / 2) > h * 0.35) put('ring');
      }
      for (const r of Object.keys(reg)) reg[r].push(cnt[r][1] ? cnt[r][0] / cnt[r][1] : null);
    }
    const half = (arr) => { const q = arr.findIndex((v) => v != null && v >= 0.5); return q < 0 ? arr.length : q; };
    const tl = half(reg.left), tr = half(reg.right), tt = half(reg.top), tb = half(reg.bottom), tc = half(reg.center), tg = half(reg.ring);
    const L = Math.max(1, E - S - 1), spread = Math.max(1, 0.25 * L);
    const blend = blendBase ? blendErr / blendBase : 1;
    const good = moves.filter((m) => m.c < m.still * 0.8);
    const shift = good.reduce((s, m) => [s[0] + m.dx, s[1] + m.dy], [0, 0]);
    const zoomed = zooms.filter((m) => m.c < m.still * 0.9).reduce((z, m) => z * m.z, 1);
    // a push moves the old picture; a wipe leaves the part not yet covered exactly where it was
    const M = lum[Math.round((S + E) / 2)];
    let le = 0, ln = 0;
    for (let q = 0; q < M.length; q++) if (Math.abs(M[q] - b[q]) > 12 && Math.abs(a[q] - b[q]) > 12) { le += Math.abs(M[q] - a[q]); ln++; }
    const stays = ln > M.length * 0.05 && le / ln < 6;
    const moved = !stays && (Math.abs(shift[0]) > w * 0.2 || Math.abs(shift[1]) > h * 0.2);
    if (dipLuma < Math.min(la, lb) * 0.5 && dipLuma < 40) return 'dip';
    if (zoomed > 1.12 || zoomed < 0.89) return zoomed > 1 ? 'zoom-in' : 'zoom-out';
    if (moved) { const hz = Math.abs(shift[0]) / w >= Math.abs(shift[1]) / h; return 'push-' + (hz ? (shift[0] < 0 ? 'left' : 'right') : (shift[1] < 0 ? 'up' : 'down')); }
    if (Math.abs(tl - tr) > spread || Math.abs(tt - tb) > spread) {
      const horiz = Math.abs(tl - tr) >= Math.abs(tt - tb);
      return 'wipe-' + (horiz ? (tl < tr ? 'right' : 'left') : (tt < tb ? 'down' : 'up'));
    }
    if (Math.abs(tc - tg) > spread) return tc < tg ? 'iris' : 'iris-in';
    if (blend < 0.35) return 'fade';
    return 'other';
  };
  const transitions = transitionsRaw.map((t) => t.type === 'cut'
    ? { type: 'cut', start: r3(t.frame / fps), end: r3(t.frame / fps), at: r3(t.frame / fps) }
    : { type: classify(t.S, t.E), start: r3((t.S + 1) / fps), end: r3(t.E / fps), at: r3((t.S + 1 + t.E) / 2 / fps) }).sort((a, b) => a.start - b.start);

  // 5. Shots between transitions
  const shots = [];
  let s0 = 0;
  for (const tr of transitions) {
    if (tr.at - s0 >= 0.2) shots.push({ start: r3(s0), end: r3(tr.at), into: tr.type });
    s0 = tr.at;
  }
  shots.push({ start: r3(s0), end: r3(duration), into: null });
  for (const s of shots) s.length = r3(s.end - s.start);

  // 6. Camera per shot: global motion every half second
  const step = Math.max(1, Math.round(fps / 2));
  const cstep = Math.max(1, Math.round(fps / 4));
  for (const s of shots) {
    const fa = Math.round(s.start * fps), fb = Math.min(n - 1, Math.round(s.end * fps) - 1);
    let dx = 0, dy = 0, z = 1, flips = 0, last = null, samples = 0, movedSamples = 0;
    for (let f = fa + cstep; f <= fb; f += cstep) {
      const m = globalMotion(lum[f - cstep], lum[f], w, h);
      samples++;
      if (m.still < 2 || m.c > m.still * 0.85) continue; // nothing moved, or not a whole-picture move
      movedSamples++;
      dx += m.dx; dy += m.dy; z *= m.z;
      const dir = Math.sign(m.dx) + 3 * Math.sign(m.dy);
      if (last != null && dir !== 0 && last !== 0 && dir === -last) flips++;
      if (dir !== 0) last = dir;
    }
    const px = meta.width / w;
    s.camera = { move: [Math.round(dx * px), Math.round(dy * px)], zoom: r3(z), moving: samples ? r2(movedSamples / samples) : 0 };
    s.camera.label = flips >= 3 && flips >= movedSamples * 0.3 ? 'shake / handheld' : z > 1.04 ? `push in ${z.toFixed(2)}x` : z < 0.96 ? `pull out ${(1 / z).toFixed(2)}x` : Math.hypot(dx, dy) * px > meta.width * 0.06 ? `move-${panDir(dx, dy)} ${Math.round(Math.hypot(dx, dy) * px)}px` : 'still';
    // how busy the shot is, and its own colors
    let ch = 0, cn = 0;
    for (let f = fa + 1; f <= fb; f++) { ch += pd[f]; cn++; }
    s.activity = cn ? r3(ch / cn) : 0;
    const sp = new Map();
    for (let f = fa; f <= fb; f++) if (rgbs[f]) addPixels(sp, rgbs[f], 2);
    s.colors = palette(pixelsOf(sp), 5).slice(0, 3).map((c) => c.hex);
    const mid = rgbs[Math.round((fa + fb) / 2 / sampleEvery) * sampleEvery] || rgbs[fa - (fa % sampleEvery)];
    if (mid) { const L = lumaOf(mid); let m = 0; for (const v of L) m += v; s.brightness = Math.round(m / L.length); }
  }

  // 7. Pacing: how much of the picture changes, per half second (same scale as `check`)
  const pace = [];
  for (let f = step; f < n; f += step) {
    let changed = dist(f - step, f);
    for (let k = f - step + 1; k <= f; k++) if (isCut.has(k)) changed = Math.max(changed, 0.5);
    pace.push(r3(changed));
  }
  const still = [];
  for (let i = 0; i < pace.length; i++) {
    if (pace[i] >= 0.05) continue;
    let j = i; while (j + 1 < pace.length && pace[j + 1] < 0.05) j++;
    if ((j - i + 1) * 0.5 >= 2.5) still.push([r2(i * 0.5), r2((j + 1) * 0.5 + 0.5)]);
    i = j;
  }

  // 8. Colors of the whole video, and what the background is
  const colors = palette(pixelsOf(pal), 8);
  const bgc = palette(pixelsOf(border), 3)[0] || colors[0];
  const accents = colors.filter((c) => c.chroma > 0.08 && c.share >= 0.005).slice(0, 4);
  let lumSum = 0; for (const L of lum) for (let i = 0; i < L.length; i += 7) lumSum += L[i];
  const meanLuma = lumSum / (n * Math.ceil(lum[0].length / 7));

  // 9. Where the detail sits on screen (edges in a 3x3 grid), averaged over shot middles
  const layout = new Array(9).fill(0);
  for (const s of shots) {
    const f = Math.min(n - 1, Math.round(((s.start + s.end) / 2) * fps)), L = lum[f];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const g = Math.abs(L[y * w + x + 1] - L[y * w + x - 1]) + Math.abs(L[(y + 1) * w + x] - L[(y - 1) * w + x]);
      if (g > 40) layout[Math.min(2, ((3 * y) / h) | 0) * 3 + Math.min(2, ((3 * x) / w) | 0)]++;
    }
  }
  const lt = layout.reduce((a, b) => a + b, 0) || 1;
  const layoutShare = layout.map((v) => r2(v / lt));

  // 10. Music: cuts on the beat
  let music = null;
  if (meta.hasAudio && opts.audio !== false) {
    try {
      const { analyzeAudio } = await import('./audio-cli.js');
      const a = await analyzeAudio(file, { fps: 30, chrome: opts.chrome });
      if (!a.error && a.beats && a.beats.length > 4) {
        const tol = Math.max(0.07, 1.5 / fps);
        const changes = transitions.map((t) => t.at);
        const on = changes.filter((t) => a.beats.some((b) => Math.abs(b - t) <= tol)).length;
        const onBar = changes.filter((t) => (a.downbeats || []).some((b) => Math.abs(b - t) <= tol)).length;
        music = { bpm: a.bpm, beatSeconds: a.beatSeconds, cutsOnBeat: on, cutsOnBar: onBar, cuts: changes.length, shotBeats: a.beatSeconds ? r2(median(shots.map((s) => s.length)) / a.beatSeconds) : null };
      } else music = { bpm: a.bpm || null, note: 'no steady beat found' };
    } catch (e) { music = { error: e.message.split('\n')[0] }; }
  }

  const lens = shots.map((s) => s.length);
  const kinds = {};
  for (const t of transitions) kinds[t.type] = (kinds[t.type] || 0) + 1;
  const report = {
    file: basename(file), width: meta.width, height: meta.height, fps: meta.fps, duration: r3(meta.duration || duration), frames: n,
    shots: shots.map((s, i) => ({ index: i + 1, ...s })),
    summary: {
      shotCount: shots.length, averageShot: r2(lens.reduce((a, b) => a + b, 0) / lens.length), medianShot: r2(median(lens)), shortestShot: r2(Math.min(...lens)), longestShot: r2(Math.max(...lens)),
      cutsPerMinute: r2((transitions.length / Math.max(0.01, duration)) * 60), transitions: kinds,
      activity: r3(pace.reduce((a, b) => a + b, 0) / Math.max(1, pace.length)), stillStretches: still,
      cameraMoving: r2(shots.reduce((a, s) => a + s.camera.moving * s.length, 0) / Math.max(0.01, duration)),
    },
    transitions,
    pacing: { every: 0.5, values: pace },
    colors: { background: bgc && bgc.hex, theme: meanLuma < 90 ? 'dark' : meanLuma > 165 ? 'light' : 'mid', palette: colors, accents: accents.map((c) => c.hex) },
    layout: { grid: layoutShare, note: 'share of picture detail in a 3x3 grid (rows top to bottom), averaged over the middle of every shot' },
    music,
    seconds: 0,
  };
  report.recipe = recipe(report);

  // 11. Pictures
  const outDir = resolve(opts.output || join(dirname(file), 'analysis', basename(file).replace(/\.[^.]+$/, '')));
  mkdirSync(outDir, { recursive: true });
  report.files = {};
  if (opts.sheets !== false) {
    const every = opts.every ? +opts.every : Math.max(0.5, Math.ceil((duration / 48) * 2) / 2);
    report.files.sheet = await videoSheet(file, { output: join(outDir, 'sheet.png'), every, meta, chrome: opts.chrome, title: `${basename(file)} · every ${every} s` });
    report.files.shots = await shotSheet(file, report, join(outDir, 'shots.png'), opts);
  }
  report.seconds = r2((Date.now() - t0) / 1000);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'report.md'), formatAnalysis(report));
  report.files.json = join(outDir, 'report.json');
  report.files.md = join(outDir, 'report.md');
  return report;
}

function panDir(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > ay * 2) return dx > 0 ? 'right' : 'left';
  if (ay > ax * 2) return dy > 0 ? 'down' : 'up';
  return (dy > 0 ? 'down' : 'up') + '-' + (dx > 0 ? 'right' : 'left');
}

/** A short "style recipe" in motionwright terms. */
function recipe(r) {
  const s = r.summary, out = [];
  const kinds = Object.entries(s.transitions).sort((a, b) => b[1] - a[1]);
  const total = kinds.reduce((a, [, v]) => a + v, 0);
  out.push(`${s.shotCount} shots, ${s.averageShot} s on average (median ${s.medianShot} s, ${s.shortestShot}-${s.longestShot} s): ${s.medianShot < 1 ? 'very fast cutting' : s.medianShot < 2 ? 'fast cutting' : s.medianShot < 4 ? 'medium pace' : 'slow, long holds'}.`);
  if (total) {
    const map = { cut: 'hard cuts (no data-transition)', fade: 'data-transition="fade"', dip: 'data-transition="dip"', 'zoom-in': 'data-transition="zoom-through"', 'zoom-out': 'data-transition="zoom"', iris: 'data-transition="iris"', 'iris-in': 'a closing iris (custom clip-path)', other: 'custom transitions (morph, shapes, or something the analysis cannot name)' };
    out.push('Scene changes: ' + kinds.map(([k, v]) => `${v} ${k}`).join(', ') + '. In motionwright: ' + kinds.slice(0, 3).map(([k]) => map[k] || `data-transition="${k}"`).join('; ') + '.');
  }
  if (r.music && r.music.bpm) out.push(`Music at ${r.music.bpm} BPM${r.music.cuts ? `; ${r.music.cutsOnBeat} of ${r.music.cuts} scene changes land on a beat (${r.music.cutsOnBar} on a bar start)` : ''}${r.music.shotBeats ? `; a typical shot lasts ${r.music.shotBeats} beats` : ''}. Plan with \`motionwright audio\` and data-cuts.`);
  const cams = {};
  for (const sh of r.shots) { const k = sh.camera.label.split(' ').slice(0, 2).join(' '); cams[k] = (cams[k] || 0) + sh.length; }
  const camTop = Object.entries(cams).sort((a, b) => b[1] - a[1]);
  if (camTop.length) out.push('Camera: ' + camTop.slice(0, 3).map(([k, v]) => `${k} (${Math.round((v / r.duration) * 100)}% of the time)`).join(', ') + '. "move-left" means the picture slides left (as data-camera names it). In motionwright: data-camera="push 1.06", "move-left 200", "handheld", or mw.camera shots.');
  const c = r.colors;
  out.push(`Colors: ${c.theme} look, background ${c.background}${c.accents.length ? ', accents ' + c.accents.join(' ') : ''}; main colors ${c.palette.slice(0, 5).map((p) => `${p.hex} ${Math.round(p.share * 100)}%`).join(', ')}.`);
  out.push(`Pacing: ${Math.round(s.activity * 100)}% of the picture changes per half second on average${s.stillStretches.length ? `; still stretches at ${s.stillStretches.map(([a, b]) => `${a}-${b} s`).join(', ')}` : '; no still stretches'}.`);
  const g = r.layout.grid, centre = g[4], left = g[0] + g[3] + g[6], right = g[2] + g[5] + g[8], top = g[0] + g[1] + g[2], bottom = g[6] + g[7] + g[8];
  out.push(`Layout: detail is ${centre >= 0.3 ? 'mostly in the center' : left > right * 1.5 ? 'mostly on the left' : right > left * 1.5 ? 'mostly on the right' : top > bottom * 1.5 ? 'mostly in the top half' : bottom > top * 1.5 ? 'mostly in the bottom half' : 'spread over the frame'}.`);
  return out;
}

export function formatAnalysis(r) {
  const L = [];
  const s = r.summary;
  L.push(`# ${r.file}: ${r.width}x${r.height} ${r.fps}fps ${r.duration}s`);
  L.push('');
  L.push('## Style recipe');
  for (const x of r.recipe) L.push('- ' + x);
  L.push('');
  L.push('## Pacing');
  const bars = ' ▁▂▃▄▅▆▇█';
  L.push('`|' + r.pacing.values.map((f) => bars[f < 0.02 ? 0 : Math.max(1, Math.min(8, Math.ceil((f / 0.5) * 8)))]).join('') + '|` one mark = 0.5 s');
  L.push('');
  L.push(`## Shots (${s.shotCount}, average ${s.averageShot} s, ${s.cutsPerMinute} changes per minute)`);
  L.push('');
  L.push('| # | start | end | length | camera | activity | colors | then |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const sh of r.shots) L.push(`| ${sh.index} | ${sh.start.toFixed(2)} | ${sh.end.toFixed(2)} | ${sh.length.toFixed(2)} | ${sh.camera.label} | ${Math.round(sh.activity * 100)}% | ${sh.colors.join(' ')} | ${sh.into || 'end'} |`);
  L.push('');
  L.push('## Colors');
  L.push(`${r.colors.theme}, background ${r.colors.background}. Palette: ${r.colors.palette.map((p) => `${p.hex} (${Math.round(p.share * 100)}%)`).join(', ')}`);
  if (r.music) { L.push(''); L.push('## Music'); L.push(r.music.bpm ? `${r.music.bpm} BPM, beat ${r.music.beatSeconds} s. Scene changes on a beat: ${r.music.cutsOnBeat}/${r.music.cuts} (on a bar: ${r.music.cutsOnBar}).` : (r.music.note || r.music.error || 'no music analysis')); }
  if (r.files && (r.files.sheet || r.files.shots)) { L.push(''); L.push('## Pictures'); if (r.files.sheet) L.push(`- ${r.files.sheet}: the whole video at even steps`); if (r.files.shots) L.push(`- ${r.files.shots}: start, middle and end of every shot`); }
  return L.join('\n') + '\n';
}

/** Compare two reports ("yours" vs a reference): the differences that matter, in plain words. */
export function compareAnalyses(mine, ref) {
  const a = mine.summary, b = ref.summary, out = [];
  const pct = (x, y) => (y ? Math.round(((x - y) / y) * 100) : 0);
  out.push(`Shots: yours ${a.shotCount} (median ${a.medianShot} s), reference ${b.shotCount} (median ${b.medianShot} s)${Math.abs(pct(a.medianShot, b.medianShot)) > 25 ? ` → ${a.medianShot > b.medianShot ? 'cut faster: shorten scenes' : 'hold shots longer'}` : ' → similar'}.`);
  out.push(`Changes per minute: yours ${a.cutsPerMinute}, reference ${b.cutsPerMinute}.`);
  const kinds = (k) => Object.entries(k).sort((x, y) => y[1] - x[1]).map(([t, v]) => `${t} ${v}`).join(', ') || 'none';
  out.push(`Scene changes: yours ${kinds(a.transitions)}; reference ${kinds(b.transitions)}.`);
  out.push(`Activity: yours ${Math.round(a.activity * 100)}%, reference ${Math.round(b.activity * 100)}% of the picture changing per half second${a.activity < b.activity * 0.7 ? ' → yours is calmer: more motion, camera moves, or shorter holds' : a.activity > b.activity * 1.4 ? ' → yours is busier: fewer things moving at once' : ''}.`);
  out.push(`Camera moving: yours ${Math.round(a.cameraMoving * 100)}% of the time, reference ${Math.round(b.cameraMoving * 100)}%.`);
  out.push(`Still stretches: yours ${a.stillStretches.length}, reference ${b.stillStretches.length}.`);
  out.push(`Colors: yours ${mine.colors.theme} on ${mine.colors.background} (accents ${mine.colors.accents.join(' ') || 'none'}), reference ${ref.colors.theme} on ${ref.colors.background} (accents ${ref.colors.accents.join(' ') || 'none'}).`);
  if (mine.music && ref.music && mine.music.cuts && ref.music.cuts) out.push(`On the beat: yours ${mine.music.cutsOnBeat}/${mine.music.cuts}, reference ${ref.music.cutsOnBeat}/${ref.music.cuts}.`);
  return out;
}

// ---------------------------------------------------------------------------
// Contact sheets of a video file (laid out in Chrome, like `snapshot`)
// ---------------------------------------------------------------------------
async function withSheetPage(opts, fn) {
  const { ensureChrome, FramePage } = await import('./browser.js');
  const chrome = await ensureChrome({ chrome: opts.chrome });
  const page = new FramePage({ chrome, width: 1280, height: 720, scale: 1, capture: 'screenshot' });
  await page.start();
  try { return await fn(page); } finally { await page.close(); }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (t) => (t >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : `${t.toFixed(2)}s`);

async function layoutSheet(page, { title, rows, cols, cellW, cellH }) {
  const { renderHtmlToPng } = await import('./check.js');
  const rowH = cellH + 30, labelRows = rows.some((r) => r.label);
  const nRows = rows.length;
  const sheetW = cols * cellW + (cols + 1) * 10;
  const sheetH = 40 + nRows * (rowH + (labelRows ? 26 : 0)) + (nRows + 1) * 10;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;background:#111;font:14px/1.2 Inter,Helvetica,Arial,sans-serif;color:#ddd;width:${sheetW}px;height:${sheetH}px;overflow:hidden}
    header{height:40px;display:flex;align-items:center;padding:0 10px;color:#aaa}
    .row{padding:0 10px 10px} .lab{height:26px;display:flex;align-items:center;color:#fff;font-weight:600}
    .g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:10px}
    figure{margin:0} img{display:block;width:${cellW}px;height:${cellH}px;object-fit:contain;background:#000;outline:1px solid #333}
    figcaption{height:30px;display:flex;align-items:center;gap:8px;color:#eee} span{color:#999}
  </style></head><body><header>${esc(title)}</header>${rows.map((r) => `<div class="row">${r.label ? `<div class="lab">${esc(r.label)}</div>` : ''}<div class="g">${r.cells.map((c) => `<figure><img src="data:image/jpeg;base64,${c.data.toString('base64')}"><figcaption><b>${esc(c.caption)}</b><span>${esc(c.sub || '')}</span></figcaption></figure>`).join('')}</div></div>`).join('')}</body></html>`;
  return renderHtmlToPng(page, html, sheetW, sheetH);
}

/** One picture every `every` seconds, in one sheet (the judges' view). Returns the file path. */
export async function videoSheet(input, { output, every = 0.5, cols, width, meta, chrome, title, from = 0, to } = {}) {
  const file = resolve(input);
  meta = meta || probeVideo(file);
  const end = Math.min(to ?? meta.duration, meta.duration) - 1 / meta.fps;
  const times = [];
  for (let t = from; t <= end + 1e-9 && times.length < 240; t += every) times.push(Math.round(t * 1000) / 1000);
  const vertical = meta.height > meta.width;
  cols = cols || (vertical ? 10 : 6);
  const cellW = width || (vertical ? 180 : 320);
  const cellH = Math.round((cellW * meta.height) / meta.width);
  const frames = await grabFrames(file, times, { fps: meta.fps, width: cellW * 2 });
  const cells = times.map((t) => ({ data: frames.get(Math.round(t * meta.fps)), caption: fmtT(t) })).filter((c) => c.data);
  const rows = [];
  for (let i = 0; i < cells.length; i += cols) rows.push({ cells: cells.slice(i, i + cols) });
  const png = await withSheetPage({ chrome }, (page) => layoutSheet(page, { title: title || `${basename(file)} · every ${every} s`, rows, cols, cellW, cellH }));
  const out = resolve(output || join(dirname(file), basename(file).replace(/\.[^.]+$/, '') + '-sheet.png'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  return out;
}

/** Start, middle and end of every shot: one row per shot. */
async function shotSheet(file, report, output, opts) {
  const fps = report.fps;
  const pick = report.shots.slice(0, 60).map((s) => {
    const a = s.start + Math.min(0.1, s.length / 4), b = Math.max(a, s.end - Math.min(0.1, s.length / 4) - 1 / fps);
    return [a, (s.start + s.end) / 2, b];
  });
  const frames = await grabFrames(file, pick.flat(), { fps, width: 480 });
  const vertical = report.height > report.width;
  const cellW = vertical ? 200 : 360, cellH = Math.round((cellW * report.height) / report.width);
  const rows = report.shots.slice(0, 60).map((s, i) => ({
    label: `shot ${s.index} · ${fmtT(s.start)} – ${fmtT(s.end)} (${s.length.toFixed(2)} s) · camera: ${s.camera.label} · then: ${s.into || 'end'}`,
    cells: pick[i].map((t, k) => ({ data: frames.get(Math.round(t * fps)), caption: fmtT(t), sub: ['start', 'middle', 'end'][k] })).filter((c) => c.data),
  }));
  const png = await withSheetPage(opts, (page) => layoutSheet(page, { title: `${report.file} · ${report.shots.length} shots`, rows, cols: 3, cellW, cellH }));
  writeFileSync(output, png);
  return output;
}
