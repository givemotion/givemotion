import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../src/args.js';
import { expandIncludes, applyData, injectRuntime, startServer } from '../src/server.js';
import http from 'node:http';
import { bundle } from '../src/bundle.js';

test('parseArgs: flags, values, aliases, booleans', () => {
  const a = parseArgs(['in.html', '-o', 'out.mp4', '--workers=4', '--json', '--motion-blur', '8', '--no-reuse'], { boolean: ['json', 'reuse'], alias: { o: 'output' } });
  assert.deepEqual(a._, ['in.html']);
  assert.equal(a.output, 'out.mp4');
  assert.equal(a.workers, '4');
  assert.equal(a.json, true);
  assert.equal(a.motionBlur, '8');
  assert.equal(a.reuse, false);
});

test('expandIncludes: params, defaults, inner content, wrapper', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-inc-'));
  writeFileSync(join(dir, 'b.html'), '<!-- block:\ndescription: x\n-->\n<p style="--c:{{color|red}}">{{name}}|{{content}}|{{data.keep}}</p>');
  const out = expandIncludes('<gm-include src="b.html" name="A&quot;B" data-start="2"><b>hi</b></gm-include>', dir, dir);
  assert.match(out, /data-gm-include="b.html"/);
  assert.match(out, /style="display:contents"/);
  assert.match(out, /data-start="2"/);
  assert.match(out, /--c:red/);
  assert.match(out, /<b>hi<\/b>/);
  assert.match(out, /\{\{data\.keep\}\}/, 'data placeholders are left for applyData');
  assert.doesNotMatch(out, /block:/, 'doc comment is dropped');
  const missing = expandIncludes('<gm-include src="nope.html"></gm-include>', dir, dir);
  assert.match(missing, /gm-include not found/);
});

test('expandIncludes: a wrapper with data-enter keeps its box', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-inc-'));
  writeFileSync(join(dir, 'b.html'), '<p>x</p>');
  const out = expandIncludes('<gm-include src="b.html" data-enter="fade"/>', dir, dir);
  assert.doesNotMatch(out, /display:contents/);
});

test('applyData: paths, arrays, defaults, escaping, inline JSON', () => {
  assert.equal(applyData('{{data.a.b}}', { a: { b: '<x>' } }), '&lt;x>');
  assert.equal(applyData('{{data.list}}', { list: [1, 2, 3] }), '1,2,3');
  assert.equal(applyData('{{data.list[1]}}', { list: ['a', 'b'] }), 'b');
  assert.equal(applyData('{{data.missing|fallback}}', {}), 'fallback');
  const html = '<script type="application/json" id="gm-data">{"t":"Hi"}</script><h1>{{data.t}}</h1>';
  assert.match(applyData(html, null), /<h1>Hi<\/h1>/);
});

test('injectRuntime puts runtime first in <head>', () => {
  const out = injectRuntime('<!doctype html><html><head><script>x()</script></head><body></body></html>');
  const i = out.indexOf('/__gm/runtime.js');
  const j = out.indexOf('x()');
  assert.ok(i > 0 && i < j);
  assert.match(injectRuntime('<p>no head</p>'), /runtime\.js/);
});

test('hardware encoder: auto on macOS for H.264/HEVC MP4 only; reproducibility check passes for x264, fails for a broken encoder', async () => {
  const { wantsHardware, encoderIsReproducible, encoderPlan, ffmpegInfo } = await import('../src/ffmpeg.js');
  const info = { version: 'x', encoders: { h264_videotoolbox: true, hevc_videotoolbox: true, libx264: true } };
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'darwin' }), 'auto');
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'darwin', codec: 'h265' }), 'auto');
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'linux' }), false);
  assert.equal(wantsHardware({ format: 'webm', info, platform: 'darwin' }), false);
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'darwin', quality: 'max' }), false);
  assert.equal(wantsHardware({ format: 'mov', info, platform: 'darwin', transparent: true }), false);
  assert.equal(wantsHardware({ format: 'mp4', info: { version: 'x', encoders: {} }, platform: 'darwin' }), false);
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'darwin', hardware: false }), false);
  assert.equal(wantsHardware({ format: 'mp4', info, platform: 'linux', hardware: true }), true);
  const real = ffmpegInfo();
  if (!real || !real.encoders.libx264) return;
  const dir = mkdtempSync(join(tmpdir(), 'gm-hw-')), cacheFile = join(dir, 'hw.json');
  const plan = encoderPlan({ format: 'mp4', info: real });
  assert.equal(encoderIsReproducible(plan, real, { cacheFile }), true);
  assert.equal(Object.values(JSON.parse(readFileSync(cacheFile, 'utf8')))[0], true, 'answer kept');
  assert.equal(encoderIsReproducible({ ...plan, vargs: ['-c:v', 'no_such_encoder'] }, real, { cacheFile }), false);
});

