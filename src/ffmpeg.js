// FFmpeg helpers: detection, encoder settings, segment writers, concat and audio mixing.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let cachedPath = null;
export function ffmpegPath() {
  if (cachedPath) return cachedPath;
  cachedPath = process.env.MOTIONWRIGHT_FFMPEG || process.env.FFMPEG_PATH || 'ffmpeg';
  return cachedPath;
}
export function ffprobePath() {
  if (process.env.MOTIONWRIGHT_FFPROBE || process.env.FFPROBE_PATH) return process.env.MOTIONWRIGHT_FFPROBE || process.env.FFPROBE_PATH;
  const f = ffmpegPath();
  return f === 'ffmpeg' ? 'ffprobe' : f.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
}

export function ffmpegInfo() {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const version = (r.stdout.split('\n')[0] || '').replace(/^ffmpeg version\s*/, '').split(' ')[0];
  const enc = spawnSync(ffmpegPath(), ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
  const has = (n) => new RegExp(`\\s${n}\\s`).test(enc);
  return {
    version,
    encoders: {
      libx264: has('libx264'), libx265: has('libx265'), h264_videotoolbox: has('h264_videotoolbox'), hevc_videotoolbox: has('hevc_videotoolbox'),
      h264_nvenc: has('h264_nvenc'), libvpx_vp9: has('libvpx-vp9'), prores_ks: has('prores_ks'), libopus: has('libopus'), aac: has('aac'), libsvtav1: has('libsvtav1'),
    },
  };
}

export function requireFfmpeg() {
  const info = ffmpegInfo();
  if (!info) throw new Error('ffmpeg was not found. Install it (macOS: `brew install ffmpeg`, Ubuntu: `sudo apt install ffmpeg`, Windows: `winget install ffmpeg`) or set MOTIONWRIGHT_FFMPEG to its path.');
  return info;
}

export function probe(file) {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const v = j.streams.find((s) => s.codec_type === 'video');
    return {
      duration: parseFloat(j.format.duration) || (v && parseFloat(v.duration)) || 0,
      hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
      hasVideo: !!v,
      width: v ? v.width : 0, height: v ? v.height : 0,
    };
  } catch { return null; }
}

const QUALITY = {
  draft: { crf: 28, preset: 'ultrafast', vp9crf: 40, jpeg: 80 },
  standard: { crf: 18, preset: 'veryfast', vp9crf: 31, jpeg: 92 },
  high: { crf: 14, preset: 'medium', vp9crf: 24, jpeg: 97 },
  max: { crf: 10, preset: 'slow', vp9crf: 15, jpeg: 100 },
};
export function qualitySettings(q = 'standard') { return QUALITY[q] || QUALITY.standard; }

/**
 * Describe how frames are encoded for a given output format.
 * Returns { segExt, finalExt, vargs(fpsOut) , alpha, needsFinalTranscode }
 */
