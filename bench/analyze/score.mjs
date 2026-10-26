#!/usr/bin/env node
// Scores `givemotion analyze` against compositions whose true scene changes we know.
// For every case: render it (cached in bench/analyze/out/, only redone when the HTML is newer), take the truth from
// `inspect` (transitions with start/end; hard cuts = scene clips that start where no transition is), run analyze,
// match detections to the truth and print precision / recall of scene changes and transition-type accuracy.
//
//   node bench/analyze/score.mjs                 all cases
//   node bench/analyze/score.mjs --only busy-bg  some cases (comma list, matched against the name)
//   node bench/analyze/score.mjs --json out.json also write the raw results
//   node bench/analyze/score.mjs --verbose       every truth and detection, side by side
//   node bench/analyze/score.mjs --debug         also why each candidate was kept or dropped, what the classifier saw
//   node bench/analyze/score.mjs --tuning        only the tuning cases (keep the held-out ones for the final check)
//   node bench/analyze/score.mjs --rerender      render the videos again (after an engine change)
//   node bench/analyze/score.mjs --analyzer f.js score another analyze.js (keep it in src/ so its imports resolve)
//
// A detection hits a true change when its `at` is within 0.25 s of the true midpoint (cuts: the cut time), or
// inside the true transition window. Types are compared by family (see family() below): a whip counts as a push in the
// same direction, zoom-through as zoom-in, cover as push or wipe in the same direction, and so on.
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const { render } = await import(join(root, 'src/render.js'));
const { inspect } = await import(join(root, 'src/api.js'));

// held: true = never looked at while tuning analyze.js (reported separately)
const CASES = [
  { name: 'plain-basic', file: 'bench/analyze/cases/plain-basic.html' },
  { name: 'plain-moves', file: 'bench/analyze/cases/plain-moves.html' },
  { name: 'shared-gradient', file: 'bench/analyze/cases/shared-gradient.html' },
  { name: 'busy-bg', file: 'bench/analyze/cases/busy-bg.html' },
  { name: 'camera-in-shot', file: 'bench/analyze/cases/camera-in-shot.html' },
  { name: 'held-other', file: 'bench/analyze/cases/held-other.html', held: true },
  { name: 'held-busy', file: 'bench/analyze/cases/held-busy.html', held: true },
  { name: 'held-vertical', file: 'bench/analyze/cases/held-vertical.html', held: true },
  { name: 'data-story', file: 'examples/data-story/index.html', held: true },
  { name: 'photosynthesis', file: 'examples/made-by-agents/photosynthesis/index.html', held: true },
];

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only'), jsonOut = opt('--json'), verbose = args.includes('--verbose');
// --analyzer <file.js>: score another copy of analyze.js, e.g. the version before a change
const { analyzeVideo } = await import(resolve(opt('--analyzer') || join(root, 'src/analyze.js')));
const TOL = 0.25;