test('skill pack: `givemotion skill <dir>` installs every file for Claude Code and Codex, plus an AGENTS.md section', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync, statSync, existsSync } = await import('node:fs');
  const { dirname, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(root, 'skills', 'givemotion');
  const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
  const files = walk(src).map((f) => relative(src, f)).sort();
  assert.ok(files.includes('SKILL.md') && files.includes(join('references', 'react.md')) && files.includes(join('references', 'motion-design.md')));
  const dir = mkdtempSync(join(tmpdir(), 'gm-skill-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# My project\n\nKeep this.\n');
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, [join(root, 'src', 'cli.js'), 'skill', dir], { stdio: 'pipe' });
  for (const target of [join('.claude', 'skills', 'givemotion'), join('.agents', 'skills', 'givemotion')]) {
    const got = walk(join(dir, target)).map((f) => relative(join(dir, target), f)).sort();
    assert.deepEqual(got, files, `${target} has every file of the pack`);
    for (const f of files.filter((x) => x !== 'SKILL.md')) assert.equal(readFileSync(join(dir, target, f), 'utf8'), readFileSync(join(src, f), 'utf8'));
  }
  // every reference file SKILL.md names exists in the installed copy
  const inst = join(dir, '.claude', 'skills', 'givemotion');
  const skill = readFileSync(join(inst, 'SKILL.md'), 'utf8');
  const refs = [...skill.matchAll(/`(references\/[\w/.-]+\.md)`/g)].map((m) => m[1]);
  assert.ok(refs.length >= 12);
  for (const r of refs) assert.ok(existsSync(join(inst, r)), r);
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# My project') && agents.includes('Keep this.'), 'existing AGENTS.md kept');
  assert.equal(agents.split('<!-- givemotion:start -->').length, 2, 'one givemotion section after two installs');
  assert.ok(agents.includes('`.agents/skills/givemotion/references/camera.md`') && agents.includes('npx givemotion check'));
});

test('skill pack: SKILL.md and plugin.json carry the package version; SKILL.md stays small with the quality rules early', async () => {
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const skill = readFileSync(join(root, 'skills', 'givemotion', 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(skill)[1];
  assert.match(fm, /^name: givemotion$/m);
  assert.ok(/^description: (.*)$/m.exec(fm)[1].length <= 1024, 'description at most 1024 characters');
  assert.equal(/^\s+version:\s*"([^"]+)"/m.exec(fm)[1], pkg.version, 'SKILL.md metadata.version = package.json version');
  assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version, pkg.version, 'plugin.json version');
  assert.ok(Buffer.byteLength(skill) <= 19000, `SKILL.md is ${Buffer.byteLength(skill)} bytes: keep it under ~18 KB, move topics to references/`);
  const q = skill.indexOf('## How good motion is made here');
  assert.ok(q > 0 && q < 12000, 'craft rules within the first ~3k tokens, so they survive compaction');
  assert.ok(Buffer.byteLength(skill) <= 15000, 'SKILL.md stays a short core + router (~3.7k tokens): details go to references/');
});

