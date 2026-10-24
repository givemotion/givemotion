# motionwright: make videos with AI, free and open source

**Ask your AI for a video. Get an MP4.** motionwright is a free, open-source (MIT) video engine made for AI
coding agents like Claude Code, Cursor and Codex. Your agent writes the video, checks it, looks at it, fixes
it and renders it. No license fees, no seats, no per-render costs, and you can fork it and make it your own.

If you are looking for a **free code-to-video alternative**, a way to **make videos with Claude Code**, or an
**AI motion graphics tool you can run in your own project**, this is it.

<p>
  <img src="docs/media/data-story.gif" width="49%" alt="Data story made by an AI agent with motionwright: the camera rides a growing line chart">
  <img src="docs/media/code-explainer.gif" width="49%" alt="Code explainer made by an AI agent with motionwright: retry with back-off drawn as a timeline">
</p>
<p>
  <img src="docs/media/vertical-short.gif" width="24%" alt="Vertical short for social media made by an AI agent with motionwright, with captions synced to the voice">
</p>

*All three were made by a Claude agent from a one-paragraph brief, using only this project's docs.
They are in [`examples/`](examples).*

---

## Try it in 1 minute

In your project folder:

```bash
npx motionwright init my-video
```

This creates a starter video and installs the instructions your agent needs. Then just ask your agent:

> "Make a 20-second launch video for our app. Use our logo and colors, and put music under it."

The agent writes the video, runs the checks, looks at the frames, fixes what is wrong, and renders
`out/video.mp4`. You can watch and scrub it live with `npx motionwright dev my-video`.

Already have a project? `npx motionwright skill` adds just the agent instructions.

**You need:** Node.js 20+ and ffmpeg. Chrome is downloaded for you (`npx motionwright install`).

## What you can make

- Product launch videos and app promos (with a cursor that really clicks the right button)
- Explainers with a camera that moves over a map, a diagram or a whole UI
- Animated charts and data stories, from your own JSON data
- Vertical shorts for TikTok, Reels and YouTube Shorts, with word-by-word captions
- Code explainers for developer channels
- Logo stings, title cards, lower thirds, end cards
- Many personalized videos from one template (a different name, number or logo in each)
- Transparent overlays to drop into Premiere, DaVinci Resolve or Final Cut

## Why it works so well with AI

Most video tools were made for people. AI agents work differently, so we built this one around how they
actually behave, and we tested it with real agents instead of guessing.

**1. It uses what AI already knows best: web pages.**
A video is one HTML file with normal CSS and JavaScript. Models have seen billions of web pages, so they
write them well. We tested this: 12 Claude agents made the same 4 videos in plain HTML, in HTML with ready-made
blocks, and in React. Blind AI judges ranked **plain HTML first in 6 of 8 cases** (React scored a little lower;
details in [the experiment](docs/experiments/2026-10-format-test.md)). React still works if you want it.

**2. The agent can check its own work.** An agent cannot watch a video, so the engine does it for them:
- `check` finds text that is cut off, off screen, covered, overlapping, too small or hard to read, plus
  broken files and script errors, and says how to fix each one. It knows the difference between text that is
  *moving* past the edge and text that is *stuck* there.
- It also flags pacing: long stretches where nothing happens, or an empty first frame.
- It prints a "motion strip", a one-line picture of the video's rhythm.
- `snapshot` makes one image with the key moments of every scene, so the agent can *look* at its video.

**3. It is built from what agents struggled with.** We give fresh agents only the docs and a real brief, read
their notes on what got in their way, and fix the engine, not just the instructions. Three rounds so far,
dozens of fixes ([what changed](docs/experiments/)).

**4. Motion design, not slides.** The engine has the tools that make video feel like real animation:
a camera that follows and frames things, motion along paths, shape morphs, shared elements that fly from one
scene into the next, more than 25 scene transitions, kinetic type, particle bursts, and edits that land on the music's beats.

**5. Same input, same video, every time.** Rendering is exact and repeatable, so an agent can change one
thing without surprises elsewhere.

