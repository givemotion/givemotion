// Render orchestration: open the composition, split frames across workers, encode, mux audio.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { cpus, tmpdir, totalmem, freemem } from 'node:os';
import { ensureChrome, FramePage } from './browser.js';
import { startServer } from './server.js';
import { requireFfmpeg, encoderPlan, openSegmentWriter, finalize, mixAudio, probe, qualitySettings } from './ffmpeg.js';

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

/** Resolve the HTML file and the folder that will be served. */
export function resolveInput(input) {
  let file = resolve(input || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = ['index.html', 'index.jsx', 'index.tsx'].map((n) => join(file, n)).find((f) => existsSync(f)) || join(file, 'index.html');
  if (!existsSync(file)) throw new Error(`Composition not found: ${file}`);
  // Serve from the nearest folder that looks like a project root (has package.json) or the file's folder.
  let root = dirname(file);
  let cur = root;
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(cur, 'package.json')) || existsSync(join(cur, 'motionwright.json'))) { root = cur; break; }
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
    if (existsSync(dj) && !/id=["']mw-data["']/i.test(readFileSync(file, 'utf8'))) { try { opts = { ...opts, data: JSON.parse(readFileSync(dj, 'utf8')) }; } catch (e) { throw new Error(`data.json next to the composition is not valid JSON: ${e.message}`); } }
  }
  const chrome = await ensureChrome({ chrome: opts.chrome, log: opts.log });
  const server = await startServer({ root, maxW: 3840, maxH: 2160, data: opts.data ?? null });
  const config = { mode: opts.mode || 'render', seed: opts.seed ?? 1, data: opts.data ?? null, fps: opts.fps, width: opts.width, height: opts.height };
  const url = server.url(rel);
  // First page discovers size; reopen at the right size if needed.
  const page = new FramePage({ chrome, width: opts.width || 1920, height: opts.height || 1080, scale: opts.scale || 1, capture: opts.capture, gl: opts.gl, transparent: opts.transparent, timeoutMs: opts.timeoutMs, verbose: opts.verbose, onConsole: opts.onConsole });
  await page.start();
  let info = await page.open(url, config);
  if (info.width !== page.opts.width || info.height !== page.opts.height) {
    page.opts.width = info.width; page.opts.height = info.height;
    await page.setViewport(info.width, info.height);
    info = await page.evaluate('mw.inspect()');
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
  const plan = format === 'png' ? null : encoderPlan({ format, quality: opts.quality, crf: opts.crf, codec: opts.codec, transparent, info, hardware: opts.hardware });
  const blurSamples = opts.motionBlur ? Math.max(2, Math.min(32, parseInt(opts.motionBlur, 10) || 8)) : 1;
  const shutter = opts.shutter ?? 0.5;

  if (AUDIO_FORMATS[extname(out).toLowerCase()] && !opts.format) return renderAudioOnly(input, out, AUDIO_FORMATS[extname(out).toLowerCase()], opts, log, t0);
  const ctx = await openComposition(input, { ...opts, mode: 'render', log });
  const cleanup = [];
  const tmp = mkdtempSync(join(opts.tmpdir || tmpdir(), 'mw-render-'));
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
    const totalFrames = Math.max(1, Math.round(comp.duration * fps));
    const [f0, f1] = parseRange(opts.frames, fps, totalFrames);
    const nFrames = f1 - f0;
    const media = format === 'png' ? { durations: {}, audio: [] } : await prepareMedia(ctx, ctx.page);
    if (opts.muted) media.audio = [];
    const workers = Math.max(1, Math.min(opts.workers || defaultWorkers(nFrames), nFrames));
    if (!opts.quiet) log(`motionwright: ${comp.width}x${comp.height}${opts.scale > 1 ? ' @' + opts.scale + 'x' : ''} ${fps}fps ${(nFrames / fps).toFixed(2)}s (${nFrames} frames) → ${relativeOut(out)} [${format}, ${workers} worker${workers > 1 ? 's' : ''}, ${ctx.page.mode}${blurSamples > 1 ? ', motion blur x' + blurSamples : ''}]`);

    if (process.env.MOTIONWRIGHT_PROFILE) log(`  setup ${Date.now() - t0}ms`);
    // Start other workers in parallel
    const extra = await Promise.all(Array.from({ length: workers - 1 }, () => newWorker(ctx, opts)));
    pages.push(...extra);
    if (Object.keys(media.durations).length) {
      await Promise.all(pages.map((p) => p.evaluate(`(() => { const d = ${JSON.stringify(media.durations)}; mw.__setVideoDurations && mw.__setVideoDurations(d); })()`)));
    }

    // Split frames into contiguous chunks
    const chunks = [];
    const per = Math.ceil(nFrames / workers);
    for (let i = 0; i < workers; i++) {
      const a = f0 + i * per, b = Math.min(f1, a + per);
      if (a < b) chunks.push([a, b]);
    }
    let done = 0, reused = 0;
    let lastLog = 0;
    const progress = () => {
      const now = Date.now();
      if (now - lastLog < 1000 && done < nFrames) return;
      lastLog = now;
      const el = (now - t0) / 1000;
      const rate = done / Math.max(0.001, el);
      const eta = rate > 0 ? (nFrames - done) / rate : 0;
      if (opts.onProgress) opts.onProgress({ done, total: nFrames, fps: rate, eta });
      else if (!opts.quiet) log(`  ${String(Math.round((done / nFrames) * 100)).padStart(3)}%  ${done}/${nFrames} frames  ${rate.toFixed(1)} fps  eta ${eta.toFixed(0)}s`);
    };

    if (format === 'png') mkdirSync(out.includes('%') ? dirname(out) : out, { recursive: true });
    const segments = [];
    const jpegQ = q.jpeg;
    await Promise.all(chunks.map(async ([a, b], wi) => {
      const page = pages[wi];
      const seg = format === 'png' ? null : join(tmp, `seg${String(wi).padStart(3, '0')}.${plan.segExt}`);
      if (seg) segments[wi] = seg;
      const writer = seg ? openSegmentWriter({ fps, inputCodec: captureFormat === 'png' ? 'png' : 'mjpeg', out: seg, plan, motionBlur: blurSamples > 1 ? { samples: blurSamples } : null }) : null;
      let last = null;
      const prof = { seek: 0, cap: 0, write: 0, end: 0 };
      try {
        // Warm up on the previous frame: Chrome's paint caches then match a single worker exactly.
        if (a > 0) { await page.seek((a - 1) / fps); await page.capture(captureFormat, jpegQ); }
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
          done++;
          progress();
        }
        const q1 = Date.now();
        if (writer) await writer.end();
        prof.end = Date.now() - q1;
        if (process.env.MOTIONWRIGHT_PROFILE) log(`  worker ${wi}: seek ${prof.seek}ms, capture ${prof.cap}ms, write ${prof.write}ms, encoder flush ${prof.end}ms for ${b - a} frames`);
      } catch (e) {
        if (writer) writer.kill();
        throw e;
      }
    }));
    const tLoop = Date.now();
    const pageErrors = pages.flatMap((p) => p.errors);
    await Promise.all(pages.map((p) => p.close()));
    pages.length = 0;
    if (format !== 'png') {
      mkdirSync(dirname(out), { recursive: true });
      await finalize({ segments, listFile: join(tmp, 'list.txt'), out, format, duration: nFrames / fps, audio: media.audio.map((a) => ({ ...a, start: a.start - f0 / fps, end: a.end - f0 / fps })).filter((a) => a.end > 0).map((a) => (a.start < 0 ? { ...a, from: a.from + -a.start * a.rate, start: 0 } : a)), fps, plan, transparent });
    }
    if (process.env.MOTIONWRIGHT_PROFILE) log(`  finalize ${Date.now() - tLoop}ms, total ${Date.now() - t0}ms`);
    const elapsed = (Date.now() - t0) / 1000;
    const summary = {
      output: out, format, width: comp.width * (opts.scale || 1), height: comp.height * (opts.scale || 1), fps, frames: nFrames, duration: nFrames / fps,
      seconds: +elapsed.toFixed(2), renderFps: +(nFrames / elapsed).toFixed(1), reusedFrames: reused, workers: chunks.length, capture: ctx.page.mode,
      bytes: format === 'png' ? null : statSync(out).size,
      warnings: comp.issues.filter((i) => i.severity !== 'error'),
      pageErrors: dedupe(pageErrors),
    };
    if (!opts.quiet) log(`done in ${elapsed.toFixed(1)}s (${summary.renderFps} fps, ${reused} static frames reused) → ${relativeOut(out)}`);
    return summary;
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
    await ctx.server.close();
    for (const c of cleanup) { try { c(); } catch {} }
  }
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