test('motionIssues: a camera that stops between shots, fast moves without blur, straight diagonals, one easing for everything', async () => {
  const { motionIssues } = await import('../src/check.js');
  const info = { width: 1920, height: 1080, fps: 30 };
  const io = (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
  // camera x: three in-out-cubic moves of 1 s back to back (stops at 1 s and 2 s); a card: a 900 px straight diagonal
  const camX = (t) => (t < 0 ? 0 : t >= 3 ? -3000 : -1000 * (Math.floor(t) + io(t - Math.floor(t))));
  const samples = [];
  for (let t = 0; t <= 3.5 + 1e-9; t += 0.1) {
    const x = camX(t), cx = x + 2500, u = Math.min(1, Math.max(0, (t - 0.5) / 0.8));
    const card = [200 + 720 * u, 200 + 540 * u];
    samples.push({ t, els: [[1, cx, 1000, cx, 1000, 1, 5000, 2000, 1, 1, 960, 540], [2, ...card, ...card, 1, 300, 200, 1, 0, 0, 0]] });
  }
  const names = { 1: '#world', 2: '#card' };
  const classic = { classic: true, blurOff: true, blurExplicitOff: false, eases: [...Array(10).fill({ ease: 'cubic-bezier(0.33,1,0.68,1)', name: 'power2.out' }), { ease: 'linear(0, 1)', name: 'spring' }] };
  const by = (list) => Object.fromEntries(list.map((i) => [i.code, i]));
  const a = by(motionIssues(samples, names, classic, info, 0.1));
  assert.ok(a['camera-stop'], 'camera stop found');
  assert.deepEqual(a['camera-stop'].ranges.map(([t]) => Math.round(t)), [1, 2]);
  assert.equal(a['camera-stop'].selector, '#world');
  assert.match(a['camera-stop'].fix, /classic/);
  assert.ok(a['fast-no-blur'], 'fast move without blur');
  assert.ok(a['straight-move'] && a['straight-move'].selector === '#card');
  assert.ok(a['same-ease'] && /power2\.out/.test(a['same-ease'].message));
  // natural motion: blur on, the natural default eases, a camera that keeps moving, a card on an arc: nothing
  const smooth = [];
  for (let t = 0; t <= 3.5 + 1e-9; t += 0.1) {
    const p = Math.min(1, t / 3.5), x = -3000 * (0.5 - Math.cos(Math.PI * p) / 2), cx = x + 2500, u = Math.min(1, Math.max(0, (t - 0.5) / 0.8));
    const card = [200 + 720 * u, 200 + 540 * u - 160 * Math.sin(Math.PI * u)];
    smooth.push({ t, els: [[1, cx, 1000, cx, 1000, 1, 5000, 2000, 1, 1, 960, 540], [2, ...card, ...card, 1, 300, 200, 1, 0, 0, 0]] });
  }
  const natural = { classic: false, blurOff: false, blurExplicitOff: false, eases: [...Array(9).fill({ ease: 'natural', name: 'default' }), { ease: 'cubic-bezier(0.33,1,0.68,1)', name: 'power2.out' }] };
  assert.deepEqual(motionIssues(smooth, names, natural, info, 0.1).map((i) => i.code), []);
  // a step too coarse to see a stop: no camera-stop
  assert.equal(motionIssues(samples, names, classic, info, 0.25).filter((i) => i.code === 'camera-stop').length, 0);
});

test('pacingIssues: short holds by word count, breaks that keep it on screen, counters, quick-ok, ranges; cut-exit; sliver-start', async () => {
  const { pacingIssues } = await import('../src/check.js');
  const meta = {
    1: { sel: '#short', kind: 'text', words: 6, text: 'six words that leave too soon' },
    2: { sel: '#long', kind: 'text', words: 2, text: 'stays here' },
    3: { sel: '#count', kind: 'text', words: 1, live: true },
    4: { sel: '#flash', kind: 'text', words: 1, quick: true },
    5: { sel: '#icon', kind: 'mark', words: 0 },
    6: { sel: '#pop', kind: 'text', words: 2 },
    c7: { sel: '#slv', cp: 'inset(45% 0%)' }, c8: { sel: '#ok', cp: 'inset(50%)' },
  };
  // 0..4 s every 0.1 s: #short readable 0.5-1.3 s; #long 0.3-4 s with a 0.3 s emphasis pop at 2 s; #icon 1-1.4 s, then covered
  const samples = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 10, units = [];
    if (t >= 0.2 && t < 1.6) units.push([1, t >= 0.5 && t <= 1.3 ? 2 : 1, t > 1.3 ? 'moving' : 'fading', 1, 0]);
    if (t >= 0.3) units.push([2, t >= 2 && t <= 2.3 ? 1 : 2, 'moving', 1, 0]);
    units.push([3, 2, '', 1, 1], [4, t >= 1 && t <= 1.4 ? 2 : 1, '', 1, 0]);
    if (t >= 1) units.push([5, t <= 1.4 ? 2 : 1, 'covered', 1, 0]);
    units.push([6, 2, '', 1, 0]);
    samples.push({ t, units, clips: [[7, t < 0.5 ? 0.1 : t < 1 ? 0.5 : 1, 1], [8, t < 0.5 ? 0 : 1, 1]] });
  }
  const range = { from: 0, to: 4, lastT: 4, duration: 4.03 };
  const list = pacingIssues(samples, meta, [{ sel: '#pop', text: 'pop', t: 2.5, scene: '#s1', sceneStart: 0 }], range);
  const of = (code) => list.filter((i) => i.code === code).map((i) => i.selector).sort();
  assert.deepEqual(of('short-hold'), ['#icon', '#short']);
  const sh = list.find((i) => i.selector === '#short');
  assert.match(sh.message, /6-word text needs ~2\.5 s/);
  assert.match(sh.message, /starts to move away/);
  assert.deepEqual(sh.ranges, [[0.5, 1.3]]);
  assert.deepEqual(of('cut-exit'), ['#pop']);
  assert.equal(list.find((i) => i.code === 'cut-exit').scene, '#s1');
  assert.deepEqual(of('sliver-start'), ['#slv']);
  // a check of part of the video does not judge a hold that may go on outside it
  assert.deepEqual(pacingIssues(samples.slice(0, 13), meta, [], { from: 0, to: 1.2, lastT: 4, duration: 4.03 }).filter((i) => i.code === 'short-hold').map((i) => i.selector), []);
  // captions taking turns in one place (0.8 s each) are read on; the same phrases in different places are not
  const caps = (dy) => {
    const m2 = {}, s2 = [];
    for (let c = 0; c < 4; c++) m2[c + 1] = { sel: '#cap' + c, kind: 'text', words: 3, text: 'caption number ' + c };
    for (let k = 0; k <= 40; k++) {
      const t = k / 10, c = Math.floor(t / 0.8);
      s2.push({ t, units: c < 4 ? [[c + 1, 2, '', 1, 0, 100, 800 + c * dy, 600, 80]] : [] });
    }
    return pacingIssues(s2, m2, [], range).filter((i) => i.code === 'short-hold').length;
  };
  assert.equal(caps(0), 0);
  assert.equal(caps(200), 4);
});

