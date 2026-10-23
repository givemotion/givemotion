// Render orchestration: open the composition, split frames across workers, encode, mux audio.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { cpus, tmpdir, totalmem, freemem } from 'node:os';
import { ensureChrome, FramePage } from './browser.js';
import { startServer } from './server.js';
import { requireFfmpeg, encoderPlan, openSegmentWriter, finalize, probe, qualitySettings } from './ffmpeg.js';

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
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
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
  const chrome = await ensureChrome({ chrome: opts.chrome, log: opts.log });
  const server = await startServer({ root, maxW: 3840, maxH: 2160 });
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
    if (wantsAudio) audio.push({ file, start: m.start, end: m.end, from: m.from || 0, rate: m.rate || 1, loop: !!m.loop, volume: m.volume ?? 1, fadeIn: m.fadeIn || 0, fadeOut: m.fadeOut || 0 });
  }
  return { durations, audio };
}

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
    const workers = Math.max(1, Math.min(opts.workers || defaultWorkers(nFrames), nFrames));
    log(`motionwright: ${comp.width}x${comp.height}${opts.scale > 1 ? ' @' + opts.scale + 'x' : ''} ${fps}fps ${(nFrames / fps).toFixed(2)}s (${nFrames} frames) → ${relativeOut(out)} [${format}, ${workers} worker${workers > 1 ? 's' : ''}, ${ctx.page.mode}${blurSamples > 1 ? ', motion blur x' + blurSamples : ''}]`);

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
      try {
        for (let f = a; f < b; f++) {
          for (let s = 0; s < blurSamples; s++) {
            const t = blurSamples > 1 ? (f + (s / (blurSamples - 1) - 0.5) * shutter) / fps : f / fps;
            const r = await page.seek(Math.max(0, t));
            if (r && r.needsReload) throw new Error('Internal: page needs reload during render.');
            let buf;
            if (!last || (r && r.dirty) || opts.noReuse) buf = await page.capture(captureFormat, jpegQ);
            else { buf = last; if (s === 0) reused++; }
            last = buf;
            if (writer) await writer.write(buf);
            else if (s === 0) writeFileSync(out.includes('%') ? out.replace(/%0?(\d*)d/, (m, n) => String(f).padStart(parseInt(n || '1', 10), '0')) : join(out, `frame-${String(f).padStart(6, '0')}.png`), buf);
          }
          done++;
          progress();
        }
        if (writer) await writer.end();
      } catch (e) {
        if (writer) writer.kill();
        throw e;
      }
    }));
    const pageErrors = pages.flatMap((p) => p.errors);
    await Promise.all(pages.map((p) => p.close()));
    pages.length = 0;
    if (format !== 'png') {
      mkdirSync(dirname(out), { recursive: true });
      await finalize({ segments, listFile: join(tmp, 'list.txt'), out, format, duration: nFrames / fps, audio: media.audio.map((a) => ({ ...a, start: a.start - f0 / fps, end: a.end - f0 / fps })).filter((a) => a.end > 0).map((a) => (a.start < 0 ? { ...a, from: a.from + -a.start * a.rate, start: 0 } : a)), fps, plan, transparent });
    }
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
