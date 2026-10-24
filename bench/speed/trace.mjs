// Where render time goes: a Chrome trace around N frames, summed by event name.
// node bench/speed/trace.mjs video.html [from=2] [frames=45]
// "cpu" is thread time (tdur): it counts only the time a thread actually ran, so it is much less noisy than wall
// time on a busy machine. Nested events are counted in their parents too, so the rows do not add up.
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
for (const e of events) {
  if (e.ph !== 'X' || !e.dur) continue;
  const a = agg.get(e.name) || { dur: 0, cpu: 0, count: 0 };
  a.dur += e.dur; a.cpu += e.tdur || 0; a.count++;
  agg.set(e.name, a);
}
console.log('wall ms', wall, 'per frame', (wall / n).toFixed(1));
console.log("   wall ms    cpu ms  cpu/frame  count  event");
for (const [k, v] of [...agg].sort((a, b) => b[1].cpu - a[1].cpu).slice(0, 25)) console.log((v.dur / 1000).toFixed(0).padStart(10), (v.cpu / 1000).toFixed(0).padStart(9), (v.cpu / 1000 / n).toFixed(2).padStart(10), String(v.count).padStart(6), " ", k);
await p.close(); await ctx.server.close();
