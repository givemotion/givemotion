// Tests for motion tools, React mode, audio analysis and the checker's motion handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { findChrome } from '../src/browser.js';
import { ffmpegInfo, ffmpegPath } from '../src/ffmpeg.js';
import { render, check, inspect, openComposition } from '../src/api.js';

const skip = !findChrome() || !ffmpegInfo() ? 'needs Chrome and ffmpeg' : false;
const hasEsbuild = await import('esbuild').then(() => true, () => false);
const tmp = () => mkdtempSync(join(tmpdir(), 'mw-feat-'));
const quiet = { quiet: true, log: () => {} };
const page = (body, attrs = 'data-width="640" data-height="360" data-fps="30"') => `<!doctype html><html ${attrs}><head><style>body{background:#111;color:#fff;font-family:sans-serif}</style></head><body>${body}</body></html>`;
async function evalAt(file, t, expr) {
  const ctx = await openComposition(file, { mode: 'render' });
  try { await ctx.page.seek(t); return await ctx.page.evaluate(expr); } finally { await ctx.page.close(); await ctx.server.close(); }
}

test('timeline: from/to/stagger values at exact times', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><i class="b" style="display:block;width:10px;height:10px"></i><i class="b" style="display:block;width:10px;height:10px"></i></div>
    <script>mw.timeline().fromTo('.b', { x: 0, opacity: 0 }, { x: 100, opacity: 1, duration: 1, ease: 'linear', stagger: 0.5 }, 0);</script>`));
  const v = await evalAt(f, 0.5, `[...document.querySelectorAll('.b')].map(e => [Math.round(new DOMMatrix(getComputedStyle(e).transform).e), +getComputedStyle(e).opacity])`);
  assert.deepEqual(v, [[50, 0.5], [0, 0]]);
});

test('react: .jsx renders and 1 worker equals 2 workers', { skip: skip || (!hasEsbuild && 'needs the optional esbuild, react and react-dom (npm install)') }, async () => {
  const d = tmp(), f = join(d, 'v.jsx');
  writeFileSync(f, `import { Scene, Sequence, useTime, interpolate } from 'motionwright/react';
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
  writeFileSync(f, page(`<audio id="m" src="clicks.wav"></audio><script>window.m = mw.audio('#m');</script>`, 'data-width="320" data-height="180" data-duration="8"'));
  const r = await evalAt(f, 0, `(async () => { await m.ready; return { bpm: m.bpm, beats: m.beats.slice(0, 4) }; })()`);
  assert.ok(Math.abs(r.bpm - 120) < 1, 'bpm ' + r.bpm);
  assert.ok(Math.abs(r.beats[0] - 0.25) < 0.02, 'first beat ' + r.beats[0]);
  assert.ok(Math.abs(r.beats[1] - 0.75) < 0.02, 'second beat ' + r.beats[1]);
});

test('check: text flying in from off-screen is not an error; text stuck off-screen is', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><h1 id="fly" style="position:absolute;left:100px;top:40px;font-size:40px;margin:0">Flying in</h1>
    <h1 id="stuck" style="position:absolute;left:560px;top:200px;font-size:40px;margin:0;white-space:nowrap">Stuck half out</h1></div>
    <script>mw.timeline().from('#fly', { x: 900, duration: 1.2, ease: 'power2.out' }, 0.3);</script>`));
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

test('mw.random(seed) is stable per seed and differs across seeds', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="1"></div>`));
  const r = await evalAt(f, 0, `[mw.random('a'), mw.random('a'), mw.random('b'), mw.random(3)]`);
  assert.equal(r[0], r[1]);
  assert.notEqual(r[0], r[2]);
  assert.ok(r.every((x) => x >= 0 && x < 1));
});

test('timeline: two timelines on one element, newest tween wins; CSS centering kept while hidden', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<main data-sequence><section data-duration="1"></section><section id="s1" data-duration="4" style="position:relative">
    <div id="a" style="position:absolute;left:300px;width:100px;height:40px;transform:translateX(-50%)"></div></section></main>
    <script>mw.timeline('#s1').to('#a', { scaleX: 0.2, duration: 0.5 }, 0.5); mw.timeline('#s1').fromTo('#a', { scaleX: 0 }, { scaleX: 1, duration: 0.5 }, 2);</script>`, 'data-width="640" data-height="360" data-fps="30"'));
  const m = await evalAt(f, 4, `(() => { const m = new DOMMatrix(getComputedStyle(document.getElementById('a')).transform); return [m.a, m.e]; })()`);
  assert.deepEqual(m, [1, -50]);
  const m2 = await evalAt(f, 2.6, `new DOMMatrix(getComputedStyle(document.getElementById('a')).transform).a`);
  assert.equal(m2, 0.2);
});

test('timeline: counting keeps the number format; travel moves SVG shapes', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3"><b id="n1">000</b> <b id="n2">$0.00</b> <b id="n3">0</b>
    <svg width="640" height="360"><path id="p" d="M100 100 L500 100" fill="none" stroke="#fff"/><circle id="c" cx="20" cy="20" r="10" fill="red"/></svg></div>
    <script>mw.timeline().to('#n1', { textContent: 42, duration: 1 }).to('#n2', { textContent: 4.5, duration: 1 }, 0).to('#n3', { textContent: -12, duration: 1 }, 0);
    mw.path.travel('#c', '#p', { stops: [[0, 0], [2, 1]], ease: 'linear' });</script>`));
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

test('sketch: data-sketch shapes are rough, seeded and keep their id; mw.connect follows a moving element', { skip }, async () => {
  const d = tmp(), f = join(d, 'a.html');
  writeFileSync(f, page(`<div data-duration="3" style="position:absolute;inset:0"><svg viewBox="0 0 640 360" style="position:absolute;inset:0" data-sketch>
    <rect id="r" x="20" y="20" width="200" height="100" fill="#fd0" stroke="#000" stroke-width="3"/></svg>
    <div id="a" style="position:absolute;left:20px;top:200px;width:80px;height:40px;background:#333"></div>
    <div id="b" style="position:absolute;left:400px;top:200px;width:80px;height:40px;background:#333"></div></div>
    <script>mw.timeline().to('#b', { y: 100, duration: 1, ease: 'linear' }, 0); mw.connect('#a', '#b', { head: 'none' });</script>`));
  const v = await evalAt(f, 1.5, `(() => { const r = document.getElementById('r'); const p = document.querySelector('.mw-connect path').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
    return { tag: r.tagName, paths: r.querySelectorAll('path').length, same: mw.sketch.rect(0, 0, 100, 50, { seed: 3 }) === mw.sketch.rect(0, 0, 100, 50, { seed: 3 }), differ: mw.sketch.rect(0, 0, 100, 50, { seed: 3 }) !== mw.sketch.rect(0, 0, 100, 50, { seed: 4 }), end: p.slice(-2) }; })()`);
  assert.equal(v.tag, 'g');
  assert.equal(v.paths, 2, 'outline + hatching');
  assert.ok(v.same && v.differ);
  // the line ends on the left edge of #b (moved down by 100px) minus the gap (10px at 1080p = 3.3px here)
  assert.ok(Math.abs(v.end[0] - 396.8) < 2 && Math.abs(v.end[1] - 308.6) < 2, 'end ' + v.end);
});
