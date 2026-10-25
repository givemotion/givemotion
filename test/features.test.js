// Tests for motion tools, React mode, audio analysis and the checker's motion handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpegInfo, ffmpegPath } from '../src/ffmpeg.js';
import { render, check, inspect, openComposition } from '../src/api.js';
import { formatReport } from '../src/check.js';

const skip = !findChrome() || !ffmpegInfo() ? 'needs Chrome and ffmpeg' : false;
const hasEsbuild = await import('esbuild').then(() => true, () => false);
const tmp = () => mkdtempSync(join(tmpdir(), 'gm-feat-'));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { quiet: true, log: () => {} };
const page = (body, attrs = 'data-width="640" data-height="360" data-fps="30"') => `<!doctype html><html ${attrs}><head><style>body{background:#111;color:#fff;font-family:sans-serif}</style></head><body>${body}</body></html>`;
async function evalAt(file, t, expr) {
  const ctx = await openComposition(file, { mode: 'render' });
  try { await ctx.page.seek(t); return await ctx.page.evaluate(expr); } finally { await ctx.page.close(); await ctx.server.close(); }
}

test('timeline: from/to/stagger values at exact times', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><i class="b" style="display:block;width:10px;height:10px"></i><i class="b" style="display:block;width:10px;height:10px"></i></div>
    <script>gm.timeline().fromTo('.b', { x: 0, opacity: 0 }, { x: 100, opacity: 1, duration: 1, ease: 'linear', stagger: 0.5 }, 0);</script>`));
  const v = await evalAt(f, 0.5, `[...document.querySelectorAll('.b')].map(e => [Math.round(new DOMMatrix(getComputedStyle(e).transform).e), +getComputedStyle(e).opacity])`);
  assert.deepEqual(v, [[50, 0.5], [0, 0]]);
});

test('react: .jsx renders and 1 worker equals 2 workers', { skip: skip || (!hasEsbuild && 'needs the optional esbuild, react and react-dom (npm install)') }, async () => {
  const d = tmp(), f = join(d, 'v.jsx');
  writeFileSync(f, `import { Scene, Sequence, useTime, interpolate } from 'givemotion/react';
export const config = { width: 320, height: 180, fps: 30 };
function Dot() { const t = useTime(); return <div style={{ width: 40, height: 40, background: '#f55', transform: 'translateX(' + interpolate(t, [0, 1], [0, 200]) + 'px)' }} />; }
export default function V() { return <Sequence transition="fade 0.3"><Scene duration={1}><Dot /></Scene><Scene duration={1} style={{ background: '#225' }}><Dot /></Scene></Sequence>; }`);
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 2, ...quiet });
  const fa = readdirSync(a).sort();
  assert.ok(fa.length >= 50);
  for (const x of fa) assert.ok(readFileSync(join(a, x)).equals(readFileSync(join(b, x))), 'frame differs: ' + x);
});

test('audio: beat grid lands on the kicks of a 120 BPM click track', { skip }, async () => {
  const d = tmp(), wav = join(d, 'clicks.wav');
  // 120 BPM kicks (low thumps) starting at 0.25s, with quieter high clicks between them
  execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*60*t)*exp(-30*mod(t-0.25+10,0.5))*gte(t,0.25)+0.3*sin(2*PI*4000*t)*exp(-80*mod(t+10,0.5))*gte(t,0.5):s=22050:d=8'", wav]);
  const f = join(d, 'a.html');
  writeFileSync(f, page(`<audio id="m" src="clicks.wav"></audio><script>window.m = gm.audio('#m');</script>`, 'data-width="320" data-height="180" data-duration="8"'));
  const r = await evalAt(f, 0, `(async () => { await m.ready; return { bpm: m.bpm, beats: m.beats.slice(0, 4) }; })()`);
  assert.ok(Math.abs(r.bpm - 120) < 1, 'bpm ' + r.bpm);
  assert.ok(Math.abs(r.beats[0] - 0.25) < 0.02, 'first beat ' + r.beats[0]);
  assert.ok(Math.abs(r.beats[1] - 0.75) < 0.02, 'second beat ' + r.beats[1]);
});

test('check: text flying in from off-screen is not an error; text stuck off-screen is', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><h1 id="fly" style="position:absolute;left:100px;top:40px;font-size:40px;margin:0">Flying in</h1>
    <h1 id="stuck" style="position:absolute;left:560px;top:200px;font-size:40px;margin:0;white-space:nowrap">Stuck half out</h1></div>
    <script>gm.timeline().from('#fly', { x: 900, duration: 1.2, ease: 'power2.out' }, 0.3);</script>`));
  const rep = await check(f);
  const off = rep.issues.filter((i) => i.code === 'text-offscreen');
  assert.ok(off.some((i) => i.selector === '#stuck'), 'stuck text should be reported');
  assert.ok(!off.some((i) => i.selector === '#fly'), 'flying text should not be reported');
});

test('data-cuts sets scene starts; data-fit="grow" fills the width', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence data-cuts="0 1 2.5" data-transition="fade 0.2"><section class="scene">A</section><section class="scene">B</section><section class="scene" data-duration="1"><div id="w" style="width:500px"><div id="g" data-fit="grow" style="font-size:20px">Fill me</div></div></section></main>`));
  const info = await inspect(f);
  assert.deepEqual(info.clips.map((c) => c.start), [0, 1, 2.5]);
  const w = await evalAt(f, 2.6, `document.getElementById('g').scrollWidth`);
  assert.ok(Math.abs(w - 500) <= 2, 'width ' + w);
});

test('gm.random(seed) is stable per seed and differs across seeds', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="1"></div>`));
  const r = await evalAt(f, 0, `[gm.random('a'), gm.random('a'), gm.random('b'), gm.random(3)]`);
  assert.equal(r[0], r[1]);
  assert.notEqual(r[0], r[2]);
  assert.ok(r.every((x) => x >= 0 && x < 1));
});

test('timeline: two timelines on one element, newest tween wins; CSS centering kept while hidden', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence><section data-duration="1"></section><section id="s1" data-duration="4" style="position:relative">
    <div id="a" style="position:absolute;left:300px;width:100px;height:40px;transform:translateX(-50%)"></div></section></main>
    <script>gm.timeline('#s1').to('#a', { scaleX: 0.2, duration: 0.5 }, 0.5); gm.timeline('#s1').fromTo('#a', { scaleX: 0 }, { scaleX: 1, duration: 0.5 }, 2);</script>`, 'data-width="640" data-height="360" data-fps="30"'));
  const m = await evalAt(f, 4, `(() => { const m = new DOMMatrix(getComputedStyle(document.getElementById('a')).transform); return [m.a, m.e]; })()`);
  assert.deepEqual(m, [1, -50]);
  const m2 = await evalAt(f, 2.6, `new DOMMatrix(getComputedStyle(document.getElementById('a')).transform).a`);
  assert.equal(m2, 0.2);
});

test('timeline: counting keeps the number format; travel moves SVG shapes', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><b id="n1">000</b> <b id="n2">$0.00</b> <b id="n3">0</b>
    <svg width="640" height="360"><path id="p" d="M100 100 L500 100" fill="none" stroke="#fff"/><circle id="c" cx="20" cy="20" r="10" fill="red"/></svg></div>
    <script>gm.timeline().to('#n1', { textContent: 42, duration: 1 }).to('#n2', { textContent: 4.5, duration: 1 }, 0).to('#n3', { textContent: -12, duration: 1 }, 0);
    gm.path.travel('#c', '#p', { stops: [[0, 0], [2, 1]], ease: 'linear' });</script>`));
  const v = await evalAt(f, 1.5, `[n1.textContent, n2.textContent, n3.textContent, Math.round(c.getBoundingClientRect().left + 10 - p.getBoundingClientRect().left)]`);
  assert.deepEqual(v.slice(0, 3), ['042', '$4.50', '−12']);
  assert.ok(Math.abs(v[3] - 300) <= 3, 'circle at ' + v[3]);
});

test('render keeps parts: editing one scene redoes only its parts, and the result equals a full render byte for byte', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  const scenes = (word) => `<main data-sequence data-transition="fade 0.3">${['#225', '#522', '#252', '#552'].map((c, i) => `<section class="scene" data-duration="1.5" style="background:${c};display:grid;place-items:center"><h1 data-enter="rise" style="font-size:60px">${i === 2 ? word : 'Scene ' + i}</h1></section>`).join('')}</main>`;
  writeFileSync(f, page(scenes('Hello')));
  const out = join(d, 'out', 'v.mp4');
  const r1 = await render(f, { output: out, ...quiet });
  assert.equal(r1.parts.reused, 0);
  writeFileSync(f, page(scenes('Changed')));
  const r2 = await render(f, { output: out, ...quiet });
  assert.ok(r2.parts.reused >= 2 && r2.parts.rendered >= 1, JSON.stringify(r2.parts));
  const full = join(d, 'full.mp4');
  await render(f, { output: full, cache: false, workers: 1, ...quiet });
  assert.ok(readFileSync(out).equals(readFileSync(full)), 'patched video differs from a full render');
  const r3 = await render(f, { output: out, redo: '0s-1s', ...quiet });
  assert.equal(r3.parts.rendered, 1);
});

// one long camera-world scene (6 parts of 1 s): late things are a written label, a nested clip and a sketched shape
// (the camera only pans: a zoom that animates leaves Chrome's raster a little different in a fresh worker, see docs/NEXT.md)
const longScene = ({ label = 'later', note = 'note', shape = 'x="600" y="80"', target = { x: 640, y: 380 }, flow = 'first' } = {}) => page(`<section class="scene" data-duration="6" style="background:#fbfaf6;color:#1e1e1e">
  <div id="world" style="position:absolute;left:0;top:0;width:1200px;height:700px">
    <div id="txt" style="position:absolute;left:40px;top:40px;width:420px"><p style="margin:0;font-size:30px" data-enter="fade 0.5 2.5">${flow}</p><p style="margin:0;font-size:30px">second</p></div>
    <div id="a" style="position:absolute;left:60px;top:160px;width:160px;height:80px;background:#1971c2"></div>
    <div id="b" style="position:absolute;left:420px;top:300px;width:160px;height:80px;background:#e8590c" data-enter="fade 0.5 1"></div>
    <div id="late" style="position:absolute;left:640px;top:420px;font:40px Caveat" data-enter="write 0.6 4.2">${label}</div>
    <div data-start="3.4" style="position:absolute;left:80px;top:440px;font-size:28px"><span>${note}</span></div>
    <svg viewBox="0 0 1200 700" style="position:absolute;inset:0;width:1200px;height:700px" data-sketch><rect ${shape} width="200" height="100" fill="#ffd8a8" stroke="#1e1e1e" stroke-width="5" data-enter="draw 0.8 3.6"/></svg>
  </div></section>
  <script>gm.camera('#world').shot(0, { center: { x: 600, y: 350 }, zoom: 0.5 }).shot(2, { center: ${JSON.stringify(target)}, zoom: 0.5, duration: 1 }); gm.connect('#a', '#b', { sketch: true });</script>`);

