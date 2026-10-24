// How many composited layers a frame has, how much of the frame they cover, and why they exist.
// node bench/speed/layers.mjs video.html [time=3]
import { openComposition } from '../../src/render.js';
const [file, at = '3'] = process.argv.slice(2);
const ctx = await openComposition(file, { mode: 'render' });
const p = ctx.page, b = p.browser;
let last = null;
b.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) last = e.layers; }, p.sessionId);
await p.s('DOM.enable');
await p.s('LayerTree.enable');
await p.seek(+at); await p.capture('jpeg', 92); await p.seek(+at + 1 / 30); await p.capture('jpeg', 92);
const W = ctx.info.width * ctx.info.height;
const ls = (last || []).filter((l) => l.drawsContent);
let area = 0; const big = [];
for (const l of ls) { const a = l.width * l.height; area += a; if (a > 0.3 * W) big.push(l); }
console.log('layers drawing content', ls.length, 'total area', (area / W).toFixed(1), 'frames; big ones', big.length);
for (const l of big.slice(0, 12)) {
  let reasons = [];
  try { const r = await p.s('LayerTree.compositingReasons', { layerId: l.layerId }); reasons = r.compositingReasonIds || r.compositingReasons || []; } catch (e) {}
  let node = '';
  if (l.backendNodeId) { try { const d = await p.s('DOM.describeNode', { backendNodeId: l.backendNodeId }); node = d.node.localName + (d.node.attributes ? '[' + d.node.attributes.slice(0, 4).join(' ') + ']' : ''); } catch (e) {} }
  console.log(`${l.width}x${l.height}`, node.slice(0, 80), reasons.join(','));
}
await p.close(); await ctx.server.close();