export function encoderPlan({ format, quality = 'standard', crf, codec, transparent, info, hardware }) {
  const q = qualitySettings(quality);
  const colorTags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  // Frames arrive as sRGB images. Convert through RGB to BT.709 limited range (what players expect).
  // The accurate swscale flags cost ~3x encode time, so only the high/max presets use them.
  const precise = quality === 'high' || quality === 'max' ? ':flags=accurate_rnd+full_chroma_int' : '';
  const toYuv = (pix) => ['-vf', `format=rgb24,scale=out_color_matrix=bt709:out_range=tv${precise},format=${pix}`];
  if (format === 'mp4' || format === 'mkv') {
    if (transparent) throw new Error('MP4 cannot hold transparency. Use --format mov (ProRes 4444) or --format webm (VP9 alpha).');
    const c = codec || 'h264';
    if (c === 'h265' || c === 'hevc') {
      if (hardware && info.encoders.hevc_videotoolbox) return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'hevc_videotoolbox', '-q:v', String(Math.max(40, 80 - (crf ?? q.crf))), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', ...colorTags] };
      if (!info.encoders.libx265) throw new Error('Your ffmpeg has no libx265 encoder. Use --codec h264.');
      return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'libx265', '-preset', q.preset, '-crf', String((crf ?? q.crf) + 4), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', ...colorTags] };
    }
    if (c === 'av1') {
      if (!info.encoders.libsvtav1) throw new Error('Your ffmpeg has no libsvtav1 encoder.');
      return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'libsvtav1', '-preset', '8', '-crf', String((crf ?? q.crf) + 12), '-pix_fmt', 'yuv420p', ...colorTags] };
    }
    if (hardware && info.encoders.h264_videotoolbox) return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'h264_videotoolbox', '-q:v', String(Math.max(40, 85 - (crf ?? q.crf))), '-pix_fmt', 'yuv420p', ...colorTags] };
    if (hardware && info.encoders.h264_nvenc) return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', String(crf ?? q.crf + 2), '-pix_fmt', 'yuv420p', ...colorTags] };
    if (!info.encoders.libx264) throw new Error('Your ffmpeg has no libx264 encoder. Install a full ffmpeg build.');
    return { segExt: format, vf: toYuv('yuv420p'), vargs: ['-c:v', 'libx264', '-preset', q.preset, '-crf', String(crf ?? q.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', ...colorTags] };
  }
  if (format === 'webm') {
    if (!info.encoders.libvpx_vp9) throw new Error('Your ffmpeg has no libvpx-vp9 encoder.');
    const pix = transparent ? 'yuva420p' : 'yuv420p';
    return {
      segExt: 'webm', alpha: !!transparent,
      vf: transparent ? ['-vf', 'format=yuva420p'] : toYuv(pix),
      vargs: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf ?? q.vp9crf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', quality === 'draft' ? '8' : '4', '-pix_fmt', pix, ...(transparent ? ['-auto-alt-ref', '0'] : colorTags)],
    };
  }
  if (format === 'mov') {
    if (!info.encoders.prores_ks) throw new Error('Your ffmpeg has no prores_ks encoder.');
    return transparent
      ? { segExt: 'mov', alpha: true, vf: ['-vf', 'format=yuva444p10le'], vargs: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'] }
      : { segExt: 'mov', vf: toYuv('yuv422p10le'), vargs: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', ...colorTags] };
  }
  if (format === 'gif') {
    // Segments are lossless; the GIF is made in one pass at the end for a shared palette.
    return { segExt: 'mkv', needsFinalTranscode: true, vf: [], vargs: ['-c:v', 'ffv1', '-level', '3', '-pix_fmt', transparent ? 'bgra' : 'bgr0'] };
  }
  throw new Error(`Unknown format "${format}". Use mp4, webm, mov, gif, png (frames) or mkv.`);
}

/**
 * Open an ffmpeg process that reads images from stdin and writes a segment.
 * opts: { fps, inputCodec: 'mjpeg'|'png', out, plan, motionBlur: {samples}, width, height }
 */
export function openSegmentWriter({ fps, inputCodec, out, plan, motionBlur }) {
  const samples = motionBlur ? motionBlur.samples : 1;
  const inFps = fps * samples;
  const filters = [];
  if (samples > 1) filters.push(`tmix=frames=${samples}`, `select='eq(mod(n\\,${samples})\\,${samples - 1})'`, `setpts=N/(${fps}*TB)`);
  const vf = plan.vf || [];
  let vfStr = vf[1] || '';
  if (filters.length) vfStr = filters.join(',') + (vfStr ? ',' + vfStr : '');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(inFps), '-c:v', inputCodec, '-i', '-',
    ...(vfStr ? ['-vf', vfStr] : []), '-r', String(fps), ...plan.vargs, '-an', out];
  const proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => {
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`))));
    proc.on('error', reject);
  });
  proc.stdin.on('error', () => {});
  // Frames are queued so capturing the next frame overlaps with encoding this one.
  // Back-pressure only kicks in when ~64MB are waiting.
  const HIGH = 64 * 1024 * 1024;
  return {
    async write(buf) {
      proc.stdin.write(buf);
      if (proc.stdin.writableLength > HIGH) await new Promise((r) => proc.stdin.once('drain', r));
    },
    async end() { proc.stdin.end(); await done; },
    kill() { try { proc.kill('SIGKILL'); } catch {} },
    done,
  };
}

export function run(args, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', quiet ? 'error' : 'info', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.trim().split('\n').slice(-4).join(' ')}`))));
    p.on('error', reject);
  });
}

/**
 * Join segments and mix audio into the final file.
 * audio: [{file, start, end, from, rate, loop, volume, fadeIn, fadeOut}]
 */