test('server: no hidden files, no cross-origin reads, only localhost Host headers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-srv-'));
  writeFileSync(join(dir, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'a.txt'), 'ok');
  const s = await startServer({ root: dir });
  const port = new URL(s.origin).port;
  const get = (path, host = `127.0.0.1:${port}`) => new Promise((r, j) => http.get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (x) => { x.resume(); r(x); }).on('error', j));
  try {
    const ok = await get('/a.txt');
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['access-control-allow-origin'], undefined);
    assert.equal((await get('/.env')).statusCode, 404);
    assert.equal((await get('/%2eenv')).statusCode, 404);
    assert.equal((await get('/a.txt', `evil.example:${port}`)).statusCode, 403);
    assert.equal((await get('/a.txt', `localhost:${port}`)).statusCode, 200);
  } finally { await s.close(); }
});

test('injectRuntime: data cannot end the config <script> early', () => {
  const html = injectRuntime('<html><head></head><body></body></html>', { inlineConfig: { mode: 'render', data: { name: '</script><script>alert(1)</script>' } } });
  assert.ok(!html.includes('<script>alert(1)'));
  const json = /window\.__GM_CONFIG = window\.__GM_CONFIG \|\| (.*?);<\/script>/.exec(html)[1];
  assert.equal(JSON.parse(json).data.name, '</script><script>alert(1)</script>');
});

test('bundle: inlines exactly the built-in fonts the page names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-bundle-'));
  writeFileSync(join(dir, 'index.html'), '<html data-width="320" data-height="180" data-duration="1"><head><link rel="stylesheet" href="s.css"></head><body><h1 style="font-family:Inter">Hi</h1></body></html>');
  writeFileSync(join(dir, 's.css'), 'code { font-family: "JetBrains Mono", monospace }');
  const out = readFileSync(bundle(join(dir, 'index.html'), { output: join(dir, 'b') }).page, 'utf8');
  const faces = (fam) => [...out.matchAll(new RegExp(`font-family:'${fam}'[^}]*src:url\\(([^)]{0,30})`, 'g'))].map((m) => m[1].startsWith('data:font/woff2') ? 'inline' : m[1]);
  assert.ok(faces('Inter').length && faces('Inter').every((x) => x === 'inline'));
  assert.ok(faces('JetBrains Mono').every((x) => x === 'inline'));
  assert.ok(faces('Bebas Neue').every((x) => x === 'about:blank'));
  assert.ok(faces('Caveat').every((x) => x === 'about:blank'));
});

test('gm-include: reads HTML/SVG blocks, never hidden or other files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-inc-sec-'));
  writeFileSync(join(dir, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'notes.txt'), 'SECRET=2');
  mkdirSync(join(dir, '.hidden'));
  writeFileSync(join(dir, '.hidden', 'x.html'), 'SECRET=3');
  writeFileSync(join(dir, 'ok.html'), '<b>block</b>');
  const html = expandIncludes('<gm-include src=".env"/><gm-include src="notes.txt"/><gm-include src=".hidden/x.html"/><gm-include src="./ok.html"/>', dir, dir);
  assert.ok(!html.includes('SECRET'));
  assert.ok(html.includes('<b>block</b>'));
});

test('server: the audio analysis page cannot be used to inject a script', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gm-srv2-'));
  const s = await startServer({ root: dir });
  try {
    const body = await (await fetch(s.origin + '/__gm_analyze?src=' + encodeURIComponent('</script><script>alert(1)</script>'))).text();
    assert.ok(!body.includes('<script>alert(1)'));
  } finally { await s.close(); }
});