test('render keeps parts inside one long scene: editing an element that appears late keeps the parts before it, byte for byte', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html'), out = join(d, 'out', 'v.mp4');
  writeFileSync(f, longScene());
  const r1 = await render(f, { output: out, ...quiet });
  assert.equal(r1.parts.total, 6);
  assert.equal(r1.parts.lateOff, null);
  assert.equal(r1.parts.late, 3, JSON.stringify(r1.parts));
  const same = async (opts, label) => {
    writeFileSync(f, longScene(opts));
    const r = await render(f, { output: out, ...quiet });
    const full = join(d, 'full.mp4');
    await render(f, { output: full, cache: false, workers: 1, ...quiet });
    assert.ok(readFileSync(out).equals(readFileSync(full)), label + ': patched video differs from a full render');
    return r.parts;
  };
  // the label is written at 4.2 s: parts 0-3 s stay
  let p = await same({ label: 'much later' }, 'label');
  assert.equal(p.reused, 4, 'label ' + JSON.stringify(p));
  // the nested clip starts at 3.4 s, the sketched rect is drawn from 3.6 s: parts 0-2 s stay
  p = await same({ label: 'much later', note: 'a new note' }, 'nested clip');
  assert.equal(p.reused, 3, 'nested clip ' + JSON.stringify(p));
  p = await same({ label: 'much later', note: 'a new note', shape: 'x="640" y="60"' }, 'sketched shape');
  assert.equal(p.reused, 3, 'shape ' + JSON.stringify(p));
});

test('render keeps parts inside one long scene: a camera target or an element in the flow redoes the whole scene', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html'), out = join(d, 'out', 'v.mp4');
  // #late becomes a camera target: the camera moves to it from 2 s, so it is not late any more
  writeFileSync(f, longScene({ target: '#late' }));
  const r1 = await render(f, { output: out, ...quiet });
  assert.equal(r1.parts.late, 2, JSON.stringify(r1.parts));
  writeFileSync(f, longScene({ target: '#late', label: 'a much longer label now' }));
  const r2 = await render(f, { output: out, ...quiet });
  assert.equal(r2.parts.reused, 0, 'camera target ' + JSON.stringify(r2.parts));
  // a paragraph in normal flow that fades in at 2.5 s: its size moves the line under it, which shows from the start
  writeFileSync(f, longScene({ target: '#late', label: 'a much longer label now', flow: 'a first line that is long enough to wrap' }));
  const r3 = await render(f, { output: out, ...quiet });
  assert.equal(r3.parts.reused, 0, 'in-flow element ' + JSON.stringify(r3.parts));
  const full = join(d, 'full.mp4');
  await render(f, { output: full, cache: false, workers: 1, ...quiet });
  assert.ok(readFileSync(out).equals(readFileSync(full)), 'patched video differs from a full render');
  // a sketched shape added inside the late nested clip moves the seeds of the sketched shapes after it in the page,
  // here a rect that shows from the start: the scene's live print changes, so nothing is reused
  const early = 'x="600" y="80" data-enter="none"';
  writeFileSync(f, longScene({ shape: early }));
  await render(f, { output: out, ...quiet });
  writeFileSync(f, longScene({ shape: early, note: 'note <svg data-sketch width="100" height="50"><rect x="2" y="2" width="60" height="30" stroke="#000" fill="none"/></svg>' }));
  const r4 = await render(f, { output: out, ...quiet });
  assert.equal(r4.parts.reused, 0, 'seeds ' + JSON.stringify(r4.parts));
  await render(f, { output: full, cache: false, workers: 1, ...quiet });
  assert.ok(readFileSync(out).equals(readFileSync(full)), 'seeds: patched video differs from a full render');
});

test('sketch: data-sketch shapes are rough, seeded and keep their id; gm.connect follows a moving element', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3" style="position:absolute;inset:0"><svg viewBox="0 0 640 360" style="position:absolute;inset:0" data-sketch>
    <rect id="r" x="20" y="20" width="200" height="100" fill="#fd0" stroke="#000" stroke-width="3"/></svg>
    <div id="a" style="position:absolute;left:20px;top:200px;width:80px;height:40px;background:#333"></div>
    <div id="b" style="position:absolute;left:400px;top:200px;width:80px;height:40px;background:#333"></div></div>
    <script>gm.timeline().to('#b', { y: 100, duration: 1, ease: 'linear' }, 0); gm.connect('#a', '#b', { head: 'none' });</script>`));
  const v = await evalAt(f, 1.5, `(() => { const r = document.getElementById('r'); const p = document.querySelector('.gm-connect path').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    return { tag: r.tagName, paths: r.querySelectorAll('path').length, same: gm.sketch.rect(0, 0, 100, 50, { seed: 3 }) === gm.sketch.rect(0, 0, 100, 50, { seed: 3 }), differ: gm.sketch.rect(0, 0, 100, 50, { seed: 3 }) !== gm.sketch.rect(0, 0, 100, 50, { seed: 4 }), end: p.slice(-2) }; })()`);
  assert.equal(v.tag, 'g');
  assert.equal(v.paths, 4, 'hatching + two passes + the hidden guide');
  assert.ok(v.same && v.differ);
  // the line ends on the left edge of #b (moved down by 100px) minus the gap (10px at 1080p = 3.3px here)
  assert.ok(Math.abs(v.end[0] - 396.8) < 2 && Math.abs(v.end[1] - 308.6) < 2, 'end ' + v.end);
});

test('analyze: finds a hard cut and a fade with their times, and the colors', { skip }, async () => {
  const { analyzeVideo } = await import('../src/analyze.js');
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence><section class="scene" data-duration="1.5" style="background:#1b2a6b"></section><section class="scene" data-duration="1.5" style="background:#c0392b"></section><section class="scene" data-duration="1.5" data-transition="fade 0.5" style="background:#16a085"></section></main>`));
  const out = join(d, 'v.mp4');
  await render(f, { output: out, ...quiet });
  const r = await analyzeVideo(out, { output: join(d, 'an'), sheets: false, audio: false });
  assert.equal(r.transitions.length, 2, JSON.stringify(r.transitions));
  assert.equal(r.transitions[0].type, 'cut');
  assert.ok(Math.abs(r.transitions[0].at - 1.5) < 0.05, 'cut at ' + r.transitions[0].at);
  assert.equal(r.transitions[1].type, 'fade');
  // the fade runs 2.5-3.0 s with the default out-expo easing, so it is visually half done early in that window
  assert.ok(r.transitions[1].at >= 2.45 && r.transitions[1].at <= 2.8, 'fade at ' + r.transitions[1].at);
  assert.equal(r.shots.length, 3);
  assert.equal(r.colors.theme, 'dark');
});

test('analyze: on one shared background, small content that is pushed, wiped and cut is found and named', { skip }, async () => {
  // the scene changes only touch small cards; the gradient behind them stays (bench/analyze has the bigger benchmark)
  const { analyzeVideo } = await import('../src/analyze.js');
  const d = tmp(), f = join(d, 'a.html');
  const card = (x, y, c, t) => `<div style="position:absolute;left:${x}px;top:${y}px;width:190px;padding:14px;border-radius:12px;background:${c};font:700 30px sans-serif;color:#fff">${t}<div style="height:10px;margin-top:10px;width:120px;background:#fff8;border-radius:5px"></div></div>`;
  writeFileSync(f, `<!doctype html><html data-width="640" data-height="360" data-fps="30"><head><style>body{margin:0;background:linear-gradient(135deg,#1d2b64,#5b247a);color:#fff}</style></head><body>
<main data-sequence>
<section class="scene" data-duration="2">${card(60, 60, '#e76f51', 'One')}</section>
<section class="scene" data-duration="2" data-transition="push-left 0.5">${card(360, 170, '#2a9d8f', 'Two')}</section>
<section class="scene" data-duration="2" data-transition="wipe-right 0.6">${card(80, 200, '#e9c46a', 'Three')}${card(380, 40, '#264653', 'Four')}</section>
<section class="scene" data-duration="1.5">${card(220, 120, '#8338ec', 'Five')}</section>
</main></body></html>`);
  const out = join(d, 'v.mp4');
  await render(f, { output: out, ...quiet });
  const r = await analyzeVideo(out, { output: join(d, 'an'), sheets: false, audio: false });
  assert.deepEqual(r.transitions.map((t) => t.type), ['push-left', 'wipe-right', 'cut'], JSON.stringify(r.transitions));
  // push 1.5-2.0, wipe 2.9-3.5, cut at 4.9
  for (const [t, at] of r.transitions.map((t, i) => [t, [1.75, 3.2, 4.9][i]])) assert.ok(Math.abs(t.at - at) <= 0.25, `${t.type} at ${t.at}`);
});

test('determinism: a line drawing on in a zoomed world is the same with 1 and 3 workers (no partial raster)', { skip }, async () => {
  // this exact page gave one frame that differed by a pixel or two with partial raster on
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, `<!doctype html><html data-width="1280" data-height="720" data-fps="30"><head><style>
body{background:#fbfaf6;color:#1e1e1e;font-family:Caveat}
.card{position:absolute;padding:24px 34px;font-size:44px;border:4px solid #1971c2;background:#fff}
</style></head><body>
<section class="scene" data-duration="4"><div id="world" style="position:absolute;left:0;top:0;width:2000px;height:1200px;transform-origin:0 0;transform:translate(-68.8534px,54.394px) scale(1.0885)">
<div class="card" id="c1" style="left:100px;top:100px" data-enter="fade 0.4 0.2">browser</div>
<p style="position:absolute;left:100px;top:320px;font-size:56px;margin:0;width:700px" data-enter="write 1 0.5">The address is <span id="ip">93.184.216.34</span> and it is <span>fast</span>, <span>really</span>.</p>
<svg viewBox="0 0 2000 1200" style="position:absolute;inset:0;width:2000px;height:1200px" data-sketch><rect x="900" y="100" width="300" height="160" fill="#ffd8a8" stroke="none" data-enter="draw 1 0.3"/><line x1="900" y1="400" x2="1200" y2="400" stroke="#1e1e1e" stroke-width="6" data-enter="draw 1 2"/></svg>
</div></section>
</body></html>`);
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 3, ...quiet });
  const fa = readdirSync(a).sort();
  const diff = fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x))));
  assert.deepEqual(diff, []);
});

test('code-window: ⟦marks⟧ on later lines wrap the right text and keep one element per line', { skip }, async () => {
  const d = tmp();
  mkdirSync(join(d, 'blocks'));
  copyFileSync(join(ROOT, 'blocks', 'code-window.html'), join(d, 'blocks', 'code-window.html'));
  const f = join(d, 'a.html');
  writeFileSync(f, page(`<section class="scene" data-duration="1"><gm-include src="blocks/code-window.html" lang="js">function f() {
  let timer;
  ⟦clearTimeout(timer);⟧
  timer = ⟦setTimeout⟧(go, 300);
}</gm-include></section>`));
  const r = await evalAt(f, 0.5, `({ marks: [...document.querySelectorAll('.gm-mark')].map((m) => [m.textContent, m.closest('.gm-line').dataset.line]), lines: document.querySelectorAll('.gm-line').length })`);
  assert.deepEqual(r, { marks: [['clearTimeout(timer);', '3'], ['setTimeout', '4']], lines: 5 });
});