## How it compares

| | motionwright | another framework |
|---|---|---|
| Price | Free for everyone (MIT) | Free for individuals and teams of up to 3; bigger companies pay (from $25 per person per month, or $0.01 per render with a $100/month minimum)¹ |
| You write | HTML, CSS, JavaScript (React optional) | React |
| Instructions for AI agents | Yes, installed with one command | Yes (another framework Agent Skills) |
| Agent checks its own video (cut-off or covered text, pacing, broken files) and sees key frames | Yes (`check`, `snapshot`, `inspect`) | Not built in |
| Fork and change anything | Yes, any use | Source is available; using it inside a company still needs a license |
| Audio, video clips, transitions, captions, still frames, data-driven videos, parallel rendering, an embeddable player | Yes | Yes |
| Cloud rendering service | No (render anywhere you run Node) | Yes (another framework Lambda) |

¹ From another framework's [license FAQ](https://www.other.dev/docs/license/faq), October 2026. another framework is a great
project and inspired this one; motionwright shares the idea, not the code.

## Make your own version (fork it)

MIT means you can take this and build on it, even sell what you make with it. One idea we like: **a fork
focused on one style.** For example a "whiteboard" edition, a "tech launch" edition, or your company's brand
edition:

1. Fork the repo.
2. Add blocks in [`blocks/`](blocks) for your style: your title cards, your charts, your transitions, your colors.
3. Add a short style guide to the agent instructions ([`skills/motionwright/SKILL.md`](skills/motionwright/SKILL.md)):
   which blocks to use, which colors, which fonts, what to avoid.

Agents then make videos in that style much faster and more consistently, because they start from pieces that
already look right instead of inventing everything each time.

## Questions people ask

**Is there a free alternative to another framework?** Yes. motionwright is free for any use, including big companies,
under the MIT license.

**Can Claude Code make videos?** Yes. Run `npx motionwright init` (or `npx motionwright skill` in an existing
project) and ask Claude Code for a video. It also works with Cursor, Codex and other agents that read an
`AGENTS.md` file.

**Do I need to know how to code?** No. You talk to your agent; the agent writes the code. If you do know HTML
and CSS, you can open the file and change anything.

**Can I use it for client work or commercially?** Yes, for free. MIT license.

**Can I put my own music, voice-over, logos and videos in?** Yes. Audio tracks with volume curves and ducking
under a voice, video clips, images, fonts, and captions from a word-timed file or an `.srt`.

