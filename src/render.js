// Render orchestration: open the composition, split frames across workers, encode, mux audio.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { cpus, tmpdir, totalmem, freemem } from 'node:os';
import { ensureChrome, FramePage, CACHE_DIR } from './browser.js';
import { startServer } from './server.js';
import { requireFfmpeg, encoderPlan, openSegmentWriter, openBlender, run as runFfmpeg, finalize, mixAudio, probe, qualitySettings, wantsHardware, encoderIsReproducible } from './ffmpeg.js';
import { pagePrints } from './parts.js';

const FORMATS = { '.mp4': 'mp4', '.webm': 'webm', '.mov': 'mov', '.gif': 'gif', '.mkv': 'mkv' };

export function formatFromOutput(out, fmt) {
  if (fmt) return fmt;
  const ext = extname(out).toLowerCase();
  if (FORMATS[ext]) return FORMATS[ext];
  if (ext === '' || ext === '.png' && out.includes('%')) return 'png';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'png';
  return 'mp4';
}

function parseRange(range, fps, totalFrames) {
  if (!range) return [0, totalFrames];
  // "a-b" in frames, or "1.5s-3s" in seconds
  const m = /^\s*([\d.]+)(s?)\s*[-:]\s*([\d.]*)(s?)\s*$/.exec(String(range));
  if (!m) throw new Error(`Bad --frames range "${range}". Use "0-90" (frames) or "1.5s-4s" (seconds).`);
  const a = m[2] ? Math.round(parseFloat(m[1]) * fps) : parseInt(m[1], 10);
  const b = m[3] === '' ? totalFrames : (m[4] ? Math.round(parseFloat(m[3]) * fps) : parseInt(m[3], 10));
  return [Math.max(0, a), Math.min(totalFrames, Math.max(a + 1, b))];
}

/**
 * Auto motion blur settings. Speeds are in px per frame on a 1080 px screen (scaled to the composition's short side).
 * Below `min` a frame is captured once, as without blur. Above it the blur is the distance covered while the shutter is
 * open (speed x shutter, 0.5 = 180°), sampled every `gap` px or closer (so it reads as a smear, not copies), with at
 * most `maxN` samples; past that the shutter closes a little so samples stay within `maxGap` px of each other.
 * Changing any value redoes every cached part (it is in the parts fingerprint).
 */
export const AUTO_BLUR = { v: 1, min: 16, gap: 6, maxN: 4, maxGap: 6, counts: [2, 3, 4] };

/** Samples and shutter for one frame moving `speed` px/frame (1080 px scale), or null for a single capture. */
export function autoBlurPlan(speed, shutter = 0.5) {
  const A = AUTO_BLUR;
  if (!(speed >= A.min) || !(shutter > 0)) return null;
  let s = Math.min(1, shutter);
  if (speed * s > A.maxN * A.maxGap) s = (A.maxN * A.maxGap) / speed;
  const want = Math.ceil((speed * s) / A.gap);
  return { n: A.counts.find((c) => c >= want) || A.maxN, shutter: s };
}

/**
 * --motion-blur: unset = auto in natural motion, off in classic motion (data-motion="classic"); "auto"; "off" (also
 * 0, false, none); a number = that many samples on every frame. Transparent renders get no auto blur (averaging
 * straight-alpha images darkens edges); a number still forces it.
 */
export function resolveMotionBlur(value, { motion = 'natural', transparent = false } = {}) {
  const v = value == null || value === true ? '' : String(value).trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === 'none' || v === 'no' || v === '0') return { mode: 'off', samples: 1 };
  if (v === '' || v === 'auto' || v === 'on') {
    if (v === '' && motion === 'classic') return { mode: 'off', samples: 1 };
    return transparent ? { mode: 'off', samples: 1, why: 'transparent' } : { mode: 'auto', samples: 1 };
  }
  const n = parseInt(v, 10);
  if (!(n >= 1)) throw new Error(`Bad --motion-blur "${value}". Use auto, off, or a number of samples per frame (2-32).`);
  return n === 1 ? { mode: 'off', samples: 1 } : { mode: 'fixed', samples: Math.min(32, n) };
}

/** Resolve the HTML file and the folder that will be served. */
export function resolveInput(input) {
  let file = resolve(input || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = ['index.html', 'index.jsx', 'index.tsx'].map((n) => join(file, n)).find((f) => existsSync(f)) || join(file, 'index.html');
  if (!existsSync(file)) throw new Error(`Composition not found: ${file}`);
  // Serve from the nearest folder that looks like a project root (has package.json) or the file's folder.
  let root = dirname(file);
  let cur = root;
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(cur, 'package.json')) || existsSync(join(cur, 'givemotion.json'))) { root = cur; break; }
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return { file, root, rel: relative(root, file) };
}

function defaultWorkers(totalFrames) {
  const cores = cpus().length || 2;
  const memWorkers = Math.max(1, Math.floor(totalmem() / (700 * 1024 * 1024)));
  let w = Math.max(1, Math.min(cores, memWorkers, 16));
  // Short videos are not worth many browsers
  w = Math.min(w, Math.max(1, Math.floor(totalFrames / 24)));
  return w;
}

/**
 * Open a page for a composition (used by render, still, snapshot, check).
 */
