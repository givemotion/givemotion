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
// where each column / row of b sits in a for a zoom z around the center (the same for every frame of a size)
const zoomMaps = new Map();
function zoomMap(w, h, z) {
  const key = `${w}x${h}@${z}`;
  let m = zoomMaps.get(key);
  if (!m) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    m = { xs: Int16Array.from({ length: w }, (_, x) => Math.round(cx + (x - cx) / z)), ys: Int16Array.from({ length: h }, (_, y) => Math.round(cy + (y - cy) / z)) };
    zoomMaps.set(key, m);
  }
  return m;
}
/** Mean luma difference between b and a moved by (dx, dy) and zoomed by z; only where `mask` is set (if given). */
function moveCost(a, b, w, h, dx, dy, z, mask) {
  const { xs, ys } = zoomMap(w, h, z), mx = Math.round(w * 0.12), my = Math.round(h * 0.12);
  let s = 0, n = 0, all = 0;
  for (let y = my; y < h - my; y++) {
    const ay = ys[y] - dy, bo = y * w;
    for (let x = mx; x < w - mx; x++) {
      if (mask && !mask[bo + x]) continue;
      all++;
      const ax = xs[x] - dx;
      if (ay < 0 || ay >= h || ax < 0 || ax >= w) continue;
      s += Math.abs(b[bo + x] - a[ay * w + ax]); n++;
    }
  }
  // a move that leaves most of the picture outside the frame cannot be judged
  return n >= 12 && n >= all * 0.5 ? s / n : 255;
}
/** Share of the pixels of b (central part) within 10 luma levels of a moved by (dx, dy) and zoomed by z. */
function fitShare(a, b, w, h, dx, dy, z) {
  const { xs, ys } = zoomMap(w, h, z), mx = Math.round(w * 0.12), my = Math.round(h * 0.12);
  let ok = 0, n = 0;
  for (let y = my; y < h - my; y++) {
    const ay = ys[y] - dy;
    for (let x = mx; x < w - mx; x++) {
      const ax = xs[x] - dx;
      if (ay < 0 || ay >= h || ax < 0 || ax >= w) continue;
      n++;
      if (Math.abs(b[y * w + x] - a[ay * w + ax]) <= 10) ok++;
    }
  }
  return n ? ok / n : 0;
}
const halves = new WeakMap();
/** The picture at half size (2x2 average), cached per frame. */
function half(L, w, h, isMask) {
  let o = halves.get(L);
  if (o) return o;
  const W = w >> 1, H = h >> 1;
  o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = 2 * y * w + 2 * x;
    o[y * W + x] = isMask ? L[q] | L[q + 1] | L[q + w] | L[q + w + 1] : (L[q] + L[q + 1] + L[q + w] + L[q + w + 1] + 2) >> 2;
  }
  halves.set(L, o);
  return o;
}
const CAMERA_ZOOMS = [0.94, 0.97, 1, 1.03, 1.06];
/**
 * Best global move from frame a to frame b (camera estimate): shift in grid px and zoom around the center.
 * Searched at half size first (shifts up to `range` grid px), then refined at full size.
 * With `mask`, only those pixels of b count (e.g. the content, not a still background).
 */
function globalMotion(a, b, w, h, { mask = null, range = 16, zooms = CAMERA_ZOOMS } = {}) {
  const W = w >> 1, H = h >> 1, A = half(a, w, h), B = half(b, w, h), M = mask ? half(mask, w, h, true) : null;
  const R = Math.max(1, Math.round(range / 2));
  let best = { dx: 0, dy: 0, z: 1, c: moveCost(A, B, W, H, 0, 0, 1, M) };
  for (const z of zooms) {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const c = moveCost(A, B, W, H, dx, dy, z, M);
      if (c < best.c - 1e-9) best = { dx, dy, z, c };
    }
  }
  // refine at full size around the coarse answer
  const cost = (dx, dy, z) => moveCost(a, b, w, h, dx, dy, z, mask);
  const still = cost(0, 0, 1);
  const zi = zooms.indexOf(best.z), zs = [...new Set([best.z, (best.z + (zooms[zi - 1] ?? best.z)) / 2, (best.z + (zooms[zi + 1] ?? best.z)) / 2])];
  let fine = { dx: 0, dy: 0, z: 1, c: still };
  for (const z of zs) for (let dy = 2 * best.dy - 1; dy <= 2 * best.dy + 1; dy++) for (let dx = 2 * best.dx - 1; dx <= 2 * best.dx + 1; dx++) {
    const c = cost(dx, dy, z);
    if (c < fine.c - 1e-9) fine = { dx, dy, z, c };
  }
  // sub-pixel: fit a parabola through the costs next to the best shift
  const sub = (c0, cm, cp) => { const d = cm - 2 * c0 + cp; return d > 1e-9 && cm < 255 && cp < 255 ? Math.max(-0.5, Math.min(0.5, (cm - cp) / (2 * d))) : 0; };
  const fx = sub(fine.c, cost(fine.dx - 1, fine.dy, fine.z), cost(fine.dx + 1, fine.dy, fine.z));
  const fy = sub(fine.c, cost(fine.dx, fine.dy - 1, fine.z), cost(fine.dx, fine.dy + 1, fine.z));
  return { ...fine, dx: fine.dx + fx, dy: fine.dy + fy, still };
}

