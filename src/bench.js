// `givemotion bench`: measure render speed on this machine, and show what each frame costs to composite.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { render, openComposition } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function bench(input, opts = {}) {
  const file = input ? resolve(input) : join(HERE, '..', 'examples', 'bench', 'index.html');
  if (!existsSync(file)) throw new Error('Benchmark composition not found: ' + file);
  const tmp = mkdtempSync(join(tmpdir(), 'gm-bench-'));
  const runs = [
    { name: 'naive: 1 browser, screenshots, PNG, no frame reuse', opts: { workers: 1, capture: 'screenshot', lossless: true, noReuse: true } },
    { name: 'givemotion, 1 worker', opts: { workers: 1 } },
    { name: `givemotion, ${opts.workers || 'auto'} workers`, opts: { workers: opts.workers } },
  ];
  const results = [];
  const log = (s) => process.stderr.write(s + '\n');
  log(`machine: ${cpus().length} cores (${cpus()[0] ? cpus()[0].model.trim() : '?'}), ${(totalmem() / 2 ** 30).toFixed(1)} GB RAM`);
  let layers = null;
  try { layers = await layerReport(file, { chrome: opts.chrome }); for (const line of formatLayerReport(layers)) log(line); log(''); }
  catch (e) { log(`(layer report failed: ${e.message})\n`); }
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
  if (opts.json) console.log(JSON.stringify({ runs: results, layers }, null, 2));
  return results;
}