export async function openComposition(input, opts = {}) {
  const { file, root, rel } = resolveInput(input);
  // No --data and the page has no data of its own: use data.json next to the HTML if there is one.
  if (opts.data == null && /\.html?$/i.test(file)) {
    const dj = join(dirname(file), 'data.json');
    if (existsSync(dj) && !/id=["']gm-data["']/i.test(readFileSync(file, 'utf8'))) { try { opts = { ...opts, data: JSON.parse(readFileSync(dj, 'utf8')) }; } catch (e) { throw new Error(`data.json next to the composition is not valid JSON: ${e.message}`); } }
  }
  const chrome = await ensureChrome({ chrome: opts.chrome, log: opts.log });
  const server = await startServer({ root, maxW: 3840, maxH: 2160, data: opts.data ?? null });
  const config = { mode: opts.mode || 'render', seed: opts.seed ?? 1, data: opts.data ?? null, fps: opts.fps, width: opts.width, height: opts.height };
  const url = server.url(rel);
  // First page discovers size; reopen at the right size if needed.
  const page = new FramePage({ chrome, width: opts.width || 1920, height: opts.height || 1080, scale: opts.scale || 1, capture: opts.capture, gl: opts.gl, transparent: opts.transparent, timeoutMs: opts.timeoutMs, verbose: opts.verbose, onConsole: opts.onConsole });
  let info;
  try {
    await page.start();
    info = await page.open(url, config);
    if (info.width !== page.opts.width || info.height !== page.opts.height) {
      page.opts.width = info.width; page.opts.height = info.height;
      await page.setViewport(info.width, info.height);
      info = await page.evaluate('gm.inspect()');
    }
  } catch (e) {
    // do not leave Chrome and the server running (the process would never exit)
    await page.close().catch(() => {});
    await server.close().catch(() => {});
    throw e;
  }
  return { page, info, server, chrome, url, config, file, root, rel };
}

async function newWorker(ctx, opts) {
  const page = new FramePage({ chrome: ctx.chrome, width: ctx.info.width, height: ctx.info.height, scale: opts.scale || 1, capture: ctx.page.mode, gl: opts.gl, transparent: opts.transparent, timeoutMs: opts.timeoutMs });
  await page.start();
  await page.open(ctx.url, ctx.config);
  return page;
}

async function prepareMedia(ctx, page) {
  const media = ctx.info.media || [];
  const durations = {};
  const audio = [];
  for (const m of media) {
    const file = join(ctx.root, decodeURIComponent(m.src.split('?')[0]));
    if (!existsSync(file)) throw new Error(`Media file not found: ${m.src}`);
    const p = probe(file);
    if (!p) throw new Error(`ffprobe could not read ${m.src}`);
    if (m.kind === 'video') durations[m.src] = p.duration;
    const wantsAudio = (m.kind === 'audio' || (m.kind === 'video' && !m.muted)) && p.hasAudio && (m.volume ?? 1) > 0;
    if (wantsAudio) audio.push({ file, start: m.start, end: m.end, from: m.from || 0, rate: m.rate || 1, loop: !!m.loop, volume: m.volume ?? 1, fadeIn: m.fadeIn || 0, fadeOut: m.fadeOut || 0, volumeKeys: m.volumeKeys || null, duck: m.duck ?? null });
  }
  applyDucking(audio);
  return { durations, audio };
}

// Piecewise-linear [t, v] helpers for volume curves
function evalKeys(keys, t) {
  if (!keys || !keys.length) return 1;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return b === a ? vb : va + ((t - a) / (b - a)) * (vb - va); }
  return keys[keys.length - 1][1];
}
/** Music with data-duck gets quieter while other sounds play (voice-over, video). */
function applyDucking(audio) {
  for (const a of audio) {
    if (a.duck == null) continue;
    const spans = audio.filter((o) => o !== a && o.duck == null).map((o) => [Math.max(o.start, a.start) - a.start, Math.min(o.end, a.end) - a.start]).filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const sp of spans) { const l = merged[merged.length - 1]; if (l && sp[0] <= l[1] + 0.6) l[1] = Math.max(l[1], sp[1]); else merged.push(sp.slice()); }
    if (!merged.length) continue;
    const down = 0.25, up = 0.45, lv = a.duck;
    const duckKeys = [[0, 1]];
    for (const [s, e] of merged) duckKeys.push([Math.max(0, s - down), 1], [Math.max(0, s), lv], [e, lv], [e + up, 1]);
    duckKeys.sort((x, y) => x[0] - y[0]);
    const pts = new Set([...duckKeys.map((k) => k[0]), ...(a.volumeKeys || []).map((k) => k[0])]);
    const ts = [...pts].sort((x, y) => x - y);
    const fine = [];
    ts.forEach((t, i) => { fine.push(t); if (i < ts.length - 1) fine.push((t + ts[i + 1]) / 2); });
    a.volumeKeys = fine.map((t) => [t, evalKeys(duckKeys, t) * evalKeys(a.volumeKeys, t)]);
  }
}

const AUDIO_FORMATS = { '.mp3': 'mp3', '.wav': 'wav', '.m4a': 'm4a', '.aac': 'm4a', '.ogg': 'ogg', '.opus': 'ogg', '.flac': 'flac' };

/**
 * Render a composition to a video file.
 * Returns a summary object.
 */