test('check: a line through text is found (also dashed), not when an opaque panel covers it; SVG text is judged by its fill', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<svg viewBox="0 0 640 360" style="position:absolute;inset:0;width:640px;height:360px"><line x1="0" y1="60" x2="640" y2="60" stroke="#333" stroke-width="4"/><line x1="0" y1="262" x2="640" y2="262" stroke="#333" stroke-width="4" stroke-dasharray="12 6"/>
    <rect x="400" y="130" width="160" height="60" fill="#1c2333"/><text id="btn" x="480" y="170" text-anchor="middle" font-size="30" fill="#fff">Order</text></svg>
    <div style="position:absolute;left:20px;top:30px;width:300px;height:60px;background:#fff"><p id="hud" style="margin:0;font-size:30px;line-height:60px;color:#222">Step one</p></div>
    <p id="bad" style="position:absolute;left:340px;top:244px;margin:0;font-size:30px;color:#fff">Crossed out</p>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"'));
  const rep = await check(f);
  const by = (code) => rep.issues.filter((i) => i.code === code).map((i) => i.selector);
  assert.deepEqual(by('text-over-line'), ['#bad']);
  assert.deepEqual(by('low-contrast'), []);
});

test('timeline: a tween starting on a frame shows its start values there, even when float error puts the frame a hair early', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  // 0.1 + 0.2 = 0.30000000000000004: the third scene starts just after the frame at 0.3 s
  writeFileSync(f, page(`<main data-sequence><section class="scene" data-duration="0.1"></section><section class="scene" data-duration="0.2"></section>
    <section class="scene" id="c" data-duration="1"><b id="x" style="display:block">X</b></section></main>
    <script>gm.timeline('#c').fromTo('#x', { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0);</script>`));
  assert.equal(await evalAt(f, 0.3, `getComputedStyle(document.getElementById('x')).opacity`), '0');
});

test('timeline: fromTo with keyframes shows its from-values before it starts; hideBefore works with keyframes', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><b id="a" style="display:block">A</b><b id="b" style="display:block">B</b></div>
    <script>gm.timeline().fromTo('#a', { opacity: 0 }, { keyframes: [{ opacity: 1, duration: 0.5 }, { scale: 1.2, duration: 0.2 }] }, 1)
      .to('#b', { keyframes: [{ x: 50, duration: 0.5 }], hideBefore: true }, 1);</script>`));
  assert.deepEqual(JSON.parse(await evalAt(f, 0.5, `JSON.stringify([getComputedStyle(document.getElementById('a')).opacity, getComputedStyle(document.getElementById('b')).visibility])`)), ['0', 'hidden']);
  assert.deepEqual(JSON.parse(await evalAt(f, 2, `JSON.stringify([getComputedStyle(document.getElementById('a')).opacity, getComputedStyle(document.getElementById('b')).visibility])`)), ['1', 'visible']);
});

test('data-anchor keeps labels next to moving shapes (camera, chains, SVG text); travel rides an gm.connect arrow; 1 worker == 2', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<section class="scene" data-duration="2" style="position:absolute;inset:0;overflow:hidden">
    <div id="world" style="position:absolute;left:0;top:0;width:1000px;height:600px;font-size:24px">
      <svg viewBox="0 0 1000 600" width="1000" height="600" style="position:absolute;left:0;top:0" data-sketch>
        <rect id="r" x="60" y="80" width="200" height="120" fill="#fd0" stroke="#000" stroke-width="6"/>
        <text id="st" data-anchor="#r top 10" text-anchor="middle" font-size="24" fill="#fff">top</text></svg>
      <div id="b" style="position:absolute;left:600px;top:120px;width:120px;height:80px;background:#345"></div>
      <div id="l1" data-anchor="#r bottom 12" style="transform:translate(-50%,-50%)">under r</div>
      <div id="l2" data-anchor="#b right 10">right of b</div>
      <div id="l3" data-anchor="#l2 bottom-left 0">chained</div>
      <div id="pkg" style="position:absolute;width:20px;height:20px;background:#e60"></div>
    </div>
    <div id="ov" data-anchor="#b top 20" style="font-size:20px">over the stage</div>
    <p style="position:absolute;left:20px;top:300px;font-size:30px;margin:0"><span id="m0" data-sketch-mark="circle" data-sketch-mark-padding="0">word</span> <span id="m1" data-sketch-mark="circle">word</span></p>
  </section>
  <script>
    gm.timeline('#world').to('#b', { y: 200, x: -100, duration: 2, ease: 'linear' }, 0);
    const arrow = gm.connect('#r', '#b', { head: 'none' });
    gm.path.travel('#pkg', arrow, { stops: [[0, 0], [2, 1]], ease: 'linear' });
    gm.camera('#world').shot(0, { fit: ['#r', '#b'], padding: 20 }).shot(0.5, { fit: '#b', padding: 60, duration: 1 });
  </script>`));
  const v = await evalAt(f, 1, `(() => {
    const R = (s) => gm.rect(s, '#world'), S = (s) => document.querySelector(s).getBoundingClientRect();
    const g = R(document.querySelector('#r [data-gm-sketch-guide]')), l1 = R('#l1'), b = R('#b'), l2 = R('#l2'), l3 = R('#l3'), st = R('#st'), pkg = R('#pkg');
    const p = document.querySelector('.gm-connect path').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    const ov = S('#ov'), sb = S('#b');
    const mw0 = document.querySelector('#m0 .gm-sketch-mark path').getBBox().width, mw1 = document.querySelector('#m1 .gm-sketch-mark path').getBBox().width;
    return { l1gap: l1.y - (g.y + g.h), l1cx: l1.cx - g.cx, l2gap: l2.x - (b.x + b.w), l2cy: l2.cy - b.cy, l3: [l3.x - l2.x, l3.y - (l2.y + l2.h)], stgap: g.y - (st.y + st.h), stcx: st.cx - g.cx,
      pkg: [pkg.cx - (p[0] + p[2]) / 2, pkg.cy - (p[1] + p[3]) / 2], ov: [ov.left + ov.width / 2 - (sb.left + sb.width / 2), sb.top - (ov.top + ov.height)], marks: [mw0, mw1], issues: gm.inspect().issues.map((i) => i.code) };
  })()`);
  const px = 360 / 1080;
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
  // the visible edge of the sketched rect is half its 6px stroke outside the shape, then the 12px gap
  near(v.l1gap, 3 + 12 * px, 1, 'label under the sketched rect'); near(v.l1cx, 0, 1, 'centered under it (the centering translate is dropped)');
  near(v.l2gap, 10 * px, 1, 'label right of the moving box'); near(v.l2cy, 0, 1, 'vertically centered');
  near(v.l3[0], 0, 1, 'chained label lined up left'); near(v.l3[1], 0, 1, 'chained label right under');
  near(v.stgap, 3 + 10 * px, 2, 'SVG text above the rect'); near(v.stcx, 0, 2, 'SVG text centered');
  near(v.pkg[0], 0, 1.5, 'traveler halfway along the arrow (x)'); near(v.pkg[1], 0, 1.5, 'traveler halfway along the arrow (y)');
  near(v.ov[0], 0, 1.5, 'stage label centered over the zoomed world box'); near(v.ov[1], 20 * px, 1.5, 'stage label gap (after the camera)');
  assert.ok(v.marks[0] < v.marks[1] - 10, 'padding 0 circle is narrower: ' + v.marks);
  assert.deepEqual(v.issues.filter((c) => /anchor|script|connect/.test(c)), []);
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 2, ...quiet });
  const fa = readdirSync(a).sort();
  assert.equal(fa.length, 60);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x)))), []);
});

