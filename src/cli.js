#!/usr/bin/env node
// motionwright CLI
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from './args.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

const HELP = `motionwright ${pkg.version} — HTML in, video out. Built for AI agents.

Usage: motionwright <command> [options]

Make
  init [dir]                    New project: index.html + AI skill files
  dev [file]                    Live preview studio (scrub, play, frame-step)
  render [file] -o out.mp4      Render to mp4 / webm / mov / gif / png frames
  still [file] -t 2.5 -o a.png  Render one frame

Look (for AI review)
  check [file]                  Find problems: errors, text cut off or off-screen,
                                overlaps, tiny text, low contrast, broken assets
  snapshot [file] -o dir        Key moments as PNGs + one contact sheet (sheet.png)
  inspect [file]                Timeline as JSON: size, fps, duration, clips, media

Build faster
  blocks                        List ready-made blocks (titles, charts, captions…)
  add <block> [--dir blocks]    Copy a block into your project
  skill [dir]                   Install the AI skill file for Claude Code / agents

Setup
  install                       Download the Chrome build used for rendering
  doctor                        Check Chrome and ffmpeg
  bench [file]                  Measure render speed on this machine

Render options
  -o, --output <file>    out.mp4 (format from extension) or a folder for PNG frames
  --format <f>           mp4 | webm | mov | gif | png
  --quality <q>          draft | standard (default) | high | max
  --crf <n>              Override encoder quality (lower = better)
  --codec <c>            h264 (default) | h265 | av1   (mp4 only)
  --hardware             Use the GPU video encoder when available (VideoToolbox/NVENC)
  --scale <n>            Render at n× resolution (2 → 4K from a 1080p layout)
  --fps <n>  --width <n>  --height <n>   Override the composition settings
  --frames <range>       Part of the video: "0-90" (frames) or "2s-5s"
  --workers <n>          Parallel browsers (default: based on CPU and memory)
  --transparent          Keep transparency (use --format mov or webm)
  --motion-blur <n>      Real motion blur with n sub-frames (e.g. 8)
  --shutter <0-1>        Motion blur shutter (default 0.5)
  --data <file.json>     Data for data-bind / mw.data
  --props '<json>'       Same, inline
  --seed <n>             Seed for Math.random (default 1)
  --force                Render even if the composition has errors
  --json                 Print a JSON summary (good for agents)
  --capture <m>          auto | beginframe | screenshot
  --chrome <path>        Use a specific Chrome / chrome-headless-shell

Docs: SKILL.md in the package, or \`motionwright skill\` to install it for your agent.`;

