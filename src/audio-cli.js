// `motionwright audio <file>`: tempo, beats, bars and hits of a sound file, to plan cuts before writing code.
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
    await page.open(server.origin + '/__mw_analyze?fps=' + (opts.fps || 30) + '&src=' + encodeURIComponent(basename(file)), { mode: 'render' });
    return await page.evaluate(`(async () => {
      const a = window.__mwA; await a.ready;
      if (!a.data) return { error: (mw.__issues()[0] || {}).message || 'analysis failed' };
      const d = a.data, r3 = (x) => Math.round(x * 1000) / 1000;
      // loud and quiet parts (per second)
      const per = Math.round(d.fps), loud = [];
      for (let s = 0; s * per < d.frames; s++) { let m = 0, c = 0; for (let f = s * per; f < Math.min(d.frames, (s + 1) * per); f++) { m += d.level[f]; c++; } loud.push(Math.round((m / c) * 100) / 100); }
      return { file: ${JSON.stringify(basename(file))}, duration: r3(d.duration), bpm: d.bpm, beatSeconds: d.beats.length > 1 ? r3(d.beats[1] - d.beats[0]) : null,
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
    `loudness per second (0-1): ${r.loudnessPerSecond.join(' ')}`,
    `In a composition: const music = mw.audio('${r.file}'); music.beats / music.downbeats / music.beat(t)`,
  ].join('\n');
}
