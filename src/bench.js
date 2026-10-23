// `motionwright bench`: measure render speed on this machine.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { render } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function bench(input, opts = {}) {
  const file = input ? resolve(input) : join(HERE, '..', 'examples', 'bench', 'index.html');
  if (!existsSync(file)) throw new Error('Benchmark composition not found: ' + file);
  const tmp = mkdtempSync(join(tmpdir(), 'mw-bench-'));
  const runs = [
    { name: 'naive: 1 browser, screenshots, PNG, no frame reuse', opts: { workers: 1, capture: 'screenshot', lossless: true, noReuse: true } },
    { name: 'motionwright, 1 worker', opts: { workers: 1 } },
    { name: `motionwright, ${opts.workers || 'auto'} workers`, opts: { workers: opts.workers } },
  ];
  const results = [];
  const log = (s) => process.stderr.write(s + '\n');
  log(`machine: ${cpus().length} cores (${cpus()[0] ? cpus()[0].model.trim() : '?'}), ${(totalmem() / 2 ** 30).toFixed(1)} GB RAM`);
  for (const r of runs) {
    const out = join(tmp, `b${results.length}.mp4`);
    const s = await render(file, { ...r.opts, output: out, quiet: true, chrome: opts.chrome, log: () => {} });
    results.push({ name: r.name, seconds: s.seconds, fps: s.renderFps, realtime: +(s.duration / s.seconds).toFixed(2), workers: s.workers, capture: s.capture, reused: s.reusedFrames, frames: s.frames, size: `${s.width}x${s.height}@${s.fps}` });
    log(`${r.name.padEnd(56)} ${String(s.seconds).padStart(6)}s  ${String(s.renderFps).padStart(6)} fps  (${s.capture}, ${s.workers}w, ${s.reusedFrames} reused)`);
  }
  const base = results[0].seconds;
  for (const r of results) r.speedup = +(base / r.seconds).toFixed(2);
  log(`\nvideo: ${results[0].frames} frames ${results[0].size}. Speed-up vs naive: ${results.map((r) => r.speedup + 'x').join(' / ')}`);
  rmSync(tmp, { recursive: true, force: true });
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  return results;
}