test('data-pulse scales on the beat grid and sets --beat; data-cuts can be written in beats', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence data-cuts="beats: 0 3"><section class="scene" id="a"><b id="p" data-pulse="beat 0.1" style="display:block">X</b></section><section class="scene" id="b" data-duration="1"></section></main>`,
    'data-width="640" data-height="360" data-fps="30" data-bpm="120" data-beat-offset="0.1"'));
  const at = (t) => evalAt(f, t, `JSON.stringify([document.getElementById('p').style.scale, document.getElementById('p').style.getPropertyValue('--beat'), gm.timing('#b').start])`).then(JSON.parse);
  const [s1, b1, start] = await at(0.6);
  assert.equal(start, 1.6); // beat 3 = 0.1 + 3 * 0.5
  assert.equal(+s1, 1.1); assert.equal(+b1, 1);
  const [s2] = await at(0.7);
  assert.ok(+s2 > 1 && +s2 < 1.1);
});

test('check: empty-start when the first half second shows only a gradient background, not when a title is there', { skip }, async () => {
  const d = tmp(), mk = (delay) => { const f = join(d, `e${delay}.html`); writeFileSync(f, `<!doctype html><html data-width="640" data-height="360" data-fps="30"><head><style>body{background:linear-gradient(135deg,#2a1b5c,#0b6e8a);color:#fff;font-family:sans-serif}</style></head><body><section class="scene" data-duration="2"><h1 data-enter="fade 0.3 ${delay}" style="font-size:60px;text-align:center;margin-top:120px">Hello</h1></section></body></html>`); return f; };
  assert.ok((await check(mk(0.7))).issues.some((i) => i.code === 'empty-start'));
  assert.ok(!(await check(mk(0))).issues.some((i) => i.code === 'empty-start'));
});

test('check: ghost-overlap when a crossfade stacks two headlines, not for a push', { skip }, async () => {
  const d = tmp(), mk = (tr) => { const f = join(d, `${tr}.html`); writeFileSync(f, page(`<main data-sequence><section class="scene" data-duration="2"><h1 style="font-size:70px;text-align:center;margin-top:120px">HTML IN</h1></section><section class="scene" data-duration="2" data-transition="${tr} 0.8"><h1 style="font-size:70px;text-align:center;margin-top:120px">VIDEO OUT</h1></section></main>`)); return f; };
  assert.ok((await check(mk('fade'))).issues.some((i) => i.code === 'ghost-overlap'));
  assert.ok(!(await check(mk('push-left'))).issues.some((i) => i.code === 'ghost-overlap'));
});

test('gm.connect: label at a place along the line and on a chosen side; attach points along a side (fromAt, "top 0.25", corners)', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="2" style="position:absolute;inset:0">
    <div id="a" style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:#345"></div>
    <div id="b" style="position:absolute;left:1000px;top:100px;width:200px;height:100px;background:#345"></div>
    <div id="c" style="position:absolute;left:100px;top:700px;width:200px;height:100px;background:#345"></div>
    <div id="e" style="position:absolute;left:1000px;top:700px;width:200px;height:100px;background:#345"></div></div>
    <script>
      gm.connect('#a', '#b', { head: 'none', class: 'c1', fromAt: 0.25, toAt: 0.75, label: { text: 'below', at: 0.25, side: 'below', offset: 20 } });
      gm.connect('#a', '#c', { head: 'none', class: 'c2', from: 'bottom 0.1', to: 'top-right' });
      gm.connect('#c', '#e', { sketch: true, class: 'c3', curve: 0.3, label: 'mid' });
      gm.connect('#c', '#e', { head: 'none', class: 'c4', label: { text: 'x', side: 'sideways' } });
    </script>`, 'data-width="1920" data-height="1080" data-fps="30"'));
  const v = await evalAt(f, 1, `(() => {
    const nums = (c) => document.querySelector('.' + c + ' path').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    const lab = (c) => { const t = document.querySelector('.' + c + ' text'); return { x: +t.getAttribute('x'), y: +t.getAttribute('y'), w: t.getBBox().width, h: t.getBBox().height }; };
    return { c1: nums('c1'), l1: lab('c1'), c2: nums('c2'), l3: lab('c3'), issues: gm.inspect().issues.map((i) => i.code) };
  })()`);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
  // fromAt 0.25 on the side the line leaves from (right of #a), toAt 0.75 on the side it enters (left of #b); gap 10
  near(v.c1[0], 310, 0.2, 'start x'); near(v.c1[1], 125, 0.2, 'start y'); near(v.c1[2], 990, 0.2, 'end x'); near(v.c1[3], 175, 0.2, 'end y');
  // the label a quarter of the way along, below the line: its top edge 20px under the line
  // (measured along the line and across it: its box clears the line by 20px)
  const L = Math.hypot(680, 50), tx = 680 / L, ty = 50 / L, dx = v.l1.x - 310, dy = v.l1.y - 125;
  near((dx * tx + dy * ty) / L, 0.25, 0.002, 'label at 0.25 along');
  near(dx * -ty + dy * tx - (ty * v.l1.w + tx * v.l1.h) / 2, 20, 0.5, 'label box 20px below the line');
  // 'bottom 0.1': a tenth of the way along the bottom side; 'top-right': the corner (gap on the diagonal)
  near(v.c2[0], 120, 0.2, 'bottom 0.1 x'); near(v.c2[1], 210, 0.2, 'bottom 0.1 y');
  near(v.c2[2], 300 + 7.07, 0.2, 'corner x'); near(v.c2[3], 700 - 7.07, 0.2, 'corner y');
  // a sketched curved arrow: the label sits at the middle of the curve (not pulled toward the head), outside the bend
  near(v.l3.x, 650, 2, 'sketched label at the middle');
  assert.ok(v.l3.y > 750 + 0.3 * 900 * 0.5, 'below the sagging curve: ' + v.l3.y);
  assert.ok(v.issues.includes('connect-label-side'), 'unknown side is reported');
});

test('cursor block: beat times, show="auto", lands on its target inside a zoomed camera world (no sized wrapper); 1 worker == 2', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence data-cuts="0 1" data-cut-align="middle" data-transition="fade 0.4">
    <section class="scene" style="position:absolute;inset:0;background:#222"></section>
    <section class="scene" id="s2" data-duration="4" style="position:absolute;inset:0;overflow:hidden">
      <div id="world" style="position:absolute;left:0;top:0;width:1200px;height:800px;background:#123">
        <div id="btn" style="position:absolute;left:400px;top:300px;width:100px;height:50px;background:#36f">Go</div>
        <gm-include src="${join(ROOT, 'blocks/cursor.html')}" points="100,100 #btn!" times="beats: 2 3" show="auto"></gm-include>
      </div>
    </section></main>
    <script>gm.camera('#world').shot(0, { center: { x: 450, y: 325 }, zoom: 2 });</script>`,
    'data-width="640" data-height="360" data-fps="30" data-bpm="60" data-beat-offset="0"'));
  const ctx = await openComposition(f, { mode: 'render' });
  const at = async (t) => { await ctx.page.seek(t); return ctx.page.evaluate(`(() => {
    const c = document.querySelector('#s2 .gmb-cursor'), r = c.getBoundingClientRect(), b = document.getElementById('btn').getBoundingClientRect();
    return { op: +getComputedStyle(c).opacity, x: r.left, y: r.top, bx: b.left + b.width / 2, by: b.top + b.height * 0.56, hover: document.getElementById('btn').hasAttribute('data-gm-hover'), issues: gm.inspect().issues.map((i) => i.code) };
  })()`); };
  let v1, v2, v3, v4;
  try { v1 = await at(1.5); v2 = await at(2.5); v3 = await at(3.2); v4 = await at(4.2); } finally { await ctx.page.close(); await ctx.server.close(); }
  // beats 2 and 3 are video times 2 s and 3 s (the scene itself starts at 0.8, half a transition before its cut)
  assert.equal(v1.op, 0, 'hidden before its first move');
  assert.equal(v2.op, 1, 'shown while it moves');
  assert.ok(Math.abs(v3.x - v3.bx) < 1 && Math.abs(v3.y - v3.by) < 1, 'on the button through the 2x camera: ' + JSON.stringify(v3));
  assert.ok(v3.hover, 'hover set on the target');
  assert.equal(v4.op, 0, 'hidden after its last point');
  assert.deepEqual(v3.issues.filter((c) => /cursor|script/.test(c)), []);
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 2, ...quiet });
  const fa = readdirSync(a).sort();
  assert.ok(fa.length > 100, 'frames: ' + fa.length);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x)))), []);
});

test('gm.chart.line: values and points at known times, holds, callouts enter on reach, head followed by a camera; 1 worker == 2', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<section class="scene" data-duration="3.5" style="position:absolute;inset:0;overflow:hidden">
    <div id="world" style="position:absolute;left:0;top:0;width:1400px;height:500px">
      <div id="c" style="position:absolute;left:0;top:0;width:1200px;height:400px">
        <b id="rider" data-point="head right 10" data-chart-text="value"></b>
        <i id="lab" data-point="head top 10" data-chart-text="label"></i>
        <div id="dip" data-point="Mar bottom 20">dip</div>
      </div>
    </div>
  </section>
  <script>
    window.ch = gm.chart.line('#c', { values: [0, 10, 5, 20], labels: 'Jan,Feb,Mar,Apr', delay: 0, duration: 3, holds: { Feb: 1 }, ease: 'linear',
      colors: { Mar: '#f44' }, rescale: true, axis: 'head' });
    gm.camera('#world').shot(0, { follow: ch.head, zoom: 1.2 }).shot(2.4, { fit: '#c', duration: 0.6 });
  </script>`));
  // timing: 2 s of drawing over 3 steps (0.667 s each) plus a 1 s hold at Feb
  const r = await evalAt(f, 0, `({ t: [0, 1, 2, 3].map((i) => ch.timeOf(i)), mar: ch.timeOf('Mar'), v: [ch.valueAt(1 / 3), ch.valueAt(1), ch.valueAt(1.5), ch.valueAt(7 / 3), ch.valueAt(9)], p: ch.progress(2), pt: ch.pointAt(1) })`);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ': ' + a + ' vs ' + b);
  [0, 2 / 3, 7 / 3, 3].forEach((x, i) => near(r.t[i], x, 0.002, 'reach time of point ' + i));
  near(r.mar, 7 / 3, 0.002, 'timeOf by label');
  near(r.v[0], 6.25, 0.01, 'value halfway to Feb (monotone curve)'); near(r.v[1], 10, 1e-6, 'held at Feb'); near(r.v[2], 10, 1e-6, 'still held');
  near(r.v[3], 5, 1e-6, 'at Mar'); near(r.v[4], 20, 1e-6, 'after the end');
  near(r.p, 1.5, 1e-6, 'progress halfway between Feb and Mar');
  assert.equal(r.pt.value, 10); assert.equal(r.pt.label, 'Feb');
  const at = (t) => evalAt(f, t, `(() => {
    const S = (s) => document.querySelector(s).getBoundingClientRect(), h = S('.gm-chart-head'), rd = S('#rider'), dip = document.querySelector('#dip');
    const p = ch.pointAt(1, gm.time - gm.timing('#c').start), c = S('#c'), k = c.width / 1200;
    return { head: [h.left + h.width / 2, h.top + h.height / 2], expect: [c.left + p.x * k, c.top + p.y * k], rider: document.querySelector('#rider').textContent, lab: document.querySelector('#lab').textContent,
      riderLeft: rd.left - (h.left + h.width / 2), dipOpacity: +getComputedStyle(dip).opacity, color: getComputedStyle(document.querySelector('#c')).getPropertyValue('--chart-color').trim(),
      line: document.querySelector('#c .gm-chart-line').getAttribute('d') || '', issues: gm.inspect().issues.map((i) => i.code) };
  })()`);
  const a = await at(1.2), b = await at(2.2), c = await at(3.2);
  near(a.head[0], a.expect[0], 1, 'head on Feb during the hold (x)'); near(a.head[1], a.expect[1], 1, 'head on Feb during the hold (y)');
  near(a.head[0], 320, 1, 'camera follows the head (centered)');
  assert.equal(a.rider, '10'); assert.equal(a.lab, 'Feb');
  assert.ok(a.riderLeft > 0, 'rider sits right of the head');
  assert.equal(a.dipOpacity, 0, 'callout hidden before the line reaches Mar');
  assert.equal(b.color, '#f44', 'head takes the color of the segment into Mar');
  assert.equal(c.dipOpacity, 1, 'callout shown after it entered');
  assert.equal(c.rider, '20');
  assert.equal(c.line.split('C').length - 1, 3, 'three segments drawn at the end');
  assert.deepEqual(c.issues.filter((x) => /chart|script|anchor/.test(x)), []);
  const o1 = join(d, 'o1'), o2 = join(d, 'o2');
  await render(f, { output: o1, workers: 1, ...quiet });
  await render(f, { output: o2, workers: 2, ...quiet });
  const fa = readdirSync(o1).sort();
  assert.equal(fa.length, 105);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(o1, x)).equals(readFileSync(join(o2, x)))), []);
});

test('morph: inline pairs fly; different content hands over (old out, then new in); same content keeps both solid', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence data-transition="morph 1 linear">
    <section class="scene" data-duration="2"><p style="font-size:40px;margin:40px">Total <span id="a1" data-morph="n">48,000</span></p><div id="c1" data-morph="c" style="position:absolute;left:20px;top:200px;width:80px;height:80px;background:#f55">GO</div></section>
    <section class="scene" data-duration="2"><p style="font-size:30px;margin:260px 0 0 300px">1,200 → <b id="b1" data-morph="n">48,000 users</b></p><div id="c2" data-morph="c" style="position:absolute;left:500px;top:40px;width:80px;height:80px;background:#f55">GO</div></section>
  </main>`));
  const at = (t) => evalAt(f, t, `JSON.stringify(['a1', 'b1', 'c1', 'c2'].map((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: r.left + r.width / 2, y: r.top + r.height / 2, f: +cs.opacity, disp: cs.display }; }))`).then(JSON.parse);
  const [a0] = await at(0.5);
  assert.equal(a0.disp, 'inline-block'); // an inline <span> cannot be moved by translate/scale
  const [a, b, c1, c2] = await at(1.5); // halfway through the transition (it runs 1 to 2)
  assert.ok(Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2, 'the pair flies together');
  assert.ok(Math.abs(a.x - a0.x) > 50, 'the old text left its place');
  assert.ok(a.f < 0.2, 'old text mostly gone halfway: ' + a.f);
  assert.equal(c1.f, 1); assert.equal(c2.f, 1); // same content: no hand-over fade
  assert.ok(Math.abs(c1.x - c2.x) < 2);
  const [a2, b2] = await at(1.1);
  assert.ok(a2.f > 0.8 && b2.f < 0.05, 'early: old solid, new hidden ' + a2.f + ' ' + b2.f);
  const [, b3] = await at(1.85);
  assert.ok(b3.f > 0.95, 'late: new one solid ' + b3.f);
});