**How fast is it?** Fast on a normal computer, faster with more cores and a GPU. It renders with several browsers
at once and skips frames that did not change. See [Performance](#performance).

---

## For developers

### A composition

```html
<!doctype html>
<html data-width="1920" data-height="1080" data-fps="30">
<head>
<style>
  body { background: #0b0d12; color: #fff; font-family: Inter, system-ui, sans-serif; }
  .scene { display: grid; place-items: center; }
  h1 { font-size: 120px; margin: 0; }
</style>
</head>
<body>
  <main data-sequence data-transition="fade 0.6">
    <section class="scene" data-duration="3" data-camera="push 1.1">
      <h1 data-enter="rise">Hello</h1>
    </section>
    <section class="scene" data-duration="4">
      <h1 data-split="words" data-enter="fade-up 0.6" data-stagger="0.08">Any HTML. Any CSS.</h1>
      <audio src="music.mp3" data-volume="0.4" data-fade-out="1"></audio>
    </section>
  </main>
</body>
</html>
```

No imports and no build step: the runtime is added for you. Everything that moves on a web page is played
on a virtual clock and captured frame by frame: CSS animations, transitions, the Web Animations API, timers,
`requestAnimationFrame`, canvas, WebGL, GSAP, Lottie. There is also a built-in GSAP-style timeline
(`mw.timeline()`), a camera (`mw.camera()`), path travel, shape morphs, particle bursts and music analysis
(`mw.audio()`, `mw.beat(n)`).

The full reference is one page written for agents (and good for humans too):
[`skills/motionwright/SKILL.md`](skills/motionwright/SKILL.md).

### Commands

| Command | What it does |
|---|---|
| `init [dir]` | New project: starter video, agent instructions, AGENTS.md |
| `skill` | Add the agent instructions to an existing project |
| `dev [file]` | Live preview with a timeline, scrubbing, frame stepping and sound |
| `render [file] -o out.mp4` | Render to `.mp4` `.webm` `.mov` `.gif`, a folder of PNGs, or just the soundtrack (`.mp3`) |
| `still [file] -t 2.5 -o f.png` | One exact frame |
| `check [file]` | Problems with fixes, plus the motion strip |
| `snapshot [file]` | Key moments of every scene in one image |
| `inspect [file]` | Timeline as JSON; `--at 3.2 --el "#logo"` says where anything is at any moment |
| `audio <file>` | Tempo, beats, bar starts and big hits of a song |
| `analyze <video.mp4>` | Report on any video (a reference, or your render): shots and cuts, transitions, camera, pacing, colors, cuts on the beat, contact sheets. `--compare ref.mp4` lists how yours differs |
| `bundle [file] -o dir` | Standalone page + `<mw-player>` to embed the video in any site |
| `blocks` / `add <name>` | Ready-made blocks you can copy and edit |
| `install` / `doctor` / `bench` | Get Chrome, check your setup, measure speed |

Render options: `--quality draft|standard|high|max`, `--fps`, `--scale 2` (4K from a 1080p layout),
`--frames 2s-5s`, `--transparent`, `--motion-blur 8`, `--codec h265|av1`, `--hardware`, `--workers`,
`--muted`, `--data file.json`, `--props '{…}'`. Every command takes `--json`.

### Programmatic API

```js
import { render, check, snapshot, still, inspect } from 'motionwright';

await render('video.html', { output: 'out/video.mp4', quality: 'high', data: { name: 'Ada' } });
const report = await check('video.html');           // { ok, errors, warnings, issues: [...] }
const { sheet } = await snapshot('video.html');     // path to the contact sheet
```

### Blocks

Plain-HTML building blocks you copy into your project and edit freely (`npx motionwright add <name>`):
title-card, lower-third, captions, code-window, bar-chart, line-chart, stat, checklist, steps, browser-window,
phone, cursor, callout, compare, quote, word-pop, logo-reveal, end-card, gradient-bg, grid-bg, lottie.

### Performance

Measured on a small cloud machine (2 CPUs, no GPU), 1080p at 30 fps, 300 frames:

| | Time |
|---|---|
| Simple approach: one browser, PNG screenshots, no frame reuse | 32.7 s |
| motionwright, 1 worker | 15.0 s |
| motionwright, auto workers | 13.3 s |

The same GSAP animation in motionwright and HyperFrames on that machine: 22.2 s vs 36.8 to 40.0 s
([method and script](benchmarks/vs-hyperframes)). Pages with many full-screen effects are slower on machines
without a GPU. Run `npx motionwright bench` on your own computer.

Where the speed comes from: Chrome's frame-by-frame capture (`beginFrame`, on Linux and Windows), several
browsers rendering parts of the video at once, reusing frames that did not change, and encoding while capturing.

### How it works

```
HTML ──► local server (adds the runtime, expands blocks and {{data}}, serves video frames)
           │
           ▼
 headless Chrome × N  ── runtime: virtual clock, seeks every animation to the exact time
           │  capture each frame
           ▼
      ffmpeg × N (segments) ──► join + audio mix ──► out.mp4
```

### Requirements

- Node.js 20+
- ffmpeg on your PATH (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`)
- Chrome: `npx motionwright install` downloads it, or it finds the one you have

motionwright itself has **zero required npm dependencies**.

## License

MIT. Use it, change it, fork it, sell what you make with it. Chrome and ffmpeg are installed separately under
their own licenses. The example music and images were made for this project and are MIT too.

This project was written from scratch. It shares the idea of "turn a web page into a video" with tools like
another framework and HyperFrames, but no code from them.