export async function render(input, opts = {}) {
  const t0 = Date.now();
  const log = opts.log || ((s) => process.stderr.write(s + '\n'));
  const out = resolve(opts.output || 'out.mp4');
  const format = formatFromOutput(out, opts.format);
  const info = format === 'png' ? null : requireFfmpeg();
  const q = qualitySettings(opts.quality);
  const transparent = !!opts.transparent;
  const captureFormat = format === 'png' || transparent || opts.quality === 'max' || opts.lossless ? 'png' : 'jpeg';
  // The GPU video encoder: on by default on a Mac (VideoToolbox) once it has shown it encodes reproducibly here.
  let hardware = format === 'png' ? false : wantsHardware({ hardware: opts.hardware, format, transparent, quality: opts.quality, codec: opts.codec, info });
  if (hardware === 'auto') hardware = encoderIsReproducible(encoderPlan({ format, quality: opts.quality, crf: opts.crf, codec: opts.codec, transparent, info, hardware: true }), info, { cacheFile: join(CACHE_DIR, 'hardware-encoders.json'), tmp: opts.tmpdir });
  const plan = format === 'png' ? null : encoderPlan({ format, quality: opts.quality, crf: opts.crf, codec: opts.codec, transparent, info, hardware });
  const shutter = opts.shutter ?? 0.5;

  if (AUDIO_FORMATS[extname(out).toLowerCase()] && !opts.format) return renderAudioOnly(input, out, AUDIO_FORMATS[extname(out).toLowerCase()], opts, log, t0);
  const ctx = await openComposition(input, { ...opts, mode: 'render', log });
  const cleanup = [];
  const tmp = mkdtempSync(join(opts.tmpdir || tmpdir(), 'gm-render-'));
  cleanup.push(() => rmSync(tmp, { recursive: true, force: true }));
  const pages = [ctx.page];
  try {
    const comp = ctx.info;
    const errors = comp.issues.filter((i) => i.severity === 'error');
    if (errors.length && !opts.force) {
      const e = new Error('The composition has errors:\n' + errors.map((i) => `  - [${i.code}] ${i.message}${i.selector ? ' (' + i.selector + ')' : ''}${i.fix ? '\n    fix: ' + i.fix : ''}`).join('\n') + '\nFix them or pass --force.');
      e.issues = comp.issues;
      throw e;
    }
    const fps = comp.fps;
    // motion blur: off, a fixed number of samples for every frame, or auto (the default in natural motion)
    const motion = await ctx.page.evaluate('gm.motion').catch(() => 'natural');
    const blur = resolveMotionBlur(opts.motionBlur, { motion, transparent });
    const blurSamples = blur.mode === 'fixed' ? blur.samples : 1;
    const blurStats = { blurred: 0, samples: 0, probeMs: 0, ref: Math.min(comp.width, comp.height) / 1080 };
    const totalFrames = Math.max(1, Math.round(comp.duration * fps));
    const [f0, f1] = parseRange(opts.frames, fps, totalFrames);
    const nFrames = f1 - f0;
    const media = format === 'png' ? { durations: {}, audio: [] } : await prepareMedia(ctx, ctx.page);
    if (opts.muted) media.audio = [];

    // Work list. Whole videos are cut into fixed parts (1-2 s) that are kept next to the output with a fingerprint
    // of what they depend on; the next render redoes only the parts that changed and joins all parts again.
    // A part is the same bytes whichever worker renders it, so a patched video equals a full render.
    // (--no-cache: same parts, in a temporary folder, so the bytes never depend on the worker count either)
    const useParts = format !== 'png' && !opts.frames;
    const keepParts = useParts && opts.cache !== false;
    let ranges, parts = null;
    if (useParts) {
      const segF = Math.max(1, Math.round((totalFrames / fps < 12 ? 1 : 2) * fps));
      const dir = keepParts ? join(dirname(out), '.gm-parts', basename(out)) : join(tmp, 'parts');
      const settings = hashOf(JSON.stringify({ v: 2, engine: engineHash(), format, plan, captureFormat, jpeg: q.jpeg, blurSamples, blur: blur.mode === 'auto' ? AUTO_BLUR : null, shutter, w: comp.width, h: comp.height, scale: opts.scale || 1, fps, seed: ctx.config.seed, data: ctx.config.data, transparent, segF }));
      const deps = await dependencyPrints(ctx);
      const old = keepParts ? readJson(join(dir, 'parts.json')) : null;
      const redo = opts.redo ? parseRange(opts.redo, fps, totalFrames) : null;
      const list = [];
      for (let a = 0, i = 0; a < totalFrames; a += segF, i++) {
        const b = Math.min(totalFrames, a + segF);
        const t0s = (a - 1) / fps, t1s = b / fps; // one frame of margin for motion blur
        // a clip's late elements count once they can show (with margin for the motion blur shutter)
        const tLate = (b + 1 + Math.max(1, shutter)) / fps;
        const used = deps.clips.filter((c) => c.end > t0s && c.start < t1s).map((c) => [c.fp, c.start, c.end, c.units.map((u, k) => (u.t < tLate ? [k, u.fp, u.t, u.end] : null)).filter(Boolean)]);
        const fp = hashOf(JSON.stringify([settings, deps.shared, a, b, used]));
        const file = join(dir, `part-${String(i).padStart(5, '0')}.${plan.segExt}`);
        const prev = old && old.settings === settings && old.parts[i];
        const keep = prev && prev.a === a && prev.b === b && prev.fp === fp && existsSync(file) && !(redo && a < redo[1] && b > redo[0]);
        list.push({ i, a, b, fp, file, keep });
      }
      const why = !old ? 'first render' : old.settings !== settings ? 'settings, data or engine changed' : old.shared !== deps.shared ? 'shared code, styles or files changed' : null;
      const same = (o, c) => o.fp === c.fp && o.start === c.start && o.end === c.end;
      const changedClips = old && old.settings === settings && old.shared === deps.shared ? deps.clips.flatMap((c) => {
        const o = (old.clips || []).find((x) => same(x, c));
        return !o ? [c.name] : c.units.filter((u, k) => { const x = o.units && o.units[k]; return !(x && x.fp === u.fp && x.t === u.t && x.end === u.end); }).map((u) => u.name);
      }) : [];
      parts = { dir, settings, deps, list, why, changedClips, redo };
      ranges = list.filter((p) => !p.keep).map((p) => ({ a: p.a, b: p.b, file: p.file }));
      mkdirSync(dir, { recursive: true });
    } else {
      ranges = [{ a: f0, b: f1, file: format === 'png' ? null : join(tmp, `seg.${plan.segExt}`) }];
    }
    const todoFrames = ranges.reduce((s, r) => s + r.b - r.a, 0);
    const workers = Math.max(1, Math.min(opts.workers || defaultWorkers(todoFrames), Math.max(1, todoFrames)));
    const auto = blur.mode === 'auto';
    // Auto blur: frames are not equally expensive, so workers take ranges from one queue (most work first) instead of
    // fixed runs; a single range (--frames, png) is cut into 1 s pieces for that. Every range starts with its own warm-up.
    if (auto && !useParts && todoFrames) {
      const { a: f0r, b: f1r, file } = ranges[0];
      ranges = [];
      for (let a = f0r, i = 0; a < f1r; a += fps, i++) ranges.push({ a, b: Math.min(f1r, a + fps), file: file ? join(tmp, `seg${String(i).padStart(4, '0')}.${plan.segExt}`) : null });
    }
    // Otherwise give each worker a run of neighbouring frames (fewer warm-ups, same balance as before).
    const groups = auto ? Array.from({ length: Math.min(workers, ranges.length) }, () => []) : splitRanges(ranges, workers, useParts ? 1 : 0, tmp, plan);
    const nWorkers = Math.max(1, groups.length);
    if (!opts.quiet) {
      log(`givemotion: ${comp.width}x${comp.height}${opts.scale > 1 ? ' @' + opts.scale + 'x' : ''} ${fps}fps ${(nFrames / fps).toFixed(2)}s (${nFrames} frames) → ${relativeOut(out)} [${format}, ${nWorkers} worker${nWorkers > 1 ? 's' : ''}, ${ctx.page.mode}${blurSamples > 1 ? ', motion blur x' + blurSamples : blur.mode === 'auto' ? ', motion blur auto' : ''}${hardware ? ', GPU encoder' : ''}]`);
      if (parts && parts.list.some((p) => p.keep)) {
        const kept = parts.list.filter((p) => p.keep).length;
        log(`  reusing ${kept} of ${parts.list.length} parts from the last render; redoing ${parts.list.length - kept}${parts.redo ? ' (--redo)' : ''}${parts.changedClips.length ? ' (changed: ' + parts.changedClips.slice(0, 4).join(', ') + (parts.changedClips.length > 4 ? ', …' : '') + ')' : ''}`);
      } else if (keepParts && parts.why && parts.why !== 'first render') log(`  redoing every part: ${parts.why}`);
    }

    if (process.env.GIVEMOTION_PROFILE) log(`  setup ${Date.now() - t0}ms`);
    const setDurations = Object.keys(media.durations).length ? `(() => { const d = ${JSON.stringify(media.durations)}; gm.__setVideoDurations && gm.__setVideoDurations(d); })()` : null;
    const reopen = async (page) => { await page.open(ctx.url, ctx.config); if (setDurations) await page.evaluate(setDurations); };
    // Start other workers in parallel
    const extra = todoFrames ? await Promise.all(Array.from({ length: nWorkers - 1 }, () => newWorker(ctx, opts))) : [];
    pages.push(...extra);
    if (setDurations) await Promise.all(pages.map((p) => p.evaluate(setDurations)));
    // Auto blur: how far things move at every frame to render (seeks and box reads, no captures; about 0.3 ms a frame
    // for a DOM page), measured in pieces spread over all pages
    const steps = new Map(); // f -> px moved on screen from frame f-1 to f
    if (auto && todoFrames) {
      const q0 = Date.now();
      const need = new Set();
      for (const r of ranges) for (let f = r.a - 1; f <= r.b; f++) need.add(f);
      const frames = [...need].sort((x, y) => x - y);
      const per = Math.max(30, Math.ceil(frames.length / pages.length));
      const pieces = [];
      for (let i = 0; i < frames.length;) {
        let j = i + 1;
        while (j < frames.length && frames[j] === frames[j - 1] + 1 && j - i < per) j++;
        pieces.push(frames.slice(i, j));
        // the next piece starts on this one's last frame (to measure the step into its first frame)
        i = j < frames.length && frames[j] === frames[j - 1] + 1 ? j - 1 : j;
      }
      await Promise.all(pages.map(async (page, k) => {
        for (let i = k; i < pieces.length; i += pages.length) {
          const run = pieces[i];
          const d = await page.evaluate(`(${motionProbe.toString()})(${JSON.stringify(run.map((f) => Math.max(0, f / fps)))}, ${shutter})`, { timeoutMs: Math.max(60000, run.length * 1000) });
          run.slice(1).forEach((f, n) => steps.set(f, d[n]));
        }
        // pages driven by requestAnimationFrame or timers cannot seek back: start them again
        if (await page.evaluate('gm.__stateful()')) await reopen(page);
      }));
      blurStats.probeMs = Date.now() - q0;
    }
    const framePlan = (f) => autoBlurPlan(Math.max(steps.get(f) || 0, steps.get(f + 1) || 0) / blurStats.ref, shutter);
    // A part with blur is cut into pieces (of 10 frames or more) (rendered by any worker, then joined into the part without
    // re-encoding), so one busy part does not keep everyone waiting. How a part is cut depends only on its own frames.
    const costOf = (a, b) => { let c = 1; for (let f = a; f < b; f++) { const pl = framePlan(f); c += pl ? pl.n : 1; } return c; };
    const queue = auto ? ranges.flatMap((r) => {
      const k = useParts ? Math.min(Math.max(1, Math.floor((r.b - r.a) / 10)), 1 + Math.floor((costOf(r.a, r.b) - 1 - (r.b - r.a)) / 12)) : 1; // one more piece per 12 extra samples
      if (k === 1) return [{ ...r, cost: costOf(r.a, r.b) }];
      const whole = { file: r.file, left: k, pieces: [] };
      return Array.from({ length: k }, (_, i) => {
        const a = r.a + Math.round((i * (r.b - r.a)) / k), b = r.a + Math.round(((i + 1) * (r.b - r.a)) / k);
        const file = join(tmp, `${basename(r.file)}.piece${i}.${plan.segExt}`);
        whole.pieces.push(file);
        return { a, b, file, whole, cost: costOf(a, b) };
      });
    }).sort((x, y) => y.cost - x.cost || x.a - y.a) : null;
    const joinPieces = async (whole) => {
      const list = join(tmp, basename(whole.file) + '.pieces.txt'), tmpWhole = whole.file + '.tmp.' + plan.segExt;
      writeFileSync(list, whole.pieces.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', tmpWhole]);
      renameSync(tmpWhole, whole.file);
      rmSync(list, { force: true });
      for (const f of whole.pieces) rmSync(f, { force: true });
    };

    let done = 0, reused = 0;
    let lastLog = 0;
    const progress = () => {
      const now = Date.now();
      if (now - lastLog < 1000 && done < todoFrames) return;
      lastLog = now;
      const el = (now - t0) / 1000;
      const rate = done / Math.max(0.001, el);
      const eta = rate > 0 ? (todoFrames - done) / rate : 0;
      if (opts.onProgress) opts.onProgress({ done, total: todoFrames, fps: rate, eta });
      else if (!opts.quiet) log(`  ${String(Math.round((done / Math.max(1, todoFrames)) * 100)).padStart(3)}%  ${done}/${todoFrames} frames  ${rate.toFixed(1)} fps  eta ${eta.toFixed(0)}s`);
    };

    if (format === 'png') mkdirSync(out.includes('%') ? dirname(out) : out, { recursive: true });
    const jpegQ = q.jpeg;
    await Promise.all(groups.map(async (group, wi) => {
      const page = pages[wi];
      let last = null, prevFrame = -2;
      const prof = { seek: 0, cap: 0, write: 0, end: 0 };
      // a finished part's encoder keeps working while the next part is captured (the encoder pipeline stays full)
      const ending = [], open = [];
      const framePath = (f) => (out.includes('%') ? out.replace(/%0?(\d*)d/, (m, n) => String(f).padStart(parseInt(n || '1', 10), '0')) : join(out, `frame-${String(f).padStart(6, '0')}.png`));
      // Auto motion blur for frames a..b-1: capture each frame once, or 2-4 times across the shutter when something moves
      // fast (framePlan, from the motion measured before), and average those samples (openBlender). Frames reach the
      // writer in order. The decision and the sample times depend only on the time, and every range starts the same way
      // (warm up on frame a-1), so any split between workers and any re-rendered part gives the same bytes.
      const captureAuto = async (a, b, writer) => {
        let q0 = Date.now();
        if (prevFrame >= a && (await page.evaluate('gm.__stateful()'))) await reopen(page);
        last = null;
        if (a > 0) { await page.seek((a - 1) / fps); await page.capture(captureFormat, jpegQ); }
        const blenders = new Map();
        let chain = Promise.resolve();
        const put = (f, img) => {
          chain = chain.then(() => img).then((buf) => (writer ? writer.write(buf) : writeFileSync(framePath(f), buf)));
          chain.catch(() => {});
        };
        try {
          for (let f = a; f < b; f++) {
            const pl = framePlan(f);
            const n = pl ? pl.n : 1;
            const bufs = [];
            for (let s = 0; s < n; s++) {
              const t = n > 1 ? (f + ((s + 0.5) / n - 0.5) * pl.shutter) / fps : f / fps;
              q0 = Date.now();
              const r = await page.seek(Math.max(0, t));
              prof.seek += Date.now() - q0; q0 = Date.now();
              if (r && r.needsReload) throw new Error('Internal: page needs reload during render.');
              let buf;
              if (!last || (r && r.dirty) || opts.noReuse) buf = await page.capture(captureFormat, jpegQ);
              else { buf = last; if (s === 0) reused++; }
              last = buf;
              bufs.push(buf);
              prof.cap += Date.now() - q0;
            }
            if (n > 1 && bufs.some((x) => x !== bufs[0])) {
              let bl = blenders.get(n);
              if (!bl) blenders.set(n, (bl = openBlender({ n, png: captureFormat === 'png', jpegQuality: jpegQ })));
              put(f, bl.push(bufs));
              blurStats.blurred++;
              blurStats.samples += n;
            } else put(f, bufs[0]);
            done++;
            progress();
          }
          q0 = Date.now();
          await Promise.all([...blenders.values()].map((bl) => bl.end()));
          await chain;
          prof.write += Date.now() - q0;
        } catch (e) {
          for (const bl of blenders.values()) bl.kill();
          throw e;
        }
      };
      const next = auto ? () => queue.shift() : ((i) => () => group[i++])(0);
      let frames = 0;
      try {
      for (let r; (r = next());) {
        const { a, b, file, whole } = r;
        frames += b - a;
        const tmpFile = file ? file + '.tmp.' + plan.segExt : null;
        const writer = file ? openSegmentWriter({ fps, inputCodec: captureFormat === 'png' ? 'png' : 'mjpeg', out: tmpFile, plan, motionBlur: blurSamples > 1 ? { samples: blurSamples } : null }) : null;
        try {
          if (blur.mode === 'auto') {
            await captureAuto(a, b, writer);
            prevFrame = b - 1;
          } else {
            // Warm up on the previous frame: Chrome's paint caches then match a single worker exactly.
            if (a !== prevFrame + 1) { last = null; if (a > 0) { await page.seek((a - 1) / fps); await page.capture(captureFormat, jpegQ); } }
            for (let f = a; f < b; f++) {
              for (let s = 0; s < blurSamples; s++) {
                const t = blurSamples > 1 ? (f + (s / (blurSamples - 1) - 0.5) * shutter) / fps : f / fps;
                let q0 = Date.now();
                const r = await page.seek(Math.max(0, t));
                prof.seek += Date.now() - q0; q0 = Date.now();
                if (r && r.needsReload) throw new Error('Internal: page needs reload during render.');
                let buf;
                if (!last || (r && r.dirty) || opts.noReuse) buf = await page.capture(captureFormat, jpegQ);
                else { buf = last; if (s === 0) reused++; }
                last = buf;
                prof.cap += Date.now() - q0; q0 = Date.now();
                if (writer) { await writer.write(buf); prof.write += Date.now() - q0; }
                else if (s === 0) writeFileSync(out.includes('%') ? out.replace(/%0?(\d*)d/, (m, n) => String(f).padStart(parseInt(n || '1', 10), '0')) : join(out, `frame-${String(f).padStart(6, '0')}.png`), buf);
              }
              prevFrame = f;
              done++;
              progress();
            }
          }
          if (writer) { open.push(writer); ending.push(writer.end().then(async () => { renameSync(tmpFile, file); open.splice(open.indexOf(writer), 1); if (whole && --whole.left === 0) await joinPieces(whole); })); }
          // do not let more than two parts queue up behind the encoder
          if (ending.length > 2) { const q1 = Date.now(); await ending[ending.length - 3]; prof.end += Date.now() - q1; }
        } catch (e) {
          if (writer) writer.kill();
          throw e;
        }
      }
      const q1 = Date.now();
      await Promise.all(ending);
      prof.end += Date.now() - q1;
      } catch (e) {
        for (const w of open) w.kill();
        await Promise.allSettled(ending);
        throw e;
      }
      if (process.env.GIVEMOTION_PROFILE) log(`  worker ${wi}: seek ${prof.seek}ms, capture ${prof.cap}ms, write ${prof.write}ms, encoder flush ${prof.end}ms for ${frames} frames`);
    }));
    const tLoop = Date.now();
    const pageErrors = pages.flatMap((p) => p.errors);
    await Promise.all(pages.map((p) => p.close()));
    pages.length = 0;
    if (format !== 'png') {
      mkdirSync(dirname(out), { recursive: true });
      const segments = parts ? parts.list.map((p) => p.file) : (auto ? ranges : groups.flat()).map((r) => r.file);
      await finalize({ segments, listFile: join(tmp, 'list.txt'), out, format, duration: nFrames / fps, audio: media.audio.map((a) => ({ ...a, start: a.start - f0 / fps, end: a.end - f0 / fps })).filter((a) => a.end > 0).map((a) => (a.start < 0 ? { ...a, from: a.from + -a.start * a.rate, start: 0 } : a)), fps, plan, transparent });
      if (parts && keepParts) {
        writeFileSync(join(parts.dir, 'parts.json'), JSON.stringify({ settings: parts.settings, shared: parts.deps.shared, clips: parts.deps.clips, parts: parts.list.map(({ a, b, fp }) => ({ a, b, fp })) }));
        // parts of an older, longer video
        for (const f of readdirSync(parts.dir)) if (/^part-\d+\./.test(f) && !parts.list.some((p) => basename(p.file) === f)) rmSync(join(parts.dir, f), { force: true });
      }
    }
    if (process.env.GIVEMOTION_PROFILE) log(`  finalize ${Date.now() - tLoop}ms, total ${Date.now() - t0}ms`);
    const elapsed = (Date.now() - t0) / 1000;
    const summary = {
      output: out, format, width: comp.width * (opts.scale || 1), height: comp.height * (opts.scale || 1), fps, frames: nFrames, duration: nFrames / fps,
      seconds: +elapsed.toFixed(2), renderFps: +(nFrames / elapsed).toFixed(1), reusedFrames: reused, workers: nWorkers, capture: ctx.page.mode, encoder: plan ? plan.vargs[plan.vargs.indexOf('-c:v') + 1] : 'png',
      motionBlur: blur.mode === 'auto' ? { mode: 'auto', frames: todoFrames, blurred: blurStats.blurred, samples: blurStats.samples, extraCaptures: blurStats.samples - blurStats.blurred, probeMs: blurStats.probeMs } : { mode: blur.mode, samples: blurSamples },
      parts: keepParts ? { total: parts.list.length, reused: parts.list.filter((p) => p.keep).length, rendered: parts.list.filter((p) => !p.keep).length, folder: parts.dir, late: parts.deps.clips.reduce((n, c) => n + c.units.length, 0), lateOff: parts.deps.fine } : null,
      bytes: format === 'png' ? null : statSync(out).size,
      warnings: comp.issues.filter((i) => i.severity !== 'error'),
      pageErrors: dedupe(pageErrors),
    };
    if (!opts.quiet && blur.mode === 'auto' && todoFrames) {
      const pc = (x) => Math.round((x / todoFrames) * 100);
      log(`  motion blur: ${blurStats.blurred} of ${todoFrames} frames (${pc(blurStats.blurred)}%) moved fast and got ${AUTO_BLUR.counts[0]}-${AUTO_BLUR.maxN} samples: +${blurStats.samples - blurStats.blurred} captures (+${pc(blurStats.samples - blurStats.blurred)}%), motion check ${(blurStats.probeMs / 1000).toFixed(1)}s (--motion-blur off to skip)`);
    }
    if (!opts.quiet) log(`done in ${elapsed.toFixed(1)}s (${summary.renderFps} fps, ${reused} static frames reused) → ${relativeOut(out)}`);
    return summary;
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
    await ctx.server.close();
    for (const c of cleanup) { try { c(); } catch {} }
  }
}

/**
 * Runs inside the page (it is turned into a string). Seeks to each time in `times` (seconds, increasing) and returns, for
 * every time after the first, how far anything visible moved on screen since the time before, in CSS px: the largest
 * displacement of a point of an element's box that is inside the viewport, under the move+scale that takes the box from
 * one time to the next (so a camera pan, a zoom, a card sliding in or out all count; an element growing off screen does
 * not). Not motion: elements at opacity 0 or visibility hidden, and boxes that only moved because text or children
 * changed in that step (typing, counters, a caret: their layout box moved, not a transform). A seek the runtime reports
 * as not dirty changed nothing and costs no layout read. Every value is a function of the two times only.
 */
export async function motionProbe(times, shutter = 0.5) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'BR', 'HEAD']);
  const W = innerWidth, H = innerHeight;
  const all = document.getElementsByTagName('*');
  // the layout box (no transforms) of the nearest HTML element, in page coordinates
  const layoutOf = (el, memo) => {
    let h = el;
    while (h && !('offsetLeft' in h)) h = h.parentElement;
    if (!h) return null;
    let v = memo.get(h);
    if (v) return v;
    const p = h.offsetParent, pv = p ? layoutOf(p, memo) : null;
    v = [h.offsetLeft + (pv ? pv[0] : 0), h.offsetTop + (pv ? pv[1] : 0), h.offsetWidth, h.offsetHeight];
    memo.set(h, v);
    return v;
  };
  const snap = () => {
    const rects = new Map(), lay = new Map(), memo = new Map();
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (SKIP.has(el.tagName) || el === document.documentElement || el === document.body) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { rects.set(el, r); lay.set(el, layoutOf(el, memo)); }
    }
    return { rects, lay };
  };
  // largest |x' - x| over the visible part of a 1-D interval mapped from [a0,a1] (before) to [b0,b1] (after)
  const along = (a0, a1, b0, b1, size) => {
    const s = (b1 - b0) / (a1 - a0);
    let best = 0;
    const lo = Math.max(a0, 0), hi = Math.min(a1, size);
    if (hi >= lo) for (const x of [lo, hi]) best = Math.max(best, Math.abs(b0 + (x - a0) * s - x));
    const lo2 = Math.max(b0, 0), hi2 = Math.min(b1, size);
    if (hi2 >= lo2) for (const x of [lo2, hi2]) best = Math.max(best, Math.abs(x - (a0 + (x - b0) / s)));
    return best;
  };
  const seen = (r) => r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
  const same = (p, q) => p === q || (!!p && !!q && p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3]);
  const compare = (prev, cur, reflow) => {
    const moved = [];
    for (const [el, b] of cur.rects) {
      const a = prev.rects.get(el);
      if (!a || (a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)) continue;
      if (!seen(a) && !seen(b)) continue;
      if (reflow && !same(prev.lay.get(el), cur.lay.get(el))) continue;
      const d = Math.hypot(along(a.left, a.right, b.left, b.right, W), along(a.top, a.bottom, b.top, b.bottom, H));
      if (d > 0.5) moved.push([d, el]);
    }
    moved.sort((x, y) => y[0] - x[0]);
    for (const [d, el] of moved) if (shows(el, d)) return Math.round(d * 100) / 100;
    return 0;
  };
  // does motion of d px on this element show? Not when it is (nearly) transparent or already as soft as the blur would
  // make it (a CSS blur on it or around it)
  const shows = (el, d) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    let alpha = 1, soft = 0;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      alpha *= parseFloat(cs.opacity);
      if (cs.filter && cs.filter !== 'none') for (const m of cs.filter.matchAll(/blur\(([\d.]+)px\)/g)) soft += parseFloat(m[1]);
    }
    return alpha >= 0.2 && soft < (d * shutter) / 4;
  };
  const mo = new MutationObserver(() => {});
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const out = [];
  let prev = null;
  try {
    for (let k = 0; k < times.length; k++) {
      let r = gm.seek(times[k]);
      if (r && r.then) r = await r;
      const reflow = mo.takeRecords().length > 0;
      if (k === 0) { prev = snap(); continue; }
      if (!r || !r.dirty) { out.push(0); continue; }
      const cur = snap();
      out.push(compare(prev, cur, reflow));
      prev = cur;
    }
  } finally { mo.disconnect(); }
  return out;
}

