// End-to-end tests. They need Chrome (or chrome-headless-shell) and ffmpeg; they skip otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../src/browser.js';
import { ffmpegInfo, ffmpegPath, probe } from '../src/ffmpeg.js';
import { execFileSync } from 'node:child_process';
import { render, stills, check, snapshot, inspect } from '../src/api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const skip = !findChrome() || !ffmpegInfo() ? 'needs Chrome and ffmpeg' : false;
const tmp = () => mkdtempSync(join(tmpdir(), 'gm-test-'));
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const quiet = { quiet: true, log: () => {} };

function comp(dir, name, body, attrs = 'data-width="640" data-height="360" data-fps="30"') {
  const f = join(dir, name);
  writeFileSync(f, `<!doctype html><html ${attrs}><head><style>body{background:#111;color:#fff;font-family:sans-serif}</style></head><body>${body}</body></html>`);
  return f;
}

test('timeline: sequences, gaps, transitions, nested clips', { skip }, async () => {
  const d = tmp();
  const f = comp(d, 'seq.html', `
    <main data-sequence data-transition="fade 0.5">
      <section class="scene" data-duration="2"><p data-start="0.5" data-duration="1">a</p></section>
      <section class="scene" data-duration="3" data-transition="slide-left 1"></section>
      <section class="scene" data-duration="2"></section>
    </main>`);
  const info = await inspect(f);
  // 2 + 3 + 2 - 1 (slide overlap) - 0.5 (fade overlap)
  assert.equal(info.duration, 5.5);
  const starts = info.clips.map((c) => c.start);
  assert.deepEqual(starts, [0, 0.5, 1, 3.5]);
  assert.equal(info.issues.filter((i) => i.severity === 'error').length, 0);
});

test('time formats and errors are reported with fixes', { skip }, async () => {
  const d = tmp();
  const f = comp(d, 't.html', `<div data-start="15f" data-duration="500ms">x</div><div data-start="banana">y</div><div data-enter="wobble">z</div>`, 'data-width="640" data-height="360" data-duration="2"');
  const info = await inspect(f);
  assert.equal(info.clips[0].start, 0.5);
  assert.equal(info.clips[0].end, 1);
  const codes = info.issues.map((i) => i.code);
  assert.ok(codes.includes('bad-time'));
  assert.ok(codes.includes('bad-enter'));
  assert.ok(info.issues.every((i) => i.severity !== 'error' || i.fix));
});

test('render mp4: duration, size, frame count', { skip }, async () => {
  const d = tmp();
  const f = comp(d, 'r.html', `<h1 style="animation:fade-up .5s both">Hi</h1>`, 'data-width="640" data-height="360" data-fps="24" data-duration="1.5"');
  const out = join(d, 'r.mp4');
  const s = await render(f, { output: out, ...quiet });
  assert.equal(s.frames, 36);
  const p = probe(out);
  assert.equal(p.width, 640);
  assert.ok(Math.abs(p.duration - 1.5) < 0.05);
});

test('deterministic: 1 worker and 3 workers give identical frames (timers, rAF canvas, transitions, WAAPI)', { skip }, async () => {
  const d = tmp();
  copyFileSync(join(HERE, 'fixtures', 'stateful.html'), join(d, 'stateful.html'));
  const a = join(d, 'a'), b = join(d, 'b');
  await render(join(d, 'stateful.html'), { output: a, format: 'png', workers: 1, ...quiet });
  await render(join(d, 'stateful.html'), { output: b, format: 'png', workers: 3, ...quiet });
  const fa = readdirSync(a).sort(), fb = readdirSync(b).sort();
  assert.equal(fa.length, 120);
  assert.deepEqual(fa, fb);
  const diff = fa.filter((x) => md5(join(a, x)) !== md5(join(b, x)));
  assert.deepEqual(diff, []);
});