test('fly: starts on the source box (measured where both rest, also in a later scene) and lands home', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence>
    <section class="scene" id="s1" data-duration="1"></section>
    <section class="scene" id="s2" data-duration="3">
      <div data-enter="fade-up 0.6"><div id="slot" style="position:absolute;left:400px;top:250px;width:200px;height:60px;background:#345"></div></div>
      <div id="ev" style="position:absolute;left:50%;top:30%;width:100px;height:100px;transform:translate(-50%,-50%);background:#48f"></div>
      <div id="sq" style="position:absolute;left:40px;top:40px;width:50px;height:50px;background:#f84"></div>
      <div id="src2" style="position:absolute;left:500px;top:40px;width:100px;height:100px"></div>
    </section></main>
    <script>gm.fly('#ev', { from: '#slot', at: 1, duration: 1, ease: 'linear' }); gm.timeline('#s2').fly('#sq', { from: '#src2', duration: 1, ease: 'linear', hideBefore: false }, 0.5);</script>`));
  const at = (t) => evalAt(f, t, `JSON.stringify(['ev', 'slot', 'sq'].map((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, vis: getComputedStyle(e).visibility }; }))`).then(JSON.parse);
  const [ev0, , sq0] = await at(1.5); // s2 starts at 1: ev waits hidden, sq sits on its source
  assert.equal(ev0.vis, 'hidden');
  assert.ok(Math.abs(sq0.cx - 550) < 1 && Math.abs(sq0.cy - 90) < 1 && Math.abs(sq0.w - 100) < 1, JSON.stringify(sq0));
  const [ev, slot] = await at(2);
  assert.equal(ev.vis, 'visible');
  assert.ok(Math.abs(ev.cx - slot.cx) < 1 && Math.abs(ev.cy - slot.cy) < 1, JSON.stringify([ev, slot]));
  assert.ok(Math.abs(ev.h - 60) < 1 && Math.abs(ev.w - 60) < 1, 'other proportions: scaled evenly to fit inside the source ' + JSON.stringify(ev));
  const [ev2, , sq2] = await at(3.5);
  assert.ok(Math.abs(ev2.cx - 320) < 1 && Math.abs(ev2.cy - 108) < 1 && Math.abs(ev2.w - 100) < 1, JSON.stringify(ev2));
  assert.ok(Math.abs(sq2.cx - 65) < 1 && Math.abs(sq2.w - 50) < 1);
});

test('morph hand-over and fly render the same with 1 and 2 workers', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence data-transition="morph 0.6">
    <section class="scene" data-duration="1"><div id="g" data-morph="g" style="position:absolute;left:40px;top:40px;font-size:60px">&lt;/&gt;</div><div id="slot" style="position:absolute;left:400px;top:200px;width:160px;height:60px;background:#345"></div><div id="ev" style="position:absolute;left:60px;top:220px;width:90px;height:90px;background:#48f"></div></section>
    <section class="scene" data-duration="1"><svg data-morph="g" viewBox="0 0 10 10" style="position:absolute;left:300px;top:120px;width:120px;height:120px"><circle cx="5" cy="5" r="5" fill="#fc3"/></svg></section>
  </main><script>gm.fly('#ev', { from: '#slot', at: 0.1, duration: 0.5 });</script>`));
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 2, ...quiet });
  const fa = readdirSync(a).sort();
  assert.ok(fa.length >= 40);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x)))), []);
});

test('speed: idle enter/exit and finished from-only CSS animations hold no layer, still blobs bake to an image, moving ones to a canvas; 1 worker equals 3', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<style>.blob{position:absolute;width:300px;height:300px;border-radius:50%;filter:blur(60px)}
    @keyframes drift{to{translate:120px 40px}} @keyframes dim{to{opacity:.4}}
    #cssin{animation:fade-up .3s .2s both} #cssdim{animation:dim .3s both}</style>
    <main data-sequence><section class="scene" id="s1" data-duration="2" data-exit="blur 0.5">
      <div class="blob" id="still" style="left:-60px;top:-80px;background:#3050c0"></div>
      <div class="blob" id="moving" style="right:-60px;bottom:-80px;background:#c03080;animation:drift 2s linear both"></div>
      <p id="late" style="font-size:40px" data-enter="fade-up 0.4 1">late</p>
      <p id="cssin">css in</p><p id="cssdim">css dim</p>
    </section><section class="scene" data-duration="1"><p>next</p></section></main>`));
  const at = (t) => evalAt(f, t, `(() => { const s = document.getElementById('s1'), $ = (id) => document.getElementById(id); return { anims: s.getAnimations().length, filter: getComputedStyle(s).filter, late: +getComputedStyle($('late')).opacity,
    still: document.querySelector('#still > [data-gm-internal]')?.localName, moving: document.querySelector('#moving > [data-gm-internal]')?.localName,
    cssin: [$('cssin').getAnimations().length, +getComputedStyle($('cssin')).opacity], cssdim: [$('cssdim').getAnimations().length, +getComputedStyle($('cssdim')).opacity] }; })()`);
  const start = await at(0.1);
  assert.equal(start.cssin[1], 0, 'a CSS animation still holds its first keyframe during its delay');
  const mid = await at(0.5);
  assert.deepEqual(mid.cssin, [0, 1], 'a from-only CSS animation that is over is no longer in effect, and ends on the element\'s own style');
  assert.deepEqual(mid.cssdim, [1, 0.4], 'a CSS animation with a real end state keeps it');
  assert.equal(mid.anims, 0, 'the exit has not started: no live animation on the scene');
  assert.equal(mid.filter, 'none');
  assert.equal(mid.late, 0, 'a delayed enter still holds its first keyframe');
  assert.equal(mid.still, 'img');
  assert.equal(mid.moving, 'canvas');
  const out = await at(1.75);
  assert.match(out.filter, /blur/, 'the exit plays');
  assert.equal(out.late, 1);
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 3, ...quiet });
  const fa = readdirSync(a).sort();
  assert.ok(fa.length >= 90);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x)))), []);
});

// Natural motion (gm.motion 'natural', the default) vs classic (<html data-motion="classic">)
async function sampleAt(file, times, expr) {
  const ctx = await openComposition(file, { mode: 'render' });
  try { const out = []; for (const t of times) { await ctx.page.seek(t); out.push(await ctx.page.evaluate(expr)); } return out; } finally { await ctx.page.close(); await ctx.server.close(); }
}

test('natural motion: data-enter springs (pop overshoots, fade does not), duration grows with size, explicit ease wins; classic unchanged', { skip }, async () => {
  const d = tmp(), body = `<div data-duration="3">
    <div id="pop" style="position:absolute;left:20px;top:20px;width:100px;height:60px;background:#48f" data-enter="pop"></div>
    <div id="fade" style="position:absolute;left:140px;top:20px;width:100px;height:60px;background:#48f" data-enter="fade"></div>
    <div id="small" style="position:absolute;left:20px;top:120px;width:40px;height:40px;background:#f84" data-enter="slide-left"></div>
    <div id="big" style="position:absolute;left:0;top:200px;width:600px;height:100px;background:#f84" data-enter="slide-left"></div>
    <div id="given" style="position:absolute;left:300px;top:20px;width:100px;height:60px;background:#4f8" data-enter="pop 0.5 out-expo"></div></div>`;
  const fN = join(d, 'n.html'), fC = join(d, 'c.html');
  writeFileSync(fN, page(body));
  writeFileSync(fC, page(body, 'data-width="640" data-height="360" data-fps="30" data-motion="classic"'));
  const expr = `JSON.stringify(Object.fromEntries(['pop', 'fade', 'small', 'big', 'given'].map((id) => { const e = document.getElementById(id), a = e.getAnimations()[0], t = a && a.effect.getTiming(); return [id, { dur: t ? t.duration : null, ease: t ? t.easing : null, scale: getComputedStyle(e).scale, op: +getComputedStyle(e).opacity }]; })))`;
  const nat = (await sampleAt(fN, [0, 0.1, 0.15, 0.2, 0.25, 0.3], expr)).map(JSON.parse);
  const cls = (await sampleAt(fC, [0, 0.2], expr)).map(JSON.parse);
  assert.equal(cls[0].pop.dur, 600);
  assert.match(cls[0].pop.ease, /^cubic-bezier\(0\.16, ?1, ?0\.3, ?1\)$/);
  assert.equal(cls[0].big.dur, 600);
  assert.equal(nat[0].pop.ease, null, 'natural: a scale that overshoots is driven from the clock (inline), not an animation');
  assert.match(nat[0].fade.ease, /^linear\(/, 'natural: a sampled spring');
  assert.ok(nat.some((s) => parseFloat(s.pop.scale) > 1.01), 'pop overshoots a little: ' + nat.map((s) => s.pop.scale));
  assert.ok(nat.every((s) => s.pop.scale === 'none' || parseFloat(s.pop.scale) < 1.08), 'only a little');
  assert.ok(nat.every((s) => s.fade.op <= 1));
  assert.ok(nat[0].big.dur > nat[0].small.dur, 'a bigger slide takes longer ' + nat[0].big.dur + ' ' + nat[0].small.dur);
  assert.ok(nat[0].small.dur >= 600 * 0.85 - 1 && nat[0].big.dur <= 600 * 1.3 + 1);
  assert.equal(nat[0].given.dur, 500, 'a given duration is kept');
  assert.match(nat[0].given.ease, /^cubic-bezier\(0\.16/, 'a given ease is kept');
});

test('natural motion: timeline moves gather speed and settle, back-to-back tweens carry speed, diagonal moves arc (arc: 0 = straight), explicit ease wins', { skip }, async () => {
  const d = tmp(), body = `<div data-duration="4">
    <i id="m" style="position:absolute;left:0;top:0;width:10px;height:10px;background:#fff"></i>
    <i id="c" style="position:absolute;left:0;top:100px;width:10px;height:10px;background:#fff"></i>
    <i id="a" style="position:absolute;left:0;top:200px;width:10px;height:10px;background:#fff"></i>
    <i id="s" style="position:absolute;left:0;top:250px;width:10px;height:10px;background:#fff"></i>
    <i id="l" style="position:absolute;left:0;top:300px;width:10px;height:10px;background:#fff"></i></div>
    <script>
      gm.timeline().to('#m', { x: 300, duration: 1 }, 0);
      gm.timeline().to('#c', { x: 100, duration: 1 }, 0).to('#c', { x: 200, duration: 1 });
      gm.timeline().to('#a', { x: 300, y: 100, duration: 1 }, 0);
      gm.timeline().to('#s', { x: 300, y: 100, duration: 1, arc: 0 }, 0);
      gm.timeline().to('#l', { x: 300, duration: 1, ease: 'linear' }, 0);
    </script>`;
  const fN = join(d, 'n.html'), fC = join(d, 'c.html');
  writeFileSync(fN, page(body));
  writeFileSync(fC, page(body, 'data-width="640" data-height="360" data-fps="30" data-motion="classic"'));
  const expr = `JSON.stringify(Object.fromEntries(['m', 'c', 'a', 's', 'l'].map((id) => { const m = new DOMMatrix(getComputedStyle(document.getElementById(id)).transform); return [id, [Math.round(m.e * 100) / 100, Math.round(m.f * 100) / 100]]; })))`;
  const T = [0.1, 0.5, 0.95, 1, 1.05, 2.5];
  const [n01, n05, n095, n1, n105, nEnd] = (await sampleAt(fN, T, expr)).map(JSON.parse);
  const [c01, , c095, c1] = (await sampleAt(fC, T, expr)).map(JSON.parse);
  // classic: power1.out (an "out" curve: fast at the start), stops dead between back-to-back tweens
  assert.ok(Math.abs(c01.m[0] - 300 * 0.19) < 3, 'classic power1.out ' + c01.m[0]);
  assert.ok(c1.c[0] - c095.c[0] < 1, 'classic: stops before the joint ' + c095.c[0] + ' ' + c1.c[0]);
  assert.ok(Math.abs(c01.a[1] / c01.a[0] - 1 / 3) < 0.01, 'classic: straight line');
  // natural: gathers speed (slower start than power1.out), lands exactly, settles
  assert.ok(n01.m[0] < c01.m[0] * 0.6, 'natural move starts gently ' + n01.m[0]);
  assert.equal(nEnd.m[0], 300);
  assert.ok(n1.c[0] - n095.c[0] > 3 && n105.c[0] - n1.c[0] > 3, 'natural: speed carried through the joint ' + [n095.c[0], n1.c[0], n105.c[0]]);
  assert.ok(Math.abs(n1.c[0] - 100) < 0.5, 'the joint is still on the key');
  assert.equal(nEnd.c[0], 200);
  assert.ok(n05.a[1] < n05.s[1] - 10, 'diagonal move bends up ' + n05.a[1] + ' vs straight ' + n05.s[1]);
  assert.ok(Math.abs(n05.s[1] / n05.s[0] - 1 / 3) < 0.01, 'arc: 0 stays straight');
  assert.deepEqual([nEnd.a, nEnd.s], [[300, 100], [300, 100]]);
  assert.equal(n05.l[0], 150, 'an explicit ease is kept');
});

test('natural motion: staggers vary a little (seeded, first and last on time); renders the same with 1 and 2 workers', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="2"><div id="row" data-enter="fade-up 0.5" data-stagger="0.1" style="display:flex;gap:10px;padding:40px">${'<b style="width:50px;height:50px;background:#fc3"></b>'.repeat(6)}</div>
    <div id="cards" style="position:absolute;top:200px;left:40px;display:flex;gap:10px">${'<i class="k" style="width:50px;height:50px;background:#4cf"></i>'.repeat(5)}</div>
    <div id="fl" style="position:absolute;left:500px;top:40px;width:80px;height:50px;background:#f48"></div><div id="src" style="position:absolute;left:40px;top:280px;width:40px;height:25px"></div></div>
    <script>gm.timeline().from('.k', { y: 60, opacity: 0, stagger: 0.1 }, 0.2); gm.fly('#fl', { from: '#src', at: 0.6 });</script>`));
  const read = () => sampleAt(f, [0], `JSON.stringify([...document.querySelectorAll('#row > b')].map((e) => e.getAnimations()[0].effect.getTiming().delay))`).then((r) => JSON.parse(r[0]));
  const delays = await read();
  assert.equal(delays[0], 0);
  assert.ok(Math.abs(delays[5] - 500) < 1e-6, 'last on time ' + delays[5]);
  assert.ok(delays.slice(1, 5).some((v, i) => Math.abs(v - 100 * (i + 1)) > 2), 'interior pieces vary ' + delays);
  assert.ok(delays.slice(1, 5).every((v, i) => Math.abs(v - 100 * (i + 1)) <= 20 + 1e-6), 'by at most 20% of the step ' + delays);
  assert.deepEqual(await read(), delays, 'the same every time');
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, workers: 1, ...quiet });
  await render(f, { output: b, workers: 2, ...quiet });
  const fa = readdirSync(a).sort();
  assert.ok(fa.length >= 55);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(a, x)).equals(readFileSync(join(b, x)))), []);
});