/** What analyze may call each engine transition and still be right. */
function family(name) {
  const dir = (name.match(/-(left|right|up|down)$/) || [])[1];
  if (/^(push|slide|whip)-/.test(name)) return [`push-${dir}`];
  if (/^cover-/.test(name)) return [`push-${dir}`, `wipe-${dir}`];
  if (/^wipe-/.test(name)) return [`wipe-${dir}`];
  switch (name) {
    case 'cut': return ['cut'];
    case 'fade': case 'crossfade': case 'blur': case 'morph': case 'fade-up': return ['fade'];
    case 'dip': return ['dip'];
    case 'iris': return ['iris'];
    case 'zoom': return ['zoom-out'];
    case 'zoom-through': return ['zoom-in'];
    case 'flip': return ['flip', 'other'];
    case 'diagonal': return ['wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'wipe-diagonal'];
    case 'clock': return ['clock', 'other', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down'];
    default: return [name];
  }
}

function truthOf(info) {
  const out = [];
  for (const t of info.transitions || []) out.push({ type: t.name, start: t.start, end: t.end, at: (t.start + t.end) / 2 });
  const f = 1 / info.fps;
  for (const c of (info.clips || []).filter((c) => c.scene)) {
    if (c.start <= f / 2) continue;
    if ((info.transitions || []).some((t) => Math.abs(t.start - c.start) <= f * 1.01)) continue;
    if (c.start >= info.duration - f) continue;
    out.push({ type: 'cut', start: c.start, end: c.start, at: c.start });
  }
  return out.sort((a, b) => a.at - b.at);
}

async function renderCached(file, out) {
  if (!args.includes('--rerender') && existsSync(out) && statSync(out).mtimeMs > statSync(file).mtimeMs) return false;
  mkdirSync(dirname(out), { recursive: true });
  await render(file, { output: out, quiet: true, log: () => {}, muted: true });
  return true;
}

function match(truth, det) {
  // greedy by distance: every true change takes at most one detection
  const pairs = [];
  truth.forEach((t, i) => det.forEach((d, j) => {
    const dist = Math.abs(d.at - t.at);
    const inside = t.end > t.start && d.at >= t.start - 1e-6 && d.at <= t.end + 1e-6;
    if (dist <= TOL || inside) pairs.push({ i, j, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist || a.i - b.i || a.j - b.j);
  const ti = new Map(), dj = new Set();
  for (const p of pairs) if (!ti.has(p.i) && !dj.has(p.j)) { ti.set(p.i, p.j); dj.add(p.j); }
  return ti;
}

const results = [];
for (const c of CASES) {
  if (only && !only.split(',').some((o) => c.name.includes(o))) continue;
  if (args.includes('--tuning') && c.held) continue;
  const file = join(root, c.file), out = join(here, 'out', c.name + '.mp4');
  const t0 = Date.now();
  const rendered = await renderCached(file, out);
  const tr = Date.now();
  // the truth only changes with the HTML: keep it next to the video
  const tf = join(here, 'out', c.name + '.truth.json');
  let info;
  if (!rendered && existsSync(tf) && statSync(tf).mtimeMs > statSync(file).mtimeMs) info = JSON.parse(readFileSync(tf, 'utf8'));
  else { info = await inspect(file, { quiet: true, log: () => {} }); writeFileSync(tf, JSON.stringify({ fps: info.fps, duration: info.duration, transitions: info.transitions, clips: info.clips })); }
  const truth = truthOf(info);
  const ta = Date.now();
  const rep = await analyzeVideo(out, { output: join(here, 'out', 'analysis', c.name), sheets: false, audio: false, debug: args.includes('--debug') });
  const analyzeSec = (Date.now() - ta) / 1000;
  const det = rep.transitions;
  const m = match(truth, det);
  let typeOk = 0;
  const rows = truth.map((t, i) => {
    const d = m.has(i) ? det[m.get(i)] : null;
    const ok = d ? family(t.type).includes(d.type) : false;
    if (ok) typeOk++;
    return { truth: t, det: d, typeOk: ok };
  });
  const matchedDet = new Set(m.values());
  const fps = det.filter((_, j) => !matchedDet.has(j));
  const r = { name: c.name, held: !!c.held, truth: truth.length, detected: det.length, hits: m.size, typeOk, falsePositives: fps, rows, analyzeSec, duration: rep.duration, size: `${rep.width}x${rep.height}`, renderSec: rendered ? (tr - t0) / 1000 : 0 };
  results.push(r);
  const P = det.length ? m.size / det.length : 1, R = truth.length ? m.size / truth.length : 1;
  console.log(`${c.held ? '[held] ' : ''}${c.name.padEnd(16)} truth ${String(truth.length).padStart(2)}  found ${String(m.size).padStart(2)}  extra ${String(fps.length).padStart(2)}  P ${P.toFixed(2)} R ${R.toFixed(2)}  type ${typeOk}/${m.size}  (analyze ${analyzeSec.toFixed(1)} s for ${rep.duration} s ${rep.width}x${rep.height}${rendered ? `, rendered in ${((tr - t0) / 1000).toFixed(0)} s` : ''})`);
  if (verbose) {
    for (const row of rows) console.log(`    ${row.truth.type.padEnd(13)} ${row.truth.start.toFixed(2)}-${row.truth.end.toFixed(2)}  ->  ${row.det ? `${row.det.type.padEnd(11)} at ${row.det.at.toFixed(2)} (${row.det.start.toFixed(2)}-${row.det.end.toFixed(2)})${row.typeOk ? '' : '  WRONG TYPE'}` : 'MISSED'}`);
    for (const d of fps) console.log(`    ${'(none)'.padEnd(13)} ${' '.repeat(9)}  ->  ${d.type.padEnd(11)} at ${d.at.toFixed(2)} (${d.start.toFixed(2)}-${d.end.toFixed(2)})  EXTRA`);
  }
  // --debug: why each scene-change candidate was kept or dropped, and what the classifier measured
  if (rep._debug) {
    for (const d of rep._debug.candidates) if (d.why !== 'overlap') console.log('      cand ', JSON.stringify(d));
    for (const k of rep._debug.classes || []) console.log('      class', JSON.stringify(k));
  }
}

function sum(set, label) {
  if (!set.length) return;
  const T = set.reduce((a, r) => a + r.truth, 0), D = set.reduce((a, r) => a + r.detected, 0), H = set.reduce((a, r) => a + r.hits, 0), K = set.reduce((a, r) => a + r.typeOk, 0);
  const P = D ? H / D : 1, R = T ? H / T : 1, F = P + R ? (2 * P * R) / (P + R) : 0;
  console.log(`${label.padEnd(10)} changes ${T}, detected ${D}, hits ${H}: precision ${P.toFixed(3)}  recall ${R.toFixed(3)}  F1 ${F.toFixed(3)}  type ${K}/${H} = ${(H ? K / H : 0).toFixed(3)} of hits (${(T ? K / T : 0).toFixed(3)} of all changes)`);
}
console.log('');
sum(results.filter((r) => !r.held), 'tuning');
sum(results.filter((r) => r.held), 'held-out');
sum(results, 'all');
if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(results, null, 2));