function volumeExpr(keys, scale = 1) {
  // piecewise linear, as a flat sum (no deep nesting); commas escaped for the filter graph
  const f = (x) => (+x).toFixed(4);
  const parts = [];
  parts.push(`lt(t\\,${f(keys[0][0])})*${f(keys[0][1] * scale)}`);
  for (let i = 1; i < keys.length; i++) {
    const [a, va] = keys[i - 1], [b, vb] = keys[i];
    if (b <= a) continue;
    parts.push(`gte(t\\,${f(a)})*lt(t\\,${f(b)})*(${f(va * scale)}+(t-${f(a)})*${f(((vb - va) * scale) / (b - a))})`);
  }
  parts.push(`gte(t\\,${f(keys[keys.length - 1][0])})*${f(keys[keys.length - 1][1] * scale)}`);
  return `volume='${parts.join('+')}':eval=frame`;
}

/** Build per-input audio filter chains. Inputs start at index `first`. */
function audioChains(audio, args, first) {
  const filters = [], labels = [];
  audio.forEach((a, i) => {
    const idx = i + first;
    if (a.loop) args.push('-stream_loop', '-1');
    if (a.from > 0) args.push('-ss', String(a.from));
    args.push('-i', a.file);
    const len = Math.max(0, a.end - a.start);
    const chain = [];
    if (a.rate && a.rate !== 1) {
      let r = a.rate;
      while (r > 2) { chain.push('atempo=2'); r /= 2; }
      while (r < 0.5) { chain.push('atempo=0.5'); r /= 0.5; }
      chain.push(`atempo=${r.toFixed(5)}`);
    }
    chain.push(`atrim=0:${len.toFixed(4)}`, 'asetpts=PTS-STARTPTS');
    if (a.volumeKeys && a.volumeKeys.length) chain.push(volumeExpr(a.volumeKeys, a.volume ?? 1));
    else if (a.volume != null && a.volume !== 1) chain.push(`volume=${a.volume}`);
    if (a.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${a.fadeIn}`);
    if (a.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, len - a.fadeOut).toFixed(4)}:d=${a.fadeOut}`);
    chain.push('aresample=48000', 'aformat=channel_layouts=stereo');
    const ms = Math.round(a.start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    filters.push(`[${idx}:a]${chain.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  return { filters, labels };
}

export async function mixAudio({ audio, out, format, duration }) {
  const args = [];
  const { filters, labels } = audioChains(audio, args, 0);
  const bed = audio.length;
  args.push('-f', 'lavfi', '-t', duration.toFixed(4), '-i', 'anullsrc=r=48000:cl=stereo');
  filters.push(`[${bed}:a]asetpts=PTS-STARTPTS[bed]`);
  filters.push(`[bed]${labels.join('')}amix=inputs=${labels.length + 1}:normalize=0:duration=first:dropout_transition=0,atrim=0:${duration.toFixed(4)}[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[aout]');
  const codec = { mp3: ['-c:a', 'libmp3lame', '-q:a', '2'], wav: ['-c:a', 'pcm_s16le'], m4a: ['-c:a', 'aac', '-b:a', '192k'], ogg: ['-c:a', 'libopus', '-b:a', '160k'], flac: ['-c:a', 'flac'] }[format] || [];
  args.push(...codec, out);
  return run(args);
}

export async function finalize({ segments, listFile, out, format, duration, audio = [], fps, plan, transparent }) {
  writeFileSync(listFile, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  const args = ['-f', 'concat', '-safe', '0', '-i', listFile];
  const { filters, labels } = audioChains(audio, args, 1);
  if (format === 'gif') {
    const gifArgs = [...args, '-filter_complex', `[0:v]split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full${transparent ? ':reserve_transparent=1' : ''}[p];[s1][p]paletteuse=dither=sierra2_4a${transparent ? ':alpha_threshold=128' : ''}`, '-loop', '0', out];
    return run(gifArgs);
  }
  if (labels.length) {
    // A silent bed as long as the video keeps the mix aligned to t=0 and the right length.
    const bed = audio.length + 1;
    args.push('-f', 'lavfi', '-t', duration.toFixed(4), '-i', 'anullsrc=r=48000:cl=stereo');
    filters.push(`[${bed}:a]asetpts=PTS-STARTPTS[bed]`);
    filters.push(`[bed]${labels.join('')}amix=inputs=${labels.length + 1}:normalize=0:duration=first:dropout_transition=0,atrim=0:${duration.toFixed(4)}[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]');
    args.push('-c:v', 'copy');
    if (format === 'webm') args.push('-c:a', 'libopus', '-b:a', '160k');
    else if (format === 'mov') args.push('-c:a', 'pcm_s16le');
    else args.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-map', '0:v', '-c:v', 'copy');
  }
  if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart');
  args.push(out);
  return run(args);
}