// A world on a grid with cards: moved by back-to-back camera shots (robotic) or by one long eased move (smooth).
const motionWorld = `<div id="stage" data-duration="4" style="position:absolute;inset:0;overflow:hidden"><div id="world" style="position:absolute;left:0;top:0;width:1800px;height:1000px;transform-origin:0 0;background-image:linear-gradient(#2a3550 2px,transparent 2px),linear-gradient(90deg,#2a3550 2px,transparent 2px);background-size:40px 40px">
  ${[[80, 80, 'Plan'], [700, 120, 'Build'], [1300, 500, 'Ship'], [400, 700, 'Learn']].map(([x, y, t], i) => `<div id="c${i + 1}" style="position:absolute;left:${x}px;top:${y}px;width:200px;height:120px;border-radius:12px;background:#f4f1ea;color:#111;font:700 30px sans-serif;display:flex;align-items:center;justify-content:center">${t}</div>`).join('')}</div></div>`;

test('analyze --motion: camera stops and strobing in a robotic render, a smooth one scores higher; deterministic; strips of the busiest moments', { skip }, async () => {
  const { analyzeMotion, motionStrips } = await import('../src/analyze.js');
  const d = tmp(), fr = join(d, 'robotic.html'), fs = join(d, 'smooth.html');
  writeFileSync(fr, page(`${motionWorld}<script>gm.camera('#world').shot(0, { fit: '#c1', padding: 100, duration: 0 }).shot(0.4, { fit: '#c2', padding: 100, duration: 0.8 }).shot(1.2, { fit: '#c3', padding: 100, duration: 0.8 }).shot(2, { fit: '#c4', padding: 100, duration: 0.8 }).shot(2.8, { fit: '#c1', padding: 100, duration: 0.8 });</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="4" data-motion="classic"'));
  writeFileSync(fs, page(`${motionWorld}<script>gm.timeline('#stage').fromTo('#world', { x: 0, y: 0 }, { x: -1100, y: -600, duration: 3.8, ease: 'in-out-sine' }, 0.1);</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="4"'));
  const vr = join(d, 'robotic.mp4'), vs = join(d, 'smooth.mp4');
  await render(fr, { output: vr, ...quiet });
  await render(fs, { output: vs, motionBlur: 4, ...quiet });
  const r = await analyzeMotion(vr, { keepEnergy: true }), s = await analyzeMotion(vs);
  assert.ok(r.camera.stops >= 2, `camera stops between shots: ${JSON.stringify(r.camera)}`);
  assert.equal(s.camera.stops, 0, 'one long move does not stop');
  assert.ok(r.blur.fastFrames >= 10 && r.blur.blurredShare <= 0.2, `fast frames strobe: ${JSON.stringify(r.blur)}`);
  assert.ok(s.naturalness - r.naturalness >= 3, `smooth ${s.naturalness} vs robotic ${r.naturalness}`);
  const again = await analyzeMotion(vr);
  assert.deepEqual({ ...again, seconds: 0 }, { ...r, seconds: 0 }, 'the same video gives the same report');
  const strips = await motionStrips(vr, { output: join(d, 'strips'), energy: r.energy, fps: r.fps, count: 3 });
  assert.equal(strips.length, 3);
  for (const st of strips) assert.ok(readFileSync(st.file).subarray(1, 4).toString() === 'PNG' && st.end - st.start <= 1.01);
  for (let i = 1; i < strips.length; i++) assert.ok(strips[i].start >= strips[i - 1].end - 1e-6, 'windows do not overlap');
});

test('check: robotic motion warnings (camera-stop, fast-no-blur, straight-move, same-ease) in classic motion, none for smooth motion', { skip }, async () => {
  const d = tmp(), fr = join(d, 'robotic.html'), fs = join(d, 'smooth.html');
  const dots = [1, 2, 3, 4, 5].map((i) => `<i id="d${i}" style="position:absolute;left:30px;top:${30 + i * 40}px;width:60px;height:30px;background:#ff5a36"></i>`).join('');
  writeFileSync(fr, page(`${motionWorld}${dots}<script>gm.camera('#world').shot(0, { fit: '#c1', padding: 100, duration: 0 }).shot(0.4, { fit: '#c2', padding: 100, duration: 0.8, ease: 'power2.out' }).shot(1.2, { fit: '#c3', padding: 100, duration: 0.8, ease: 'power2.out' }).shot(2, { fit: '#c4', padding: 100, duration: 0.8, ease: 'power2.out' });
    const tl = gm.timeline('#stage');
    ${[1, 2, 3, 4, 5].map((i) => `tl.to('#d${i}', { x: 300, y: 150, duration: 0.8, ease: 'power2.out' }, ${0.2 * i}); tl.to('#d${i}', { x: 0, y: 0, duration: 0.5, ease: 'power2.out' }, ${2 + 0.2 * i});`).join('\n')}</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="4" data-motion="classic"'));
  writeFileSync(fs, page(`${motionWorld}<script>gm.timeline('#stage').fromTo('#world', { x: 0, y: 0 }, { x: -600, y: -300, duration: 3.8, ease: 'in-out-sine' }, 0.1);</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="4"'));
  const codes = async (f) => [...new Set((await check(f)).issues.map((i) => i.code))];
  const rep = await check(fr), rc = [...new Set(rep.issues.map((i) => i.code))];
  for (const c of ['camera-stop', 'fast-no-blur', 'straight-move', 'same-ease']) assert.ok(rc.includes(c), `${c} in ${rc.join(', ')}`);
  // style, not faults: reported as notes, so they never block or nag like a warning
  for (const i of rep.issues.filter((x) => ['camera-stop', 'fast-no-blur', 'straight-move', 'same-ease'].includes(x.code))) assert.equal(i.severity, 'info', i.code);
  assert.ok(rep.notes >= 4 && /style note/.test(formatReport(rep)));
  const sc = await codes(fs);
  for (const c of ['camera-stop', 'fast-no-blur', 'straight-move', 'same-ease']) assert.ok(!sc.includes(c), `no ${c} for smooth motion (${sc.join(', ')})`);
});

// natural camera (data-motion natural, the default): runs of back-to-back shots, follow lag, breathing, zoom overshoot, depth
async function seekEach(file, times, expr) {
  const ctx = await openComposition(file, { mode: 'render' });
  try { const out = []; for (const t of times) { await ctx.page.seek(t); out.push(await ctx.page.evaluate(expr)); } return out; } finally { await ctx.page.close(); await ctx.server.close(); }
}
const camExpr = `(() => { const w = document.querySelector('#world'), m = new DOMMatrix(getComputedStyle(w).transform), z = Math.hypot(m.a, m.b);
  const f = gm.__cameraFocus()[0], bg = document.querySelector('#bg'), pl = document.querySelector('#pl');
  return { cx: (320 - m.e) / z, cy: (180 - m.f) / z, z, focus: f && !f.overview ? [(f.l + f.r) / 2, (f.t + f.b) / 2, f.t] : null, bg: bg ? bg.style.transform : null, pl: pl ? pl.style.transform : null }; })()`;
const speeds = (rows) => rows.slice(1).map((r, i) => Math.hypot(r.cx - rows[i].cx, r.cy - rows[i].cy) * r.z + Math.abs(Math.log(r.z / rows[i].z)) * 367);

test('natural camera: back-to-back shots flow through without stopping, the run ends framed exactly, a fast zoom settles after a slight overshoot, background layers get depth; classic unchanged; 1 worker == 2', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html'), fc = join(d, 'c.html');
  const body = `<section class="scene" data-duration="5.5" style="position:absolute;inset:0;overflow:hidden">
    <div id="bg" style="position:absolute;inset:0;background:radial-gradient(circle at 30% 40%,#335,#111)"></div>
    <div id="pl" data-parallax="0.3" style="position:absolute;inset:0"></div>
    <div id="world" style="position:absolute;left:0;top:0;width:2400px;height:1400px">
      <div id="a" style="position:absolute;left:100px;top:100px;width:200px;height:120px;background:#1971c2"></div>
      <div id="b" style="position:absolute;left:900px;top:300px;width:200px;height:120px;background:#e8590c"></div>
      <div id="c" style="position:absolute;left:1700px;top:200px;width:200px;height:120px;background:#2f9e44"></div>
      <div id="d" style="position:absolute;left:1500px;top:1000px;width:200px;height:120px;background:#ae3ec9"></div>
      <div id="e" style="position:absolute;left:1580px;top:1050px;width:24px;height:18px;background:#fff"></div>
    </div></section>
    <script>gm.camera('#world').shot(0, { fit: '#a' }).shot(1, { fit: '#b', duration: 0.8 }).shot(1.8, { fit: '#c', duration: 0.8 }).shot(2.6, { fit: '#d', duration: 0.8 }).shot(4.2, { fit: '#e', duration: 0.5 });</script>`;
  writeFileSync(f, page(body));
  writeFileSync(fc, page(body, 'data-width="640" data-height="360" data-fps="30" data-motion="classic"'));
  const times = Array.from({ length: 79 }, (_, i) => 1 + i / 30); // 1 s .. 3.6 s, every frame
  const nat = await seekEach(f, times, camExpr), cla = await seekEach(fc, times, camExpr);
  const sn = speeds(nat), sc = speeds(cla), at = (s, t) => s[Math.round((t - 1) * 30) - 1];
  const peakN = Math.max(...sn), peakC = Math.max(...sc);
  for (const [t, k] of [[1.8, 0.3], [2.6, 0.1]]) { // at 2.6 s the path turns back (b, c, d): it slows to round the corner, no stop
    assert.ok(at(sn, t) > k * peakN, `natural: still moving at ${t}s (${at(sn, t).toFixed(1)} vs peak ${peakN.toFixed(1)} px/frame)`);
    assert.ok(at(sc, t) < 0.05 * peakC, `classic: stops at ${t}s (${at(sc, t).toFixed(1)} vs peak ${peakC.toFixed(1)})`);
  }
  assert.ok(peakN < peakC, 'one continuous move peaks lower than four separate ones');
  // the run ends at rest, framed as asked: #d centered, the default 60 px padding (within the breathing drift, ~1 px)
  const [held, before, arrive, settled] = await seekEach(f, [4, 4.69, 4.7, 5.1], camExpr);
  assert.ok(Math.abs(held.focus[0] - 320) < 1.5 && Math.abs(held.focus[1] - 180) < 1.5 && Math.abs(held.focus[2] - 60) < 1.5, 'framed: ' + JSON.stringify(held.focus));
  assert.match(held.bg, /^translate\(.+\) scale\(1\.09\)$/, 'background layer drifts with the camera');
  assert.doesNotMatch(held.pl, /1\.09/, 'data-parallax keeps its own depth');
  // fast zoom onto #e (x6.7 in 0.5 s): a touch past at the arrival, exact once settled
  const zE = Math.min(520 / 24, 240 / 18);
  assert.ok(arrive.z > zE * 1.015 && arrive.z < zE * 1.03, 'overshoot at the arrival: ' + arrive.z + ' vs ' + zE);
  assert.ok(before.z < arrive.z, 'still zooming in just before');
  assert.ok(Math.abs(settled.z - zE) < 1e-3, 'settled: ' + settled.z);
  const [cArrive, cHeld] = await seekEach(fc, [4.7, 4], camExpr);
  assert.ok(Math.abs(cArrive.z - zE) < 1e-3, 'classic: no overshoot');
  assert.equal(cHeld.bg, '', 'classic: background stays still');
  const shots = (await seekEach(f, [0], 'gm.__cameraShots()'))[0];
  assert.ok(Math.abs(shots[4].arrive - 4.925) < 1e-6, 'the zoom shot is at rest after it settles: ' + shots[4].arrive);
  const o1 = join(d, 'o1'), o2 = join(d, 'o2');
  await render(f, { output: o1, workers: 1, ...quiet });
  await render(f, { output: o2, workers: 2, ...quiet });
  const fa = readdirSync(o1).sort();
  assert.equal(fa.length, 165);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(o1, x)).equals(readFileSync(join(o2, x)))), []);
});