const BOOLS = ['json', 'force', 'transparent', 'hardware', 'quiet', 'reuse', 'open', 'sheetOnly', 'help', 'version', 'lossless', 'verbose', 'yes'];

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : (argv.includes('--version') || argv.includes('-v') ? 'version' : 'help');
  const args = parseArgs(cmd === argv[0] ? argv.slice(1) : argv, { boolean: BOOLS, alias: { o: 'output', t: 'time', w: 'workers', q: 'quality', h: 'help', f: 'format' } });
  if (args.help && cmd !== 'help') return console.log(HELP);
  switch (cmd) {
    case 'help': return console.log(HELP);
    case 'version': return console.log(pkg.version);
    case 'render': return cmdRender(args);
    case 'still': return cmdStill(args);
    case 'snapshot': return cmdSnapshot(args);
    case 'check': return cmdCheck(args);
    case 'inspect': return cmdInspect(args);
    case 'dev': case 'preview': case 'studio': return cmdDev(args);
    case 'init': return cmdInit(args);
    case 'blocks': return cmdBlocks(args);
    case 'add': return cmdAdd(args);
    case 'skill': return cmdSkill(args);
    case 'install': return cmdInstall(args);
    case 'doctor': return cmdDoctor(args);
    case 'bench': return cmdBench(args);
    default:
      console.error(`Unknown command "${cmd}".\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

function loadData(args) {
  let data = null;
  if (args.data) data = JSON.parse(readFileSync(resolve(args.data), 'utf8'));
  if (args.props) data = Object.assign(data || {}, JSON.parse(args.props));
  return data;
}
function commonOpts(args) {
  return {
    chrome: args.chrome, capture: args.capture, gl: args.gl, data: loadData(args), seed: args.seed != null ? +args.seed : undefined,
    fps: args.fps ? +args.fps : undefined, width: args.width ? +args.width : undefined, height: args.height ? +args.height : undefined,
    scale: args.scale ? +args.scale : 1, verbose: args.verbose, timeoutMs: args.timeout ? +args.timeout * 1000 : undefined,
    onConsole: args.verbose ? (type, text) => console.error(`[page ${type}] ${text}`) : undefined,
  };
}
const inputOf = (args) => args._[0] || 'index.html';

async function cmdRender(args) {
  const { render } = await import('./render.js');
  const out = args.output || defaultOut(inputOf(args), args.format);
  try {
    const summary = await render(inputOf(args), {
      ...commonOpts(args), output: out, format: args.format, quality: args.quality, crf: args.crf != null ? +args.crf : undefined, codec: args.codec,
      hardware: args.hardware, workers: args.workers ? +args.workers : undefined, frames: args.frames, transparent: args.transparent,
      motionBlur: args.motionBlur, shutter: args.shutter != null ? +args.shutter : undefined, force: args.force, quiet: args.quiet || args.json,
      noReuse: args.reuse === false, lossless: args.lossless,
    });
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    else {
      for (const w of summary.warnings) console.error(`⚠ [${w.code}] ${w.message}${w.selector ? ' (' + w.selector + ')' : ''}`);
      for (const e of summary.pageErrors) console.error(`⚠ page ${e.code}: ${e.message}`);
    }
  } catch (e) {
    fail(e, args);
  }
}
function defaultOut(input, format) {
  const base = basename(input).replace(/\.html?$/i, '') || 'out';
  return join('out', `${base === 'index' ? 'video' : base}.${format && format !== 'png' ? format : format === 'png' ? '' : 'mp4'}`).replace(/\.$/, '');
}

async function cmdStill(args) {
  const { stills, openComposition } = await import('./render.js');
  try {
    const opts = commonOpts(args);
    const out = resolve(args.output || 'still.png');
    const fmt = /\.jpe?g$/i.test(out) ? 'jpeg' : 'png';
    let t = args.time != null ? parseFloat(args.time) : 0;
    if (args.frame != null) {
      const { inspect } = await import('./api.js');
      const info = await inspect(inputOf(args), opts);
      t = +args.frame / info.fps;
    }
    const r = await stills(inputOf(args), [t], { ...opts, format: fmt, transparent: args.transparent });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, r.buffers[0]);
    if (args.json) console.log(JSON.stringify({ output: out, time: t }));
    else console.error(`wrote ${relative(process.cwd(), out)} (t=${t}s)`);
  } catch (e) { fail(e, args); }
}

async function cmdSnapshot(args) {
  const { snapshot } = await import('./check.js');
  try {
    const r = await snapshot(inputOf(args), { ...commonOpts(args), output: args.output, times: args.times, every: args.every, max: args.max ? +args.max : undefined, sheetOnly: args.sheetOnly, cols: args.cols ? +args.cols : undefined });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`sheet: ${relative(process.cwd(), r.sheet)}`);
      console.log(`times: ${r.times.map((t) => t.toFixed(2) + 's').join(', ')}`);
      if (r.files.length) console.log(`frames: ${relative(process.cwd(), dirname(r.files[0]))}/ (${r.files.length} PNGs)`);
    }
  } catch (e) { fail(e, args); }
}

async function cmdCheck(args) {
  const { check, formatReport } = await import('./check.js');
  try {
    const rep = await check(inputOf(args), { ...commonOpts(args), contrastSamples: args.samples ? +args.samples : undefined });
    if (args.json) console.log(JSON.stringify(rep, null, 2));
    else console.log(formatReport(rep, { file: inputOf(args) }));
    if (!rep.ok) process.exitCode = 1;
  } catch (e) { fail(e, args); }
}

async function cmdInspect(args) {
  const { inspect } = await import('./api.js');
  try {
    const info = await inspect(inputOf(args), commonOpts(args));
    console.log(JSON.stringify(info, null, 2));
  } catch (e) { fail(e, args); }
}

async function cmdDev(args) {
  const { dev } = await import('./dev.js');
  await dev(inputOf(args), { port: args.port ? +args.port : undefined, open: args.open, data: loadData(args) });
}

async function cmdInit(args) {
  const dir = resolve(args._[0] || '.');
  mkdirSync(dir, { recursive: true });
  const tpl = join(PKG_ROOT, 'templates', args.template || 'starter');
  if (!existsSync(tpl)) throw new Error('Template not found: ' + (args.template || 'starter'));
  copyDir(tpl, dir, args.force);
  installSkill(dir, true);
  console.log(`Created ${relative(process.cwd(), dir) || '.'}/
  index.html                 your video (edit me)
  .claude/skills/motionwright/SKILL.md   how AI agents should use motionwright
  AGENTS.md                  short pointer for other agents

Next:
  npx motionwright dev ${relative(process.cwd(), join(dir, 'index.html'))}      # preview
  npx motionwright check ${relative(process.cwd(), join(dir, 'index.html'))}    # find problems
  npx motionwright render ${relative(process.cwd(), join(dir, 'index.html'))} -o out/video.mp4`);
}
function copyDir(src, dst, force) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const s = join(src, e), d = join(dst, e);
    if (statSync(s).isDirectory()) copyDir(s, d, force);
    else if (!existsSync(d) || force) copyFileSync(s, d);
  }
}

function blockList() {
  const dir = join(PKG_ROOT, 'blocks');
  return readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => {
    const txt = readFileSync(join(dir, f), 'utf8');
    const meta = /<!--\s*block:\s*([\s\S]*?)-->/.exec(txt);
    let m = {};
    if (meta) for (const line of meta[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return { name: f.replace(/\.html$/, ''), file: join(dir, f), ...m };
  });
}
async function cmdBlocks(args) {
  const list = blockList();
  if (args.json) return console.log(JSON.stringify(list.map(({ file, ...r }) => r), null, 2));
  console.log('Blocks (copy one with `motionwright add <name>`, then <mw-include src="blocks/<name>.html" …>):\n');
  for (const b of list) console.log(`  ${b.name.padEnd(18)} ${b.description || ''}${b.params ? '\n' + ' '.repeat(21) + 'params: ' + b.params : ''}`);
}
async function cmdAdd(args) {
  const names = args._;
  if (!names.length) { console.error('Usage: motionwright add <block> [more blocks] [--dir blocks]'); process.exitCode = 2; return; }
  const list = blockList();
  const dir = resolve(args.dir || 'blocks');
  mkdirSync(dir, { recursive: true });
  for (const n of names) {
    const b = list.find((x) => x.name === n);
    if (!b) { console.error(`No block "${n}". Run \`motionwright blocks\`.`); process.exitCode = 1; continue; }
    const dst = join(dir, `${n}.html`);
    copyFileSync(b.file, dst);
    console.log(`added ${relative(process.cwd(), dst)}`);
    if (b.usage) console.log(`  use: ${b.usage}`);
  }
}

