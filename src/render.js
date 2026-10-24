// Render orchestration: open the composition, split frames across workers, encode, mux audio.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname, basename, extname, relative, isAbsolute } from 'node:path';
import { cpus, tmpdir, totalmem, freemem } from 'node:os';
import { ensureChrome, FramePage } from './browser.js';
import { startServer } from './server.js';
import { requireFfmpeg, encoderPlan, openSegmentWriter, finalize, mixAudio, probe, qualitySettings } from './ffmpeg.js';
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
  let info;
  try {
    await page.start();
    info = await page.open(url, config);
    if (info.width !== page.opts.width || info.height !== page.opts.height) {
      page.opts.width = info.width; page.opts.height = info.height;
      await page.setViewport(info.width, info.height);
      info = await page.evaluate('mw.inspect()');
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

    // Work list. Whole videos are cut into fixed parts (1-2 s) that are kept next to the output with a fingerprint
    // of what they depend on; the next render redoes only the parts that changed and joins all parts again.
    // A part is the same bytes whichever worker renders it, so a patched video equals a full render.
    // (--no-cache: same parts, in a temporary folder, so the bytes never depend on the worker count either)
    const useParts = format !== 'png' && !opts.frames;
    const keepParts = useParts && opts.cache !== false;
    let ranges, parts = null;
    if (useParts) {
      const segF = Math.max(1, Math.round((totalFrames / fps < 12 ? 1 : 2) * fps));
      const dir = keepParts ? join(dirname(out), '.mw-parts', basename(out)) : join(tmp, 'parts');
      const settings = hashOf(JSON.stringify({ v: 2, engine: engineHash(), format, plan, captureFormat, jpeg: q.jpeg, blurSamples, shutter, w: comp.width, h: comp.height, scale: opts.scale || 1, fps, seed: ctx.config.seed, data: ctx.config.data, transparent, segF }));
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
    // Give each worker a run of neighbouring frames (fewer warm-ups, same balance as before).
    const groups = splitRanges(ranges, workers, useParts ? 1 : 0, tmp, plan);
    const nWorkers = Math.max(1, groups.length);
    if (!opts.quiet) {
      log(`motionwright: ${comp.width}x${comp.height}${opts.scale > 1 ? ' @' + opts.scale + 'x' : ''} ${fps}fps ${(nFrames / fps).toFixed(2)}s (${nFrames} frames) → ${relativeOut(out)} [${format}, ${nWorkers} worker${nWorkers > 1 ? 's' : ''}, ${ctx.page.mode}${blurSamples > 1 ? ', motion blur x' + blurSamples : ''}]`);
      if (parts && parts.list.some((p) => p.keep)) {
        const kept = parts.list.filter((p) => p.keep).length;
        log(`  reusing ${kept} of ${parts.list.length} parts from the last render; redoing ${parts.list.length - kept}${parts.redo ? ' (--redo)' : ''}${parts.changedClips.length ? ' (changed: ' + parts.changedClips.slice(0, 4).join(', ') + (parts.changedClips.length > 4 ? ', …' : '') + ')' : ''}`);
      } else if (keepParts && parts.why && parts.why !== 'first render') log(`  redoing every part: ${parts.why}`);
    }

    if (process.env.MOTIONWRIGHT_PROFILE) log(`  setup ${Date.now() - t0}ms`);
    // Start other workers in parallel
    const extra = todoFrames ? await Promise.all(Array.from({ length: nWorkers - 1 }, () => newWorker(ctx, opts))) : [];
    pages.push(...extra);
    if (Object.keys(media.durations).length) {
      await Promise.all(pages.map((p) => p.evaluate(`(() => { const d = ${JSON.stringify(media.durations)}; mw.__setVideoDurations && mw.__setVideoDurations(d); })()`)));
    }

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
      try {
      for (const { a, b, file } of group) {
        const tmpFile = file ? file + '.tmp.' + plan.segExt : null;
        const writer = file ? openSegmentWriter({ fps, inputCodec: captureFormat === 'png' ? 'png' : 'mjpeg', out: tmpFile, plan, motionBlur: blurSamples > 1 ? { samples: blurSamples } : null }) : null;
        try {
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
          if (writer) { open.push(writer); ending.push(writer.end().then(() => { renameSync(tmpFile, file); open.splice(open.indexOf(writer), 1); })); }
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
      if (process.env.MOTIONWRIGHT_PROFILE) log(`  worker ${wi}: seek ${prof.seek}ms, capture ${prof.cap}ms, write ${prof.write}ms, encoder flush ${prof.end}ms for ${group.reduce((s, g) => s + g.b - g.a, 0)} frames`);
    }));
    const tLoop = Date.now();
    const pageErrors = pages.flatMap((p) => p.errors);
    await Promise.all(pages.map((p) => p.close()));
    pages.length = 0;
    if (format !== 'png') {
      mkdirSync(dirname(out), { recursive: true });
      const segments = parts ? parts.list.map((p) => p.file) : groups.flat().map((r) => r.file);
      await finalize({ segments, listFile: join(tmp, 'list.txt'), out, format, duration: nFrames / fps, audio: media.audio.map((a) => ({ ...a, start: a.start - f0 / fps, end: a.end - f0 / fps })).filter((a) => a.end > 0).map((a) => (a.start < 0 ? { ...a, from: a.from + -a.start * a.rate, start: 0 } : a)), fps, plan, transparent });
      if (parts && keepParts) {
        writeFileSync(join(parts.dir, 'parts.json'), JSON.stringify({ settings: parts.settings, shared: parts.deps.shared, clips: parts.deps.clips, parts: parts.list.map(({ a, b, fp }) => ({ a, b, fp })) }));
        // parts of an older, longer video
        for (const f of readdirSync(parts.dir)) if (/^part-\d+\./.test(f) && !parts.list.some((p) => basename(p.file) === f)) rmSync(join(parts.dir, f), { force: true });
      }
    }
    if (process.env.MOTIONWRIGHT_PROFILE) log(`  finalize ${Date.now() - tLoop}ms, total ${Date.now() - t0}ms`);
    const elapsed = (Date.now() - t0) / 1000;
    const summary = {
      output: out, format, width: comp.width * (opts.scale || 1), height: comp.height * (opts.scale || 1), fps, frames: nFrames, duration: nFrames / fps,
      seconds: +elapsed.toFixed(2), renderFps: +(nFrames / elapsed).toFixed(1), reusedFrames: reused, workers: nWorkers, capture: ctx.page.mode,
      parts: keepParts ? { total: parts.list.length, reused: parts.list.filter((p) => p.keep).length, rendered: parts.list.filter((p) => !p.keep).length, folder: parts.dir, late: parts.deps.clips.reduce((n, c) => n + c.units.length, 0), lateOff: parts.deps.fine } : null,
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
    if (p.startsWith('/__mw/')) { const s2 = url.searchParams.get('src'); if (!s2) continue; p = decodeURIComponent(new URL(s2, url).pathname); }
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