/**
 * The three simple moves of a transition, each on its own, from frame a to frame b: a slide along x, a slide along y,
 * a zoom around the center. Separate searches do not trade one axis against the other (a horizontal edge says nothing
 * about x). Returns each move's best value and cost, and the cost of no move.
 */
function axisMotion(a, b, w, h, { mask = null, range = 32, zooms = [0.8, 0.86, 0.91, 0.95, 0.975, 1.025, 1.05, 1.1, 1.16, 1.25] } = {}) {
  const W = w >> 1, H = h >> 1, A = half(a, w, h), B = half(b, w, h), M = mask ? half(mask, w, h, true) : null;
  const R = Math.max(1, Math.round(range / 2));
  const cost = (dx, dy, z) => moveCost(a, b, w, h, dx, dy, z, mask);
  const still = cost(0, 0, 1);
  const line = (axis) => {
    let bd = 0, bc = Infinity;
    for (let d = -R; d <= R; d++) { if (!d) continue; const c = axis ? moveCost(A, B, W, H, 0, d, 1, M) : moveCost(A, B, W, H, d, 0, 1, M); if (c < bc - 1e-9) { bc = c; bd = d; } }
    let fd = 0, fc = Infinity;
    for (let d = 2 * bd - 1; d <= 2 * bd + 1; d++) { if (!d) continue; const c = axis ? cost(0, d, 1) : cost(d, 0, 1); if (c < fc - 1e-9) { fc = c; fd = d; } }
    return { d: fd, c: fc };
  };
  let bz = 1, bc = Infinity;
  for (const z of zooms) { const c = moveCost(A, B, W, H, 0, 0, z, M); if (c < bc - 1e-9) { bc = c; bz = z; } }
  return { still, x: line(0), y: line(1), z: { z: bz, c: cost(0, 0, bz) } };
}

/**
 * Where did the content of `ref` (the pixels in `pts`) go in `img`: the best shift along x or along y, up to half the
 * frame, and how much better it fits than no shift (ratio < 1). One axis at a time, like a push or a whip.
 */
function contentShift(ref, img, pts, w, h) {
  const cost = (dx, dy) => {
    let s = 0, m = 0;
    for (const q of pts) {
      const x = (q % w) + dx, y = ((q / w) | 0) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      s += Math.abs(img[y * w + x] - ref[q]); m++;
    }
    return m >= pts.length * 0.4 && m >= 10 ? s / m : Infinity;
  };
  const c0 = cost(0, 0);
  let best = { axis: 'x', d: 0, c: Infinity };
  for (let d = -(w >> 1); d <= w >> 1; d++) if (d) { const c = cost(d, 0); if (c < best.c - 1e-9) best = { axis: 'x', d, c }; }
  for (let d = -(h >> 1); d <= h >> 1; d++) if (d) { const c = cost(0, d); if (c < best.c - 1e-9) best = { axis: 'y', d, c }; }
  return { ...best, ratio: c0 > 0 ? best.c / c0 : 1 };
}