// Without a GPU, Chrome draws every composited layer pixel by pixel on the CPU, once per frame, and an offscreen
// pass (a filter, a mask, a blur move) is drawn and then drawn again. So the cost of a frame grows with how much
// of the frame its layers cover ("1.0" = one full frame of pixels) and with the number of passes.
const REASONS = [
  [/Animation/, 'animated'], [/Canvas/, 'canvas'], [/Video/, 'video'], [/WillChange/, 'will-change'],
  [/3D|Perspective|Backface/, '3d'], [/Overlap|Squash|Assumed/, 'overlaps a layer'], [/Filter|Backdrop/, 'filter'],
  [/Root|Scroll/, 'page'], [/Iframe|Plugin/, 'iframe'], [/Fixed|Sticky/, 'fixed'],
];
function shortReasons(ids) {
  return ids.map((id) => { const m = REASONS.find(([re]) => re.test(id)); return m ? m[1] : id; });
}
// The part of a layer that is inside the frame, in frame-sized units (the transform from LayerTree is screen space).
function visibleArea(l, W, H) {
  const m = l.transform || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const ox = l.offsetX || 0, oy = l.offsetY || 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[0, 0], [l.width, 0], [0, l.height], [l.width, l.height]]) {
    const px = x + ox, py = y + oy;
    const w = m[3] * px + m[7] * py + m[15] || 1;
    const sx = (m[0] * px + m[4] * py + m[12]) / w, sy = (m[1] * px + m[5] * py + m[13]) / w;
    x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
  }
  const w = Math.max(0, Math.min(W, x1) - Math.max(0, x0)), h = Math.max(0, Math.min(H, y1) - Math.max(0, y0));
  return (w * h) / (W * H);
}
// In the page: a short name for the element behind a layer, and whether it is drawn at all (opacity 0 is skipped).
const NODE_INFO = `function () {
  const name = (el) => { let s = el.localName; if (el.id) s += '#' + el.id; const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter((x) => x && !x.startsWith('gm-')).slice(0, 2) : []; if (c.length) s += '.' + c.join('.'); return s; };
  const el = this.nodeType === 1 ? this : this.parentElement;
  if (!el || el === document.documentElement || el === document.body) return { label: 'page', shown: true };
  let shown = true;
  for (let a = el; a && a.nodeType === 1; a = a.parentElement) { const cs = getComputedStyle(a); if (+cs.opacity === 0 || cs.display === 'none') { shown = false; break; } }
  if (shown && getComputedStyle(el).visibility === 'hidden' && !el.children.length) shown = false;
  const label = el.hasAttribute('data-gm-internal') && el.parentElement ? name(el) + ' in ' + name(el.parentElement) : name(el);
  return { label, shown };
}`;
async function nodeInfo(p, backendNodeId) {
  try {
    const { object } = await p.s('DOM.resolveNode', { backendNodeId });
    const r = await p.s('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: NODE_INFO });
    p.s('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    return r.result.value || { label: '?', shown: true };
  } catch (e) { return { label: '?', shown: true }; }
}

// Composited layers at a few times: how many, how much of the frame they cover, how many passes, and which
// elements cost most.
export async function layerReport(input, opts = {}) {
  const ctx = await openComposition(input, { mode: 'render', chrome: opts.chrome, data: opts.data });
  const p = ctx.page, b = p.browser;
  const { width: W, height: H, fps, duration } = ctx.info;
  try {
    let last = null;
    b.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) last = e.layers; }, p.sessionId);
    const events = [];
    b.on('Tracing.dataCollected', (e) => events.push(...e.value));
    await p.s('DOM.enable');
    await p.s('LayerTree.enable');
    const n = opts.samples || 6;
    const times = opts.times || Array.from({ length: n }, (_, i) => +((duration * (i + 0.5)) / n).toFixed(2));
    const samples = [], byNode = new Map();
    for (const t of times) {
      // Two frames: the layer tree of a frame arrives after it is drawn. The second one is traced to count passes.
      last = null;
      await p.seek(t); await p.capture('jpeg', 80);
      events.length = 0;
      let passes = null, traced = null;
      try { await b.send('Tracing.start', { traceConfig: { includedCategories: ['viz'] }, transferMode: 'ReportEvents' }); traced = b.once('Tracing.tracingComplete', undefined, 30000); } catch (e) {}
      await p.seek(t + 1 / fps); await p.capture('jpeg', 80);
      if (traced) {
        try {
          await b.send('Tracing.end'); await traced;
          const draws = events.filter((e) => e.ph === 'X' && e.name === 'DirectRenderer::DrawFrame');
          const f = draws[draws.length - 1];
          if (f) passes = events.filter((e) => e.ph === 'X' && e.name === 'DirectRenderer::DrawRenderPass' && e.ts >= f.ts && e.ts <= f.ts + f.dur).length;
        } catch (e) {}
      }
      let area = 0, count = 0;
      for (const l of last || []) {
        if (!l.drawsContent || l.invisible || !(l.width * l.height > 0)) continue;
        const a = visibleArea(l, W, H);
        if (a <= 0) continue;
        const key = l.backendNodeId ? 'n' + l.backendNodeId : 'l' + l.layerId;
        let e = byNode.get(key);
        const info = l.backendNodeId ? await nodeInfo(p, l.backendNodeId) : { label: 'page', shown: true };
        if (!info.shown) continue; // an invisible layer is not drawn
        if (!e) { e = { label: info.label, area: 0, reasons: [] }; byNode.set(key, e); }
        try {
          const r = await p.s('LayerTree.compositingReasons', { layerId: l.layerId });
          for (const w of shortReasons(r.compositingReasonIds || r.compositingReasons || [])) if (!e.reasons.includes(w)) e.reasons.push(w);
        } catch (err) {}
        e.area += a; area += a; count++;
      }
      samples.push({ t, layers: count, area: +area.toFixed(2), passes });
    }
    const top = [...byNode.values()].sort((x, y) => y.area - x.area).slice(0, opts.top || 6);
    for (const e of top) e.area = +(e.area / times.length).toFixed(2);
    const mean = (k) => samples.reduce((s, x) => s + (x[k] || 0), 0) / samples.length;
    const hasPasses = samples.some((s) => s.passes != null);
    return { samples, layers: +mean('layers').toFixed(1), area: +mean('area').toFixed(2), passes: hasPasses ? +mean('passes').toFixed(1) : null, top };
  } finally {
    await p.close().catch(() => {});
    await ctx.server.close().catch(() => {});
  }
}
export function formatLayerReport(r) {
  return [
    `compositing: ${r.layers} layers covering ${r.area} frames of pixels${r.passes != null ? `, ${r.passes} render passes` : ''} per frame on average (without a GPU every layer pixel and every pass costs CPU time on each frame)`,
    '  at ' + r.samples.map((s) => `${s.t}s ${s.layers}/${s.area}${s.passes != null ? '/' + s.passes : ''}`).join(', ') + '  (layers/area/passes)',
    '  biggest: ' + r.top.filter((e) => e.area >= 0.05).map((e) => `${e.label} ${e.area}${e.reasons.length ? ' (' + e.reasons.join(', ') + ')' : ''}`).join('; '),
  ];
}