test('natural camera: follow trails a moving element and settles on it (lag: 0 and classic lock on); 1 worker == 2', { skip }, async () => {
  const d = tmp();
  const mk = (name, shot, attrs) => {
    const f = join(d, name);
    writeFileSync(f, page(`<section class="scene" data-duration="3" style="position:absolute;inset:0;overflow:hidden">
      <div id="world" style="position:absolute;left:0;top:0;width:1400px;height:400px"><div id="m" style="position:absolute;left:0;top:0;width:40px;height:40px;background:#fc3"></div></div></section>
      <script>gm.path.travel('#m', 'M120 180 L920 180', { stops: [[0.5, 0], [1.5, 1]], ease: 'linear' }); gm.camera('#world').shot(0, ${shot});</script>`, attrs));
    return f;
  };
  const expr = `(() => { const r = document.querySelector('#m').getBoundingClientRect(); return { dx: r.left + r.width / 2 - 320, dy: r.top + r.height / 2 - 180, cam: ${camExpr} }; })()`;
  const f = mk('a.html', `{ follow: '#m' }`);
  const [s0, s1, mid, late] = await seekEach(f, [0.5, 0.5 + 1 / 30, 1.0, 2.5], expr);
  assert.ok(mid.dx > 40 && mid.dx < 141, 'the camera trails: the element leads by ' + mid.dx);
  assert.ok(Math.abs(late.dx) < 1.5 && Math.abs(late.dy) < 1.5, 'settled on it a second after it stops: ' + JSON.stringify(late));
  assert.ok((s1.cam.cx - s0.cam.cx) * 30 < 0.5 * 800, 'the camera picks up speed gradually (inertia)');
  const [rigid] = await seekEach(mk('b.html', `{ follow: '#m', lag: 0 }`), [1.0], expr);
  assert.ok(Math.abs(rigid.dx) < 1.5, 'lag: 0 locks on: ' + rigid.dx);
  const [cl] = await seekEach(mk('c.html', `{ follow: '#m' }`, 'data-width="640" data-height="360" data-fps="30" data-motion="classic"'), [1.0], expr);
  assert.ok(Math.abs(cl.dx) < 0.5, 'classic locks on: ' + cl.dx);
  const o1 = join(d, 'o1'), o2 = join(d, 'o2');
  await render(f, { output: o1, workers: 1, ...quiet });
  await render(f, { output: o2, workers: 2, ...quiet });
  const fa = readdirSync(o1).sort();
  assert.equal(fa.length, 90);
  assert.deepEqual(fa.filter((x) => !readFileSync(join(o1, x)).equals(readFileSync(join(o2, x)))), []);
});

// --- motion blur (auto by default in natural motion) ---
import { resolveMotionBlur } from '../src/render.js';
import { imageLength } from '../src/ffmpeg.js';

test('motion blur: flag values', () => {
  assert.deepEqual(resolveMotionBlur(undefined), { mode: 'off', samples: 1, why: 'default' }); // auto is opt-in until validated
  assert.equal(resolveMotionBlur(undefined, { motion: 'classic' }).mode, 'off');
  assert.equal(resolveMotionBlur('auto', { motion: 'classic' }).mode, 'auto');
  assert.equal(resolveMotionBlur('off').mode, 'off');
  assert.equal(resolveMotionBlur(false).mode, 'off');
  assert.equal(resolveMotionBlur('0').mode, 'off');
  assert.deepEqual(resolveMotionBlur('8'), { mode: 'fixed', samples: 8 });
  assert.throws(() => resolveMotionBlur('lots'), /Bad --motion-blur/);
});

test('motion blur: the image splitter finds whole JPEG and PNG images in a stream', () => {
  const d = tmp();
  for (const f of ['a.jpg', 'a.png']) execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=1:duration=1', '-frames:v', '1', join(d, f)]);
  for (const [f, png] of [['a.jpg', false], ['a.png', true]]) {
    const b = readFileSync(join(d, f));
    assert.equal(imageLength(b, png), b.length);
    assert.equal(imageLength(Buffer.concat([b, b.subarray(0, 10)]), png), b.length);
    assert.equal(imageLength(b.subarray(0, b.length - 1), png), 0);
  }
});

// a fast box (crosses the frame in under a second), a slow box and a static label; a typed line
const blurPage = (attrs = '') => page(`<section data-duration="1.4" style="position:absolute;inset:0">
  <div id="fast" style="position:absolute;left:0;top:60px;width:80px;height:80px;background:#fff"></div>
  <div id="slow" style="position:absolute;left:100px;top:200px;width:60px;height:60px;background:#6cf"></div>
  <div style="position:absolute;right:30px;top:40px;width:120px;height:40px;background:#f80"></div>
  <p data-type="40" style="position:absolute;left:20px;bottom:10px;margin:0;font-size:22px">typing is not motion, it should not blur</p>
</section>
<script>gm.timeline().fromTo('#fast', { x: 0 }, { x: 540, duration: 0.6, ease: 'none' }, 0.3).fromTo('#slow', { x: 0 }, { x: 60, duration: 1.4, ease: 'none' }, 0);</script>`, `data-width="640" data-height="360" data-fps="30" ${attrs}`);