const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 20);
function readJson(f) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } }
let engineFp = null;
/** Fingerprint of the engine's own code: a new version redoes every part. */
function engineHash() {
  if (engineFp) return engineFp;
  const h = createHash('sha1');
  const walk = (d) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|css)$/.test(e)) h.update(e).update(readFileSync(p)); } };
  walk(dirname(fileURLToPath(import.meta.url)));
  return (engineFp = h.digest('hex').slice(0, 20));
}

/**
 * Split the work between workers. Whole parts (useParts) are grouped into runs of neighbours with about the same number
 * of frames; a single range (--frames, png) is cut into one chunk per worker, as before.
 */
function splitRanges(ranges, workers, useParts, tmp, plan) {
  const total = ranges.reduce((s, r) => s + r.b - r.a, 0);
  if (!total) return [];
  if (!useParts) {
    const { a: f0, b: f1, file } = ranges[0];
    const per = Math.ceil(total / workers), out = [];
    for (let i = 0; i < workers; i++) {
      const a = f0 + i * per, b = Math.min(f1, a + per);
      if (a < b) out.push([{ a, b, file: file ? join(tmp, `seg${String(i).padStart(3, '0')}.${plan.segExt}`) : null }]);
    }
    return out;
  }
  const groups = [];
  let cur = [], n = 0, left = total, wLeft = workers;
  for (const r of ranges) {
    cur.push(r); n += r.b - r.a;
    if (wLeft > 1 && n >= left / wLeft - 1e-9) { groups.push(cur); left -= n; wLeft--; cur = []; n = 0; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/**
 * What each part of the video depends on: a shared print (the page around the scenes, every script, style and loaded
 * file) and one print per top-level clip, with the clip's late elements (src/parts.js) and the time each can first show.
 */
async function dependencyPrints(ctx) {
  const r = await ctx.page.evaluate(`(${pagePrints.toString()})()`);
  // files the page loaded (stylesheets, scripts, images, fonts, data, video frames, audio), by content
  const files = new Set();
  const origin = new URL(ctx.url).origin;
  for (const u of [...r.resources, ...(ctx.info.media || []).map((m) => new URL(m.src, ctx.url).href)]) {
    let url;
    try { url = new URL(u); } catch { continue; }
    if (url.origin !== origin) { files.add('remote:' + u); continue; }
    let p = decodeURIComponent(url.pathname);
    if (p.startsWith('/__gm/')) { const s2 = url.searchParams.get('src'); if (!s2) continue; p = decodeURIComponent(new URL(s2, url).pathname); }
    files.add(p);
  }
  const fileHash = [...files].sort().map((p) => {
    if (p.startsWith('remote:')) return p;
    const f = join(ctx.root, p);
    try { const st = statSync(f); return p + ':' + (st.size > 64 * 1024 * 1024 ? st.size + '-' + st.mtimeMs : hashOf(readFileSync(f))); } catch { return p + ':missing'; }
  });
  const units = (c) => c.units.map((u) => ({ fp: hashOf(u.print), t: +u.t.toFixed(6), end: u.end == null ? null : +u.end.toFixed(6), name: u.name }));
  return { shared: hashOf(r.shared + '\n' + fileHash.join('\n')), clips: r.clips.map((c) => ({ fp: hashOf(c.print), start: +c.start.toFixed(6), end: +c.end.toFixed(6), name: c.name, units: units(c) })), fine: r.fine };
}

/** Only the soundtrack: `render comp.html -o sound.mp3` (also .wav .m4a .ogg .flac) */
async function renderAudioOnly(input, out, fmt, opts, log, t0) {
  requireFfmpeg();
  const ctx = await openComposition(input, { ...opts, mode: 'render', log });
  try {
    const media = await prepareMedia(ctx, ctx.page);
    if (!media.audio.length) throw new Error('This composition has no audio to export.');
    mkdirSync(dirname(out), { recursive: true });
    await mixAudio({ audio: media.audio, out, format: fmt, duration: ctx.info.duration });
    const elapsed = (Date.now() - t0) / 1000;
    if (!opts.quiet) log(`done in ${elapsed.toFixed(1)}s → ${relativeOut(out)}`);
    return { output: out, format: fmt, duration: ctx.info.duration, seconds: +elapsed.toFixed(2), bytes: statSync(out).size, warnings: ctx.info.issues.filter((i) => i.severity !== 'error'), pageErrors: [] };
  } finally {
    await ctx.page.close();
    await ctx.server.close();
  }
}

function dedupe(errs) {
  const seen = new Set();
  return errs.filter((e) => { const k = e.code + e.message; if (seen.has(k)) return false; seen.add(k); return true; });
}
function relativeOut(p) {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? r : p;
}

/** Render single frames to image files. times: seconds[] */
export async function stills(input, times, opts = {}) {
  const ctx = await openComposition(input, { ...opts, mode: 'render' });
  try {
    const out = [];
    for (const t of times) {
      await ctx.page.seek(Math.min(t, Math.max(0, ctx.info.duration - 1 / ctx.info.fps)));
      out.push(await ctx.page.capture(opts.format || 'png', 95));
    }
    return { buffers: out, info: ctx.info, errors: ctx.page.errors };
  } finally {
    await ctx.page.close();
    await ctx.server.close();
  }
}