/** Per color channel, the darkest and brightest value in each 3x3 neighbourhood (for comparisons that forgive a 1 px move). */
function envelope(rgb, w, h) {
  const n = w * h * 3, tmn = new Uint8Array(n), tmx = new Uint8Array(n), mn = new Uint8Array(n), mx = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const k = (y * w + x) * 3 + c, l = x > 0 ? k - 3 : k, r = x < w - 1 ? k + 3 : k;
    tmn[k] = Math.min(rgb[l], rgb[k], rgb[r]); tmx[k] = Math.max(rgb[l], rgb[k], rgb[r]);
  }
  const row = w * 3;
  for (let y = 0; y < h; y++) for (let k = y * row, e = k + row; k < e; k++) {
    const u = y > 0 ? k - row : k, d = y < h - 1 ? k + row : k;
    mn[k] = Math.min(tmn[u], tmn[k], tmn[d]); mx[k] = Math.max(tmx[u], tmx[k], tmx[d]);
  }
  return { mn, mx };
}
/** Coarse color histogram (4 levels per channel), as shares. */
function histogram(rgb) {
  const hgm = new Float64Array(64), n = rgb.length / 3;
  for (let k = 0; k < rgb.length; k += 3) hgm[((rgb[k] >> 6) << 4) | ((rgb[k + 1] >> 6) << 2) | (rgb[k + 2] >> 6)]++;
  for (let i = 0; i < 64; i++) hgm[i] /= n;
  return hgm;
}
const histSame = (p, q) => { let s = 0; for (let i = 0; i < 64; i++) s += Math.min(p[i], q[i]); return s; };

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
  const all = rgbsAll, npx = w * h;
  // Edges (text, shapes) of each frame, and the detail around them: on a shared background a scene change only touches the detail.
  const edges = lum.map((L) => {
    const m = new Uint8Array(npx);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const q = y * w + x;
      if (Math.abs(L[q + 1] - L[q - 1]) + Math.abs(L[q + w] - L[q - w]) > 36) m[q] = 1;
    }
    return m;
  });
  const detail = edges.map((E) => {
    const m = new Uint8Array(npx);
    for (let q = 0; q < npx; q++) if (E[q]) { m[q] = 1; m[q - 1] = 1; m[q + 1] = 1; m[q - w] = 1; m[q + w] = 1; }
    return m;
  });
  const minDetail = npx * 0.015, minEdges = npx * 0.01;
  /** 0..1: how much of the picture is new (the whole frame, or the detail when the background stays). Used for pacing. */
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

  // 2. Scene changes. A scene change REPLACES the picture: the old content is gone and new content is there.
  //    `replaced(i, j)` forgives a 1 px move and soft color drift, and looks at two things:
  //    - the share of all pixels whose color is new (plain backgrounds that change color), counted both ways;
  //    - the share of frame i's edges that are gone in j AND of j's edges that were not in i (content that was
  //      swapped, on a background that stays). Something entering keeps the old edges; something leaving does not
  //      bring new ones; moving particles and drifting gradients stay inside the 1 px tolerance.
  const envs = new Map();
  const envOf = (f) => {
    let e = envs.get(f);
    if (!e) { e = envelope(all[f], w, h); envs.set(f, e); if (envs.size > 300) envs.delete(envs.keys().next().value); }
    return e;
  };
  const TOL = 18;
  const pairs = new Map();
  /** { chg, gA, gB }: share of pixels with a new color (both ways), share of i's edges gone in j, of j's edges new (null: too few edges). */
  const pairInfo = (i, j) => {
    const key = i * n + j;
    let r = pairs.get(key);
    if (r) return r;
    const a = all[i], b = all[j], ea = envOf(i), eb = envOf(j), Ea = edges[i], Eb = edges[j];
    let ca = 0, cb = 0, ga = 0, gb = 0, na = 0, nb = 0;
    for (let q = 0, k = 0; q < npx; q++, k += 3) {
      const outA = a[k] + TOL < eb.mn[k] || a[k] > eb.mx[k] + TOL || a[k + 1] + TOL < eb.mn[k + 1] || a[k + 1] > eb.mx[k + 1] + TOL || a[k + 2] + TOL < eb.mn[k + 2] || a[k + 2] > eb.mx[k + 2] + TOL;
      const outB = b[k] + TOL < ea.mn[k] || b[k] > ea.mx[k] + TOL || b[k + 1] + TOL < ea.mn[k + 1] || b[k + 1] > ea.mx[k + 1] + TOL || b[k + 2] + TOL < ea.mn[k + 2] || b[k + 2] > ea.mx[k + 2] + TOL;
      if (outA) ca++;
      if (outB) cb++;
      if (Ea[q]) { na++; if (outA) ga++; }
      if (Eb[q]) { nb++; if (outB) gb++; }
    }
    r = { chg: Math.min(ca, cb) / npx, gA: na >= minEdges ? ga / na : null, gB: nb >= minEdges ? gb / nb : null };
    pairs.set(key, r);
    return r;
  };
  /** 0..1: how much of picture i is replaced in picture j (new colors, or old content gone AND new content there). */
  const replaced = (i, j) => {
    const p = pairInfo(i, j);
    if (p.gA != null && p.gB != null) return Math.max(p.chg, Math.min(p.gA, p.gB));
    // content on one side only: something entered an empty picture (or left it), unless most of the frame changed color
    if (p.gA != null || p.gB != null) return p.chg >= 0.6 ? p.chg : p.chg * 0.5;
    return p.chg;
  };
  /** 0..1: how much changed in any way (colors, old content gone, new content come). */
  const changed = (i, j) => { const p = pairInfo(i, j); return Math.max(p.chg, p.gA ?? 0, p.gB ?? 0); };
  const debug = opts.debug ? { candidates: [] } : null;
  const mad = (i, j) => { const a = all[i], b = all[j]; let s2 = 0; for (let k = 0; k < a.length; k++) s2 += Math.abs(a[k] - b[k]); return s2; };
  const cutAt = (S, E) => {
    // One frame carries the change: up to it the old picture is all there (since the change began, and for 0.2 s at
    // least: a whip, or the circle of an iris, moves just before its last big frame), and the frames right after it
    // stay as they are (a fast fade also jumps on its first frame, but keeps changing). New content may enter later.
    let best = -1, jump = 0;
    for (let f = S + 1; f <= E; f++) {
      const v = changed(f - 1, f);
      if (v < 0.4 || v <= jump) continue;
      const pre = Math.max(0, Math.min(S, f - 1 - Math.round(fps * 0.2)));
      if (changed(pre, f - 1) < 0.2 && changed(f, Math.min(n - 1, f + 2)) < 0.25) { best = f; jump = v; }
    }
    return best;
  };
  const hists = new Map();
  const histOf = (f) => { let x = hists.get(f); if (!x) hists.set(f, (x = histogram(all[f]))); return x; };
  const WIDE_ZOOMS = [0.85, 0.9, 0.94, 0.97, 1, 1.03, 1.06, 1.1, 1.17];
  const steps = new Map();
  const stepMove = (f) => {
    let g = steps.get(f);
    if (!g) {
      g = globalMotion(lum[f - 1], lum[f], w, h, { zooms: WIDE_ZOOMS });
      // the share of pixels that fit after the move, and without it (content entering during a camera move is a minority)
      g.fit = fitShare(lum[f - 1], lum[f], w, h, Math.round(g.dx), Math.round(g.dy), g.z);
      g.fit0 = fitShare(lum[f - 1], lum[f], w, h, 0, 0, 1);
      steps.set(f, g);
    }
    return g;
  };
  // a step is a camera move when moving the previous frame makes it fit: on average, or for most pixels
  const explained = (g) => g.still >= 2 && (g.c < g.still * 0.35 || (g.fit >= 0.75 && g.fit - g.fit0 >= 0.1));
  /**
   * The camera moved over one picture: the colors stay the same, and the last frame is the first one moved a little,
   * or, over the whole move (it can start before S and end after E), each frame is the one before it moved (weighted
   * by how much each step changes, so one cut or the blurred middle of a whip among small steps is not explained away)
   * for a few frames at least (a camera does not jump in one frame). Not a camera move either: the picture slid a third
   * of a frame or more in a blink (a push or a whip; on a plain or smooth background a fast camera pan looks the same,
   * and counts as one).
   */
  const cameraMove = (S, E, note) => {
    const same = histSame(histOf(S), histOf(E));
    if (same <= 0.75) return false;
    const gm = globalMotion(lum[S], lum[E], w, h);
    const direct = gm.still > 3 && gm.c < gm.still * 0.3;
    if (note) note.camera = { direct: r2(gm.still ? gm.c / gm.still : 1), colors: r2(same) };
    let a = S, b = E;
    const lim = Math.round(fps * 0.5);
    while (a > 0 && S - a < lim && changed(a - 1, a) >= 0.1) a--;
    while (b + 1 < n && b - E < lim && changed(b, b + 1) >= 0.1) b++;
    let tot = 0, ok = 0, lz = 0, okSteps = 0;
    const path = [[0, 0]];
    for (let f = a + 1; f <= b; f++) {
      const g = stepMove(f), p = path[path.length - 1];
      if (g.still >= 2) tot += g.still;
      if (explained(g)) { ok += g.still; okSteps++; path.push([p[0] + g.dx, p[1] + g.dy]); lz += Math.log(g.z); } else path.push(p);
    }
    const [ex, ey] = path[path.length - 1], horiz = Math.abs(ex) / w >= Math.abs(ey) / h, total = horiz ? ex : ey;
    const slid = Math.max(Math.abs(total) / (horiz ? w : h), direct ? Math.max(Math.abs(gm.dx) / w, Math.abs(gm.dy) / h) : 0);
    let t10 = 0, t90 = 0;
    for (let i = 0; i < path.length; i++) { const v = (horiz ? path[i][0] : path[i][1]) / (total || 1); if (v < 0.1) t10 = i; if (v < 0.9) t90 = i + 1; }
    const core = (t90 - t10) / fps;
    if (note) Object.assign(note.camera, { from: a, to: b, explained: r2(tot ? ok / tot : 0), steps: okSteps, slid: r2(slid), zoom: r2(Math.exp(lz)), core: r2(core) });
    if (!direct && !(tot > 0 && ok >= tot * 0.85 && okSteps >= 3)) return false;
    if (!direct && slid < 0.03 && Math.abs(lz) < 0.03) return false; // nothing moved: a fade or a dip on a busy picture
    return !(slid >= 0.3 && core <= 0.35);
  };
  const cands = [];
  for (const sec of [0.1, 0.2, 0.45]) {
    const m = Math.max(2, Math.round(fps * sec));
    const nov = new Float32Array(n);
    for (let f = m; f + m < n; f++) {
      // replaced across the moment, minus what keeps changing on both sides anyway
      const before = f - 2 * m >= 0 ? replaced(f - 2 * m, f - m) : 0, after = f + 2 * m < n ? replaced(f + m, f + 2 * m) : 0;
      nov[f] = replaced(f - m, f + m) - Math.min(before, after);
    }
    for (let f = m; f + m < n; f++) {
      if (nov[f] < 0.3) continue;
      let peak = true;
      for (let r = Math.max(0, f - m); r <= Math.min(n - 1, f + m); r++) if (nov[r] > nov[f] || (nov[r] === nov[f] && r < f)) peak = false;
      if (peak) cands.push({ f, m, v: nov[f] });
    }
  }
  // the strongest candidate wins where two scales found the same change
  cands.sort((a, b) => b.v - a.v || a.f - b.f || a.m - b.m);
  const transitionsRaw = [];
  const taken = [];
  for (const c of cands) {
    const note = (why, extra) => debug && debug.candidates.push({ t: r3(c.f / fps), m: c.m, v: r3(c.v), why, ...extra });
    if (taken.some(([a, b]) => (c.f >= a - 2 && c.f <= b + 2) || ((a + b) / 2 >= c.f - c.m && (a + b) / 2 <= c.f + c.m))) { note('overlap'); continue; }
    let S = c.f - c.m, E = c.f + c.m;
    const S0 = S, E0 = E;
    // tighten to where the change starts and ends (by how far each frame is on its way from the old picture to the new)
    const prog = (f) => { const x = mad(S0, f), y = mad(f, E0); return x + y ? x / (x + y) : 0; };
    while (S + 1 < E && prog(S + 1) < 0.04) S++;
    while (E - 1 > S && prog(E - 1) > 0.96) E--;
    const r = replaced(S, E);
    // something entered or left, the rest is still there (this does not hide a longer change around it from the other scales)
    if (r < 0.4) { note('not replaced', { r: r3(r), S, E }); continue; }
    taken.push([S0, E0]);
    const cam = debug ? {} : null;
    if (cameraMove(S, E, cam)) { note('camera', { S, E, ...cam }); continue; } // the camera moved; the picture is the same
    note('scene change', { r: r3(r), S, E, ...cam });
    const cf = cutAt(S, E);
    if (cf >= 0) transitionsRaw.push({ type: 'cut', S: cf - 1, E: cf, frame: cf });
    else transitionsRaw.push({ type: null, S, E });
  }
  // two gradual changes that touch are one (e.g. both halves of a dip): no shot is that short. The same cut found
  // twice is one, and a cut on the last frames of a gradual change belongs to it (an old scene removed at the end of
  // a transition into a see-through one)
  transitionsRaw.sort((a, b) => a.S - b.S || a.E - b.E);
  for (let i = 1; i < transitionsRaw.length; i++) {
    const p = transitionsRaw[i - 1], t = transitionsRaw[i];
    if (p.type === null && t.type === null && t.S - p.E <= Math.round(fps * 0.2)) { p.E = Math.max(p.E, t.E); transitionsRaw.splice(i--, 1); }
    else if (p.type === 'cut' && t.type === 'cut' && t.frame - p.frame <= 1) transitionsRaw.splice(i--, 1);
    else if (p.type === null && t.type === 'cut' && t.frame <= p.E + Math.round(fps * 0.1)) transitionsRaw.splice(i--, 1);
  }
  const isCut = new Set(transitionsRaw.filter((t) => t.type === 'cut').map((t) => t.frame));

  // 3. Classify each gradual change by how the new picture arrives
  const meanL = (f) => { let s = 0; for (const v of f) s += v; return s / f.length; };
  const classify = (S, E) => {
    const a = all[S], b = all[E], la = meanL(lum[S]), lb = meanL(lum[E]);
    const info = debug ? { t: r3(S / fps) + '-' + r3(E / fps) } : null;
    if (info) (debug.classes = debug.classes || []).push(info);
    // the pixels the change is about, and among them the content (detail of the old or the new picture)
    const D = [], DE = [];
    for (let q = 0, k = 0; q < npx; q++, k += 3) {
      if (Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2])) <= 24) continue;
      D.push(q);
      if (detail[S][q] || detail[E][q]) DE.push(q);
    }
    if (D.length < npx * 0.01) return 'other';
    // a. through black
    let dipLuma = Infinity;
    for (let f = S + 1; f < E; f++) dipLuma = Math.min(dipLuma, meanL(lum[f]));
    if (dipLuma < Math.min(la, lb) * 0.5 && dipLuma < 40) return 'dip';

    // b. how the content moves, frame by frame, measured on the detail that changes (a background or content that stays
    //    still does not count): a slide along x, along y, or a zoom, whichever explains the frame best
    let sx = 0, sy = 0, ax = 0, ay = 0, lz = 0, nx = 0, ny = 0, nz = 0, steps = 0;
    const mask = new Uint8Array(npx);
    for (let f = S + 1; f <= E; f++) {
      const dm = detail[f], L0 = lum[f - 1], L1 = lum[f];
      let cnt = 0;
      for (let q = 0; q < npx; q++) cnt += mask[q] = dm[q] && Math.abs(L1[q] - L0[q]) > 12 ? 1 : 0;
      if (cnt < minDetail / 2) continue;
      steps++;
      const g = axisMotion(L0, L1, w, h, { mask });
      halves.delete(mask); // the mask changes every frame
      const bestC = Math.min(g.x.c, g.y.c, g.z.c);
      if (!(bestC < g.still * 0.75)) continue;
      if (g.x.c === bestC) { nx++; sx += g.x.d; ax += Math.abs(g.x.d); }
      else if (g.y.c === bestC) { ny++; sy += g.y.d; ay += Math.abs(g.y.d); }
      else { nz++; lz += Math.log(g.z.z); }
    }
    const zoomed = Math.exp(lz), fx = Math.abs(sx) / w, fy = Math.abs(sy) / h;
    const horiz = fx >= fy, nAxis = horiz ? nx : ny, along = horiz ? fx : fy, steady = horiz ? Math.abs(sx) / Math.max(1e-9, ax) : Math.abs(sy) / Math.max(1e-9, ay);
    const slide = 'push-' + (horiz ? (sx < 0 ? 'left' : 'right') : (sy < 0 ? 'up' : 'down'));
    if (info) Object.assign(info, { sx: r2(sx), sy: r2(sy), zoom: r3(zoomed), nx, ny, nz, steps, steady: r2(steady) });
    // c. a push or a whip moves the content itself; a wipe leaves it in place and only moves the edge. So: where is the
    //    old content a quarter of the way in, and where is the new content three quarters of the way in?
    {
      const prog = (f) => { const x = mad(S, f), y = mad(f, E); return x + y ? x / (x + y) : 0; };
      let f1 = S + 1, f2 = E - 1;
      while (f1 < E - 1 && prog(f1) < 0.25) f1++;
      while (f2 > S + 1 && prog(f2) > 0.75) f2--;
      const dS = detail[S], dE = detail[E], O = DE.filter((q) => dS[q]), N = DE.filter((q) => dE[q]);
      const moves = [];
      if (O.length >= 20) { const r = contentShift(lum[S], lum[f1], O, w, h); if (r.ratio < 0.6 && Math.abs(r.d) >= 2) moves.push({ axis: r.axis, dir: Math.sign(r.d), r: r2(r.ratio) }); }
      if (N.length >= 20) { const r = contentShift(lum[E], lum[f2], N, w, h); if (r.ratio < 0.6 && Math.abs(r.d) >= 2) moves.push({ axis: r.axis, dir: -Math.sign(r.d), r: r2(r.ratio) }); }
      if (info) info.content = moves;
      if (moves.length && moves.every((m) => m.axis === moves[0].axis && m.dir === moves[0].dir)) {
        const { axis, dir } = moves[0];
        return 'push-' + (axis === 'x' ? (dir < 0 ? 'left' : 'right') : (dir < 0 ? 'up' : 'down'));
      }
    }

    // d. what each changed pixel does over time. P: the content, or every changed pixel when the pictures are plain.
    //    A pixel "switches" when it shows the old picture, then (after at most two frames of edge) the new one: a wipe or
    //    an iris. It changes "smoothly" when it goes straight from old to new without detours: a fade. Moving content
    //    (push, zoom) passes other content through the pixel.
    const P = DE.length >= npx * 0.01 ? DE : D;
    const like = (c, ref, k) => Math.abs(c[k] - ref[k]) <= 14 && Math.abs(c[k + 1] - ref[k + 1]) <= 14 && Math.abs(c[k + 2] - ref[k + 2]) <= 14;
    const edgeFrames = Math.max(1, Math.round(fps / 15));
    const when = new Float32Array(npx).fill(-1); // switch time of each changed pixel, -1 = did not switch
    for (const q of D) {
      const k = q * 3;
      let lastA = S, firstB = E;
      while (lastA < E && like(all[lastA + 1], a, k)) lastA++;
      while (firstB > S && like(all[firstB - 1], b, k)) firstB--;
      if (firstB > lastA && firstB - lastA - 1 <= edgeFrames) when[q] = (lastA + firstB) / 2;
    }
    let smooth = 0, nsw = 0;
    for (const q of P) {
      if (when[q] >= 0) nsw++;
      let tv = 0;
      for (let f = S + 1; f <= E; f++) tv += Math.abs(lum[f][q] - lum[f - 1][q]);
      if (tv <= Math.abs(lum[E][q] - lum[S][q]) * 1.25 + 10) smooth++;
    }
    const switched = nsw / P.length, smoothShare = smooth / P.length;
    if (info) Object.assign(info, { plain: P !== DE, switched: r2(switched), smooth: r2(smoothShare) });
    if (switched >= 0.45) {
      // Where the new picture appears first: correlate the switch time with x, y, the distance from the center and the
      // angle, separately for the old content, the new content and the changed background. A wipe sweeps over each of
      // them in one order, and over many moments. Content that switches all at once (an old scene that just ends, or
      // one element that fades in) says nothing about the direction: elements entering one after another sit in
      // different places, which looks like an order but is not a sweep.
      const group = (keep) => {
        const fs = [[], [], [], []], ts = [];
        for (const q of D) {
          if (when[q] < 0 || !keep(q)) continue;
          const x = (q % w) / w - 0.5, y = ((q / w) | 0) / h - 0.5;
          fs[0].push(x); fs[1].push(y); fs[2].push(Math.hypot((x * w) / h, y)); fs[3].push((Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI));
          ts.push(when[q]);
        }
        if (ts.length < 20) return null;
        // the biggest share of pixels that switch within the same three frames
        const hist = new Map();
        for (const t of ts) { const k = Math.round(t); hist.set(k, (hist.get(k) || 0) + 1); }
        let lump = 0;
        for (const k of hist.keys()) lump = Math.max(lump, (hist.get(k - 1) || 0) + hist.get(k) + (hist.get(k + 1) || 0));
        const corr = fs.map((u) => {
          const m = u.length;
          let mu = 0, mt = 0; for (let i = 0; i < m; i++) { mu += u[i]; mt += ts[i]; } mu /= m; mt /= m;
          let suv = 0, suu = 0, svv = 0; for (let i = 0; i < m; i++) { const du = u[i] - mu, dv = ts[i] - mt; suv += du * dv; suu += du * du; svv += dv * dv; }
          return suu && svv ? suv / Math.sqrt(suu * svv) : 0;
        });
        return { corr, lump: lump / ts.length, n: ts.length };
      };
      const dS = detail[S], dE = detail[E];
      const all3 = [group((q) => dS[q]), group((q) => dE[q]), group((q) => !dS[q] && !dE[q])], groups = all3.map((g) => (g && g.lump <= 0.75 ? g : null));
      if (info) info.groups = all3.map((g) => g && { corr: g.corr.map(r2), lump: r2(g.lump) });
      // the clearest order decides; no other group may clearly say the opposite
      let pick = null;
      groups.forEach((g, gi) => g && g.corr.forEach((v, i) => { const s = i === 3 ? v : Math.abs(v); if (!pick || s > pick.s) pick = { s, i, v, gi }; }));
      if (pick && pick.s >= (pick.gi === 2 ? 0.5 : 0.6) && !groups.some((g) => g && Math.sign(g.corr[pick.i]) !== Math.sign(pick.v) && Math.abs(g.corr[pick.i]) >= 0.4)) {
        const cr = groups[pick.gi].corr[2];
        if (pick.i === 3 && pick.v > Math.abs(cr) + 0.1) return 'clock';
        if (pick.i >= 2) return cr > 0 ? 'iris' : 'iris-in';
        if (pick.i === 0) return pick.v > 0 ? 'wipe-right' : 'wipe-left';
        return pick.v > 0 ? 'wipe-down' : 'wipe-up';
      }
    }
    // e. or the frame-by-frame moves: a slide along one axis, steady in one direction
    if (nAxis >= 2 && along > 0.25 && steady >= 0.6 && nAxis >= nz) return slide;
    // f. zoom: the content grows or shrinks frame after frame
    if (nz >= 2 && (zoomed > 1.15 || zoomed < 0.87)) return zoomed > 1 ? 'zoom-in' : 'zoom-out';
    // g. a crossfade: every frame is a blend of the two (or the pixels go straight from the old to the new picture)
    let blendErr = 0, blendBase = 0;
    for (let f = S + 1; f < E; f++) {
      const c = lum[f], A = lum[S], B = lum[E];
      let num = 0, den = 0;
      for (let q = 0; q < npx; q++) { const d = B[q] - A[q]; num += (c[q] - A[q]) * d; den += d * d; }
      const al = den ? Math.max(0, Math.min(1, num / den)) : 0;
      for (let q = 0; q < npx; q++) { const d = Math.abs(A[q] - B[q]); if (d <= 12) continue; blendErr += Math.abs(c[q] - (A[q] + al * (B[q] - A[q]))); blendBase += d; }
    }
    const blend = blendBase ? blendErr / blendBase : 1;
    if (info) info.blend = r2(blend);
    if (blend < 0.35 || smoothShare >= 0.7) return 'fade';
    return 'other';
  };
  // the moment the picture is half way from the old shot to the new one
  // (by the average color difference: the thresholded distance jumps to "all new" too early in a fade)
  const halfway = (S, E) => { for (let f = S + 1; f < E; f++) if (mad(S, f) >= mad(f, E)) return f; return (S + E + 1) / 2; };
  const transitions = transitionsRaw.map((t) => t.type === 'cut'
    ? { type: 'cut', start: r3(t.frame / fps), end: r3(t.frame / fps), at: r3(t.frame / fps) }
    : { type: classify(t.S, t.E), start: r3((t.S + 1) / fps), end: r3(t.E / fps), at: r3(halfway(t.S, t.E) / fps) }).sort((a, b) => a.start - b.start);

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
      // the frames of a transition into or out of the shot are not the camera
      if (transitions.some((t) => f >= t.start * fps - 1 && f - cstep <= t.end * fps + 1)) continue;
      const m = globalMotion(lum[f - cstep], lum[f], w, h, { range: 8 });
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
  if (debug) report._debug = debug;

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
    const map = { cut: 'hard cuts (no data-transition)', fade: 'data-transition="fade"', dip: 'data-transition="dip"', 'zoom-in': 'data-transition="zoom-through"', 'zoom-out': 'data-transition="zoom"', iris: 'data-transition="iris"', 'iris-in': 'a closing iris (custom clip-path)', clock: 'data-transition="clock"', other: 'custom transitions (morph, shapes, or something the analysis cannot name)' };
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
