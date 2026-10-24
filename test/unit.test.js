import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from '../src/args.js';
import { expandIncludes, applyData, injectRuntime } from '../src/server.js';

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
  assert.ok(skill.indexOf('## Quality rules') < 12000, 'quality rules within the first ~3k tokens, so they survive compaction');
});