test('steady text: slowly moving text glides with its box instead of stepping whole pixels (1 worker == 2 workers)', { skip }, async () => {
  // 12 px down in 2 s (0.2 px a frame). Without the runtime's tilt Chrome puts the glyphs on whole pixels: the text
  // stays still for 4 frames and jumps a pixel while the bar under it glides (rms of the 2nd difference ~0.64 px).
  const d = tmp();
  const f = comp(d, 'move.html', `<div id="w" style="position:absolute;left:100px;top:140px;width:440px"><div style="font:600 40px Inter;color:#fff;line-height:52px">Every morning</div><div style="height:4px;background:#f00"></div></div>
    <script>gm.timeline().fromTo('#w', { y: 0 }, { y: 12, duration: 2, ease: 'linear' }, 0)</script>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"');
  const a = join(d, 'a'), b = join(d, 'b');
  await render(f, { output: a, format: 'png', workers: 1, cache: false, ...quiet });
  await render(f, { output: b, format: 'png', workers: 2, cache: false, ...quiet });
  const fa = readdirSync(a).filter((x) => x.endsWith('.png')).sort();
  assert.deepEqual(fa.filter((x) => md5(join(a, x)) !== md5(join(b, x))), []);
  const ys = fa.map((x) => {
    const px = execFileSync(ffmpegPath(), ['-v', 'error', '-i', join(a, x), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
    let w = 0, s = 0;
    for (let i = 0; i < px.length; i += 3) { const v = Math.min(px[i], px[i + 1], px[i + 2]); if (v > 30) { w += v; s += v * Math.floor(i / 3 / 640); } }
    return s / w;
  });
  let q = 0;
  for (let i = 1; i < ys.length - 1; i++) q += (ys[i + 1] - 2 * ys[i] + ys[i - 1]) ** 2;
  const jitter = Math.sqrt(q / (ys.length - 2));
  assert.ok(jitter < 0.15, `the text steps instead of gliding: rms 2nd difference ${jitter.toFixed(3)} px`);
});

test('4K with many composited layers: every tile is drawn (still and render match the same page on one layer)', { skip }, async () => {
  // 48 full-frame layers at --scale 2 need more tile memory than Chrome gives a tab by default; past the
  // limit the frame came out with blank or stale rectangles. The same page without will-change paints into one layer.
  const d = tmp();
  const layers = (deep) => Array.from({ length: 48 }, (_, i) => `<div style="position:absolute;inset:0;opacity:.9;${deep ? 'will-change:transform;' : ''}background:repeating-linear-gradient(${(i * 37) % 180}deg,hsl(${(i * 53) % 360} 80% 50%) 0 ${7 + (i % 5)}px,hsl(${(i * 53 + 180) % 360} 80% 40%) 0 ${14 + (i % 7)}px)"></div>`).join('');
  const attrs = 'data-width="1920" data-height="1080" data-fps="30" data-duration="0.1"';
  const deep = comp(d, 'deep.html', layers(true), attrs), flat = comp(d, 'flat.html', layers(false), attrs);
  const rgb = (buf) => execFileSync(ffmpegPath(), ['-v', 'error', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: buf, maxBuffer: 1 << 26 });
  const off = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 3) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) n++; return n / (a.length / 3); };
  const ref = rgb((await stills(flat, [0], { scale: 2 })).buffers[0]);
  const still = rgb((await stills(deep, [0], { scale: 2 })).buffers[0]);
  assert.ok(off(still, ref) < 0.001, `still: ${(off(still, ref) * 100).toFixed(1)}% of the pixels are wrong`);
  const out = join(d, 'frames');
  await render(deep, { output: out, format: 'png', scale: 2, frames: '0-2', workers: 1, cache: false, ...quiet });
  for (const fr of readdirSync(out).filter((x) => x.endsWith('.png'))) {
    const got = rgb(readFileSync(join(out, fr)));
    assert.ok(off(got, ref) < 0.001, `render ${fr}: ${(off(got, ref) * 100).toFixed(1)}% of the pixels are wrong`);
  }
});

test('video frames are exact and <video> keeps its CSS', { skip }, async () => {
  const d = tmp();
  mkdirSync(join(d, 'media'));
  // *.mp4 is not committed: make the test clip (moving picture + a tone) when it is missing
  const clip = join(HERE, 'fixtures', 'media', 'clip.mp4');
  if (!existsSync(clip)) {
    mkdirSync(dirname(clip), { recursive: true });
    execFileSync(ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  }
  copyFileSync(clip, join(d, 'media', 'clip.mp4'));
  const f = comp(d, 'v.html', `<video src="media/clip.mp4" data-start="0.5" data-from="2" style="position:absolute;left:0;top:0;width:640px;height:360px;object-fit:fill"></video>`, 'data-width="640" data-height="360" data-fps="30" data-duration="2"');
  const r = await stills(f, [0.5, 1.5]);
  assert.equal(r.buffers.length, 2);
  assert.ok(r.buffers[0].length > 1000);
  assert.notEqual(md5Buf(r.buffers[0]), md5Buf(r.buffers[1]));
  const out = join(d, 'v.mp4');
  const s = await render(f, { output: out, ...quiet });
  const p = probe(out);
  assert.ok(p.hasAudio, 'video audio is mixed in');
  assert.equal(s.pageErrors.length, 0);
});
const md5Buf = (b) => createHash('md5').update(b).digest('hex');

test('check finds the classic layout problems', { skip }, async () => {
  const rep = await check(join(HERE, 'fixtures', 'bad.html'));
  const codes = new Set(rep.issues.map((i) => i.code));
  for (const c of ['text-clipped', 'text-offscreen', 'low-contrast', 'tiny-text', 'text-overlap', 'text-overflows-box', 'image-broken', 'bad-enter']) assert.ok(codes.has(c), 'missing ' + c);
  assert.equal(rep.ok, false);
});

test('snapshot writes a contact sheet', { skip }, async () => {
  const d = tmp();
  const f = comp(d, 's.html', `<main data-sequence><section class="scene" data-duration="1"><h1>A</h1></section><section class="scene" data-duration="1"><h1>B</h1></section></main>`);
  const r = await snapshot(f, { output: join(d, 'snaps') });
  assert.ok(existsSync(r.sheet));
  assert.ok(r.times.length >= 2);
});

test('transparent ProRes keeps alpha', { skip: skip || (!ffmpegInfo()?.encoders.prores_ks && 'no prores') }, async () => {
  const d = tmp();
  const f = comp(d, 'a.html', `<div style="position:absolute;left:100px;top:100px;width:100px;height:100px;background:red"></div>`, 'data-width="320" data-height="240" data-duration="0.5"');
  writeFileSync(f, readFileSync(f, 'utf8').replace('background:#111;', 'background:transparent;'));
  const out = join(d, 'a.mov');
  await render(f, { output: out, transparent: true, ...quiet });
  assert.ok(probe(out).hasVideo);
});

test('every block renders without errors', { skip }, async () => {
  const d = tmp();
  const blocks = readdirSync(join(ROOT, 'blocks')).filter((b) => b.endsWith('.html'));
  const body = blocks.map((b, i) => `<section class="scene" data-duration="1"><gm-include src="blocks/${b}"></gm-include></section>`).join('\n');
  mkdirSync(join(d, 'blocks'));
  for (const b of blocks) copyFileSync(join(ROOT, 'blocks', b), join(d, 'blocks', b));
  writeFileSync(join(d, 'cap.json'), '[{"word":"hi","start":0,"end":0.5}]');
  // A tiny stand-in for lottie-web, so the test needs no network
  writeFileSync(join(d, 'fake-lottie.js'), 'window.lottie={loadAnimation(o){const h={};const a={frameRate:30,totalFrames:30,addEventListener(n,f){h[n]=f;if(n==="DOMLoaded")setTimeout(f,5)},goToAndStop(f){o.container.dataset.f=f}};return a}};');
  writeFileSync(join(d, 'anim.json'), '{}');
  const html = body.replace('src="blocks/captions.html"', 'src="blocks/captions.html" file="cap.json"').replace('src="blocks/lottie.html"', 'src="blocks/lottie.html" file="anim.json" lib="fake-lottie.js"');
  const f = comp(d, 'blocks.html', `<main data-sequence>${html}</main>`, 'data-width="1280" data-height="720"');
  const info = await inspect(f);
  assert.deepEqual(info.issues.filter((i) => i.severity === 'error'), []);
  assert.deepEqual(info.pageErrors, []);
  assert.equal(info.duration, blocks.length);
});

test('examples pass check', { skip }, async () => {
  for (const ex of ['data-story', 'generative', 'personalized', 'bench']) {
    const rep = await check(join(ROOT, 'examples', ex, 'index.html'));
    assert.equal(rep.errors, 0, `${ex}: ${JSON.stringify(rep.issues.filter((i) => i.severity === 'error'))}`);
  }
});
