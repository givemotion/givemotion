// `givemotion audio <file>`: tempo, beats, bars and hits of a sound file, to plan cuts before writing code.
import { existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { ensureChrome, FramePage } from './browser.js';
import { startServer } from './server.js';

export async function analyzeAudio(file, opts = {}) {
  file = resolve(file);
  if (!existsSync(file)) throw new Error(`Audio file not found: ${file}`);
  const chrome = await ensureChrome({ chrome: opts.chrome });
  const server = await startServer({ root: dirname(file) });
  const page = new FramePage({ chrome, width: 320, height: 180, scale: 1 });
  try {
    await page.start();
    await page.open(server.origin + '/__gm_analyze?fps=' + (opts.fps || 30) + '&src=' + encodeURIComponent(basename(file)), { mode: 'render' });
    return await page.evaluate(`(async () => {
      const a = window.__gmA; await a.ready;
      if (!a.data) return { error: (gm.__issues()[0] || {}).message || 'analysis failed' };
      const d = a.data, r3 = (x) => Math.round(x * 1000) / 1000;
      // loud and quiet parts (per second)
      const per = Math.round(d.fps), loud = [];
      for (let s = 0; s * per < d.frames; s++) { let m = 0, c = 0; for (let f = s * per; f < Math.min(d.frames, (s + 1) * per); f++) { m += d.level[f]; c++; } loud.push(Math.round((m / c) * 100) / 100); }
      // loudness every 0.25s → quiet gaps (good for a breath before a hit) and the biggest hits
      const q = Math.max(1, Math.round(d.fps / 4)), env = [];
      for (let f = 0; f < d.frames; f += q) { let m = 0, c = 0; for (let k = f; k < Math.min(d.frames, f + q); k++) { m += d.level[k]; c++; } env.push(m / c); }
      const mean = env.reduce((a, b) => a + b, 0) / env.length, gaps = [];
      for (let i = 0; i < env.length; i++) { if (env[i] < mean * 0.45) { const st = i; while (i + 1 < env.length && env[i + 1] < mean * 0.45) i++; if (i - st >= 0) gaps.push([r3(st * 0.25), r3((i + 1) * 0.25)]); } }
      const hits = d.onsets.slice().sort((a, b) => b.strength * (0.3 + (b.bass || 0)) - a.strength * (0.3 + (a.bass || 0))).slice(0, 8).map((o) => o.time).sort((a, b) => a - b);
      return { file: ${JSON.stringify(basename(file))}, duration: r3(d.duration), bpm: d.bpm, quietGaps: gaps, biggestHits: hits, beatSeconds: d.beats.length > 1 ? r3(d.beats[1] - d.beats[0]) : null,
        firstBeat: d.beats[0] ?? null, beats: d.beats, downbeats: d.downbeats, onsets: d.onsets.map((o) => o.time), onsetDetail: d.onsets, strongOnsets: d.onsets.filter((o) => o.strength > 0.5).map((o) => o.time), loudnessPerSecond: loud };
    })()`);
  } finally {
    await page.close();
    await server.close();
  }
}

export function formatAudio(r) {
  if (r.error) return 'Could not analyze: ' + r.error;
  const list = (a, n = 16) => a.slice(0, n).map((x) => x.toFixed(3)).join(' ') + (a.length > n ? ` … (${a.length} total)` : '');
  return [
    `${r.file}: ${r.duration}s`,
    `tempo: ${r.bpm} BPM (one beat = ${r.beatSeconds}s), first beat at ${r.firstBeat}s`,
    `beats:      ${list(r.beats)}`,
    `downbeats:  ${list(r.downbeats)}   (bar starts: good places to cut)`,
    `big hits:   ${list(r.strongOnsets)}`,
    `biggest hits (best moments for a logo or a cut): ${r.biggestHits.map((x) => x.toFixed(2) + 's').join(' ')}`,
    `quiet gaps (a breath before a drop): ${r.quietGaps.length ? r.quietGaps.map(([a, b]) => a.toFixed(2) + '-' + b.toFixed(2) + 's').join(', ') : 'none'}`,
    `loudness per second (0-1): ${r.loudnessPerSecond.join(' ')}`,
    `In a composition: const music = gm.audio('${r.file}'); music.beats / music.downbeats / music.beat(t)`,
    ...(r.beats && r.beats.length > 2 ? (() => {
      const per = (r.beats[r.beats.length - 1] - r.beats[0]) / (r.beats.length - 1);
      const bar = r.downbeats && r.downbeats.length ? r.downbeats[0] : r.beats[0];
      return [`Beat grid you can use while building timelines (no waiting): <html data-bpm="${(60 / per).toFixed(3)}" data-beat-offset="${r.beats[0].toFixed(3)}" data-bar-offset="${bar.toFixed(3)}">`,
        `  then gm.beat(8) = ${(r.beats[0] + 8 * per).toFixed(3)}s (beat 0 is the first beat), gm.bar(2) = ${(bar + 8 * per).toFixed(3)}s (4 beats per bar; set data-beats-per-bar to change)`];
    })() : []),
  ].join('\n');
}
