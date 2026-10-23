import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), 'mw-inc-'));
  writeFileSync(join(dir, 'b.html'), '<!-- block:\ndescription: x\n-->\n<p style="--c:{{color|red}}">{{name}}|{{content}}|{{data.keep}}</p>');
  const out = expandIncludes('<mw-include src="b.html" name="A&quot;B" data-start="2"><b>hi</b></mw-include>', dir, dir);
  assert.match(out, /data-mw-include="b.html"/);
  assert.match(out, /style="display:contents"/);
  assert.match(out, /data-start="2"/);
  assert.match(out, /--c:red/);
  assert.match(out, /<b>hi<\/b>/);
  assert.match(out, /\{\{data\.keep\}\}/, 'data placeholders are left for applyData');
  assert.doesNotMatch(out, /block:/, 'doc comment is dropped');
  const missing = expandIncludes('<mw-include src="nope.html"></mw-include>', dir, dir);
  assert.match(missing, /mw-include not found/);
});

test('expandIncludes: a wrapper with data-enter keeps its box', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-inc-'));
  writeFileSync(join(dir, 'b.html'), '<p>x</p>');
  const out = expandIncludes('<mw-include src="b.html" data-enter="fade"/>', dir, dir);
  assert.doesNotMatch(out, /display:contents/);
});

test('applyData: paths, arrays, defaults, escaping, inline JSON', () => {
  assert.equal(applyData('{{data.a.b}}', { a: { b: '<x>' } }), '&lt;x>');
  assert.equal(applyData('{{data.list}}', { list: [1, 2, 3] }), '1,2,3');
  assert.equal(applyData('{{data.list[1]}}', { list: ['a', 'b'] }), 'b');
  assert.equal(applyData('{{data.missing|fallback}}', {}), 'fallback');
  const html = '<script type="application/json" id="mw-data">{"t":"Hi"}</script><h1>{{data.t}}</h1>';
  assert.match(applyData(html, null), /<h1>Hi<\/h1>/);
});

test('injectRuntime puts runtime first in <head>', () => {
  const out = injectRuntime('<!doctype html><html><head><script>x()</script></head><body></body></html>');
  const i = out.indexOf('/__mw/runtime.js');
  const j = out.indexOf('x()');
  assert.ok(i > 0 && i < j);
  assert.match(injectRuntime('<p>no head</p>'), /runtime\.js/);
});