function installSkill(dir, quiet) {
  const src = join(PKG_ROOT, 'skills', 'motionwright', 'SKILL.md');
  const targets = [join(dir, '.claude', 'skills', 'motionwright', 'SKILL.md')];
  for (const t of targets) { mkdirSync(dirname(t), { recursive: true }); copyFileSync(src, t); }
  const agents = join(dir, 'AGENTS.md');
  const pointer = `# Video projects in this folder\n\nVideos here are made with motionwright (HTML → MP4). Read .claude/skills/motionwright/SKILL.md before editing a composition.\nLoop: edit HTML → \`npx motionwright check\` → \`npx motionwright snapshot\` (look at sheet.png) → \`npx motionwright render -o out/video.mp4\`.\n`;
  if (!existsSync(agents)) writeFileSync(agents, pointer);
  if (!quiet) console.log(`installed ${relative(process.cwd(), targets[0])}\nand ${relative(process.cwd(), agents)}`);
}
async function cmdSkill(args) { installSkill(resolve(args._[0] || '.'), false); }

async function cmdInstall() {
  const { installChrome } = await import('./browser.js');
  await installChrome({ log: (s) => console.error(s) });
}

async function cmdDoctor() {
  const { findChrome, chromeVersion, CACHE_DIR } = await import('./browser.js');
  const { ffmpegInfo } = await import('./ffmpeg.js');
  const c = findChrome();
  console.log(`node        ${process.version}`);
  console.log(`chrome      ${c ? `${c.path} (${c.kind === 'shell' ? 'headless shell: fast frame capture' : 'regular Chrome: screenshot capture'}) ${chromeVersion(c.path) || ''}` : 'not found → run `npx motionwright install`'}`);
  const f = ffmpegInfo();
  console.log(`ffmpeg      ${f ? f.version + '  encoders: ' + Object.entries(f.encoders).filter(([, v]) => v).map(([k]) => k).join(', ') : 'not found → install ffmpeg (brew/apt/winget) or set MOTIONWRIGHT_FFMPEG'}`);
  console.log(`cache       ${CACHE_DIR}`);
  if (!c || !f) process.exitCode = 1;
}

async function cmdBench(args) {
  const { bench } = await import('./bench.js');
  await bench(args._[0], { workers: args.workers ? +args.workers : undefined, json: args.json, chrome: args.chrome });
}

function fail(e, args) {
  if (args && args.json) console.log(JSON.stringify({ ok: false, error: e.message, issues: e.issues || undefined }, null, 2));
  else console.error(`✖ ${e.message}`);
  if (process.env.MOTIONWRIGHT_DEBUG) console.error(e.stack);
  process.exitCode = 1;
}

main().catch((e) => fail(e));