/** one row of one video frame as gray bytes: w pixels from (x, y) */
function grayFrame(video, n, w, x, y) {
  return execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `select=eq(n\\,${n}),crop=${w}:2:${x}:${y},format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 }).subarray(0, w);
}

test('motion blur: auto blurs only the frames where something moves fast, the same with 1 and 3 workers; a static box stays sharp', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, blurPage());
  const a = join(d, 'a.mp4'), b = join(d, 'b.mp4'), o = join(d, 'off.mp4');
  const sa = await render(f, { output: a, workers: 1, motionBlur: 'auto', cache: false, ...quiet });
  const sb = await render(f, { output: b, workers: 3, motionBlur: 'auto', cache: false, ...quiet });
  const so = await render(f, { output: o, motionBlur: 'off', cache: false, ...quiet });
  assert.ok(readFileSync(a).equals(readFileSync(b)), '1 worker == 3 workers');
  assert.equal(sa.motionBlur.mode, 'auto');
  // the fast box moves 30 px/frame (x1080/360 = 90 px/frame at 1080p) for 0.6 s: those ~18 frames (+1 on each side), nothing else
  assert.ok(sa.motionBlur.blurred >= 16 && sa.motionBlur.blurred <= 22, `blurred ${sa.motionBlur.blurred}`);
  assert.equal(so.motionBlur.mode, 'off');
  // frame 18 (t=0.6): the fast box's edges are a ramp (several gray levels), without blur a hard edge
  const row = (v) => { const g = grayFrame(v, 18, 640, 0, 100); return [...g]; };
  const levels = (px) => px.filter((x) => x > 40 && x < 215).length;
  const la = levels(row(a)), lo = levels(row(o));
  assert.ok(la >= lo + 6, `edge pixels between the box and the background: blurred ${la}, sharp ${lo}`);
  // the static orange box keeps its hard edge in the blurred frame
  const sa2 = [...grayFrame(a, 18, 200, 440, 60)], so2 = [...grayFrame(o, 18, 200, 440, 60)];
  const mid = (px) => px.filter((x) => x > 30 && x < 130).length;
  assert.ok(mid(sa2) <= mid(so2) + 1 && Math.max(...sa2.map((x, i) => Math.abs(x - so2[i]))) <= 16, `static edge: ${mid(sa2)} vs ${mid(so2)}`);
});

test('motion blur: data-motion="classic" turns it off (same video as --motion-blur off); a re-rendered part equals the full render', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html'), fc = join(d, 'c.html');
  writeFileSync(f, blurPage());
  writeFileSync(fc, blurPage('data-motion="classic"'));
  const off = join(d, 'off.mp4'), cl = join(d, 'classic.mp4');
  await render(f, { output: off, motionBlur: 'off', cache: false, ...quiet });
  const sc = await render(fc, { output: cl, cache: false, ...quiet });
  assert.equal(sc.motionBlur.mode, 'off');
  assert.ok(readFileSync(off).equals(readFileSync(cl)));
  // parts: render once with the cache, re-render the middle part only; must equal a render without the cache
  const full = join(d, 'full.mp4'), part = join(d, 'part.mp4');
  await render(f, { output: full, cache: false, workers: 2, ...quiet });
  await render(f, { output: part, workers: 1, ...quiet });
  const s2 = await render(f, { output: part, redo: '0.5s-0.9s', ...quiet });
  assert.ok(s2.parts.reused >= 1 && s2.parts.rendered >= 1);
  assert.ok(readFileSync(part).equals(readFileSync(full)));
});

// a camera-like world panning fast under a static HUD, and a box moving straight down
const smearPage = () => page(`<section data-duration="1" style="position:absolute;inset:0">
  <div id="world" style="position:absolute;left:0;top:0;width:1600px;height:360px">
    <div style="position:absolute;left:600px;top:60px;width:120px;height:120px;background:#fff"></div>
  </div>
  <div id="drop" style="position:absolute;left:560px;top:0;width:40px;height:40px;background:#fff"></div>
  <div style="position:absolute;right:10px;bottom:10px;width:100px;height:30px;background:#f80"></div>
</section>
<script>gm.timeline().fromTo('#world', { x: 0 }, { x: -960, duration: 0.6, ease: 'none' }, 0.2).fromTo('#drop', { y: -40 }, { y: 360, duration: 0.6, ease: 'none' }, 0.2);</script>`);

test('motion blur: auto draws a smooth smear along the move (no stepped copies), keeps a HUD over a moving world sharp, and is the same with 1 and 3 workers', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, smearPage());
  const a = join(d, 'a.mp4'), b = join(d, 'b.mp4'), o = join(d, 'off.mp4');
  const sa = await render(f, { output: a, workers: 1, motionBlur: 'auto', cache: false, ...quiet });
  await render(f, { output: b, workers: 3, motionBlur: 'auto', cache: false, ...quiet });
  await render(f, { output: o, motionBlur: 'off', cache: false, ...quiet });
  assert.ok(readFileSync(a).equals(readFileSync(b)), '1 worker == 3 workers');
  assert.equal(sa.motionBlur.mode, 'auto');
  // both movers run from 0.2 s to 0.8 s: frames 7-24 (a frame is smeared when it moved in the half shutter before it)
  assert.ok(sa.motionBlur.blurred >= 17 && sa.motionBlur.blurred <= 19, `blurred ${sa.motionBlur.blurred}`);
  // frame 15: the world moves 53 px/frame; the card's edges are one smooth ramp about half that wide, no steps
  const row = [...grayFrame(a, 15, 640, 0, 120)], sharp = [...grayFrame(o, 15, 640, 0, 120)];
  const ramp = (px, lo, hi) => {
    const seg = px.slice(Math.max(0, lo), hi), min = Math.min(...seg), max = Math.max(...seg), rise = max - min;
    let jump = 0, wide = 0;
    for (let i = 1; i < seg.length; i++) jump = Math.max(jump, Math.abs(seg[i] - seg[i - 1]));
    for (const v of seg) if (v > min + 0.1 * rise && v < max - 0.1 * rise) wide++;
    return { rise, jump, wide };
  };
  const edge = sharp.findIndex((v) => v > 128); // the card's left edge in the sharp frame
  const ra = ramp(row, edge - 40, edge + 40), ro = ramp(sharp, edge - 40, edge + 40);
  assert.ok(ra.rise > 150 && ro.rise > 150, `card edge found: ${ra.rise}, ${ro.rise}`);
  assert.ok(ra.wide >= 12 && ro.wide <= 3, `ramp width: smeared ${ra.wide}, sharp ${ro.wide}`);
  assert.ok(ra.jump <= 0.2 * ra.rise, `largest step in the smear ${ra.jump} of ${ra.rise}`);
  // the box moving down keeps sharp left/right edges (the smear goes along the move only)
  const mids = (px) => px.filter((v) => v > 40 && v < 215).length;
  const ya = [...grayFrame(a, 15, 120, 520, 180)], yo = [...grayFrame(o, 15, 120, 520, 180)];
  assert.ok(Math.max(...yo) > 200 && mids(ya) <= mids(yo) + 2, `side edges of the falling box: ${mids(ya)} vs ${mids(yo)}`);
  // the static HUD box is the same as without blur
  const ha = [...grayFrame(a, 15, 160, 470, 335)], ho = [...grayFrame(o, 15, 160, 470, 335)];
  assert.ok(Math.max(...ha.map((v, i) => Math.abs(v - ho[i]))) <= 12, 'HUD unchanged');
});

test('timeline: color tweens to var(--x) and color-mix() resolve against the element (no black, no snap); gm.burst colors too', { skip }, async () => {
  const d = tmp(), f = join(d, 'v.html');
  writeFileSync(f, page(`<style>:root{--accent:#ff0000;--mix:color-mix(in srgb, var(--accent) 50%, #0000ff)}</style>
    <div id="a" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#0000ff"></div>
    <div id="b" style="position:absolute;left:200px;top:0;width:100px;height:100px;background:#000"></div>
    <script>gm.timeline('#stage').to('#a', { backgroundColor: 'var(--accent)', duration: 1, ease: 'linear' }, 0).to('#b', { backgroundColor: 'var(--mix, #fff)', duration: 1 }, 0);</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"'));
  const rows = await seekEach(f, [0.5, 1.5], `[getComputedStyle(document.querySelector('#a')).backgroundColor, getComputedStyle(document.querySelector('#b')).backgroundColor]`);
  const rgb = (s) => s.match(/[\d.]+/g).map(Number);
  const [mr, , mb] = rgb(rows[0][0]);
  assert.ok(mr > 40 && mb > 40, `halfway between blue and red: ${rows[0][0]}`);
  assert.deepEqual(rgb(rows[1][0]).slice(0, 3), [255, 0, 0]);
  const [er, , eb] = rgb(rows[1][1]);
  assert.ok(er > 100 && eb > 100, `color-mix end resolved: ${rows[1][1]}`);
});

test('data-scramble: hidden (layout kept) until its delay, then decodes to the real text', { skip }, async () => {
  const d = tmp(), f = join(d, 's.html');
  writeFileSync(f, page(`<h1 id="s" data-scramble="0.5" data-scramble-delay="1">Decode me</h1>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"'));
  const rows = await seekEach(f, [0.5, 1.2, 1.9], `[document.querySelector('#s').style.visibility, document.querySelector('#s').textContent]`);
  assert.deepEqual(rows[0], ['hidden', 'Decode me']);
  assert.equal(rows[1][0], '');
  assert.notEqual(rows[1][1], 'Decode me');
  assert.equal(rows[2][1], 'Decode me');
});

test('timeline draw on a data-sketch shape (a <g> of rough strokes) draws it on progressively, not all at once', { skip }, async () => {
  const d = tmp(), f = join(d, 'k.html');
  writeFileSync(f, page(`<svg viewBox="0 0 640 360" data-sketch style="position:absolute;inset:0"><rect id="box" x="100" y="100" width="300" height="150" fill="none" stroke="#fff" stroke-width="6"/></svg>
    <script>gm.timeline('body').fromTo('#box', { draw: 0 }, { draw: 1, duration: 1, ease: 'linear' }, 0.5);</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"'));
  const rows = await seekEach(f, [0.2, 1.0, 1.8], `[...document.querySelectorAll('#box path')].filter((p) => !p.closest('[data-gm-sketch-guide]') && p.style.visibility !== 'hidden').map((p) => parseFloat(p.style.strokeDasharray))`);
  assert.ok(rows[0].length && rows[0].every((x) => +x === 0), `hidden before: ${rows[0]}`);
  assert.ok(rows[1].every((x) => +x > 0.3 && +x < 0.7), `half drawn: ${rows[1]}`);
  assert.ok(rows[2].every((x) => +x === 1), `done: ${rows[2]}`);
});
