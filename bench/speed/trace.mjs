// Where render time goes: a Chrome trace around N frames, summed by event name.
// node bench/speed/trace.mjs video.html [from=2] [frames=45]
import { openComposition } from '../../src/render.js';
const [file, from = '2', n = '45'] = process.argv.slice(2);
const ctx = await openComposition(file, { mode: 'render' });
const p = ctx.page, b = p.browser;
const events = [];
b.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise((r) => b.on('Tracing.tracingComplete', r));
await b.send('Tracing.start', { traceConfig: { includedCategories: ['cc', 'viz', 'gpu', 'skia', 'blink', 'v8', 'disabled-by-default-devtools.timeline', 'toplevel', 'benchmark', 'renderer.scheduler'] }, transferMode: 'ReportEvents' });
const fps = ctx.info.fps; const t0 = Date.now();
for (let i = 0; i < +n; i++) { await p.seek(+from + i / fps); await p.capture('jpeg', 92); }
const wall = Date.now() - t0;
await b.send('Tracing.end');
await done;
const agg = new Map();
for (const e of events) { if (e.ph !== 'X' || !e.dur) continue; const k = e.name; agg.set(k, (agg.get(k) || 0) + e.dur); }
console.log('wall ms', wall, 'per frame', (wall / n).toFixed(1));
for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log((v / 1000).toFixed(0).padStart(7), 'ms', k);
await p.close(); await ctx.server.close();
