# motionwright

**HTML in, video out.** A fast, deterministic video renderer built for AI agents.

Write a web page with normal HTML, CSS and JavaScript. motionwright plays it on a virtual clock, captures every frame from headless Chrome, and encodes an MP4 (or WebM, ProRes, GIF, PNG frames). The same input always gives the same pixels.

```bash
npx motionwright init my-video        # a starter video + the AI skill file
npx motionwright dev my-video         # live preview: scrub, play, frame-step
npx motionwright render my-video -o out/video.mp4
```

MIT licensed. No company license, no per-render fees, no seat limits.

---

## Why

AI agents are very good at HTML and CSS. motionwright lets them use exactly that for video, and gives them the tools to check their own work:

- **No new language.** A composition is one HTML file. CSS `@keyframes`, transitions, the Web Animations API, `setTimeout`, `requestAnimationFrame`, canvas, WebGL, GSAP, Lottie: all of it is seeked frame by frame.
- **Timing with attributes.** `data-start`, `data-duration`, `data-sequence`, `data-transition="slide-left 0.6"`. No timeline editor, no React.
- **Motion with attributes.** `data-enter="rise"`, `data-exit="fade"`, `data-split="words"` + `data-stagger="0.06"`, `data-count="0 1250"`, `data-type="30"`.
- **Eyes for the agent.** `check` finds text that is cut off, off-screen, overlapping, too small or low-contrast, plus broken assets and script errors, each with a fix. `snapshot` makes one contact-sheet image of every scene so the agent can *look* at its video.
- **Fast.** Chrome's frame-by-frame `beginFrame` capture (where available), parallel browsers, frames that did not change are reused, encoding overlaps capture. See [Performance](#performance).
- **Deterministic.** Virtual time, seeded `Math.random`, frame-exact video decoding. Renders with one worker or many are bit-identical.

## A composition

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
    <section class="scene" data-duration="3">
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

That's it: no imports, no build step. The runtime is injected for you.

The full reference is one page: [`skills/motionwright/SKILL.md`](skills/motionwright/SKILL.md). It is written for AI agents and is also the best doc for humans.

## For AI agents

`npx motionwright init` (or `npx motionwright skill` in an existing folder) installs the skill at `.claude/skills/motionwright/SKILL.md` and a short `AGENTS.md`. The loop the skill teaches:

1. write the HTML
2. `npx motionwright check video.html` → fix every error (each comes with a fix)
3. `npx motionwright snapshot video.html` → look at `snapshots/sheet.png`
4. `npx motionwright render video.html -o out/video.mp4`

Every command takes `--json`.

## Commands

| Command | What it does |
|---|---|
| `init [dir]` | New project: starter video, skill file, AGENTS.md |
| `dev [file]` | Preview studio with timeline, scrubbing, frame stepping, audio, live reload |
| `render [file] -o out.mp4` | Render to `.mp4` `.webm` `.mov` `.gif` or a folder of PNGs |
| `still [file] -t 2.5 -o f.png` | One exact frame |
| `snapshot [file]` | Key moment of every scene as PNGs + one `sheet.png` |
| `check [file]` | Errors, layout and contrast problems, with fixes |
| `inspect [file]` | Timeline as JSON |
| `blocks` / `add <name>` | Ready-made, editable blocks |
| `install` / `doctor` | Get Chrome / check the setup |
| `bench [file]` | Measure speed on your machine |

Render options: `--quality draft|standard|high|max`, `--fps`, `--scale 2` (4K from a 1080p layout), `--frames 2s-5s`, `--transparent` (ProRes 4444 or VP9 alpha), `--motion-blur 8`, `--codec h265|av1`, `--hardware`, `--workers`, `--data file.json`, `--props '{…}'`.

## Blocks

Twenty plain-HTML building blocks you copy into your project and edit freely (`npx motionwright add <name>`):

title-card · lower-third · captions (word-by-word, from JSON or SRT) · code-window (syntax highlighting + typing) · bar-chart · line-chart · stat · checklist · steps · browser-window · phone · cursor (moves and clicks) · callout · compare (before/after) · quote · word-pop · logo-reveal · end-card · gradient-bg · grid-bg

```html
<mw-include src="blocks/lower-third.html" name="Ada Lovelace" role="Mathematician" data-start="1" data-duration="4"></mw-include>
```

## Examples

| Example | Shows |
|---|---|
| [`examples/product-promo`](examples/product-promo) | 22 s launch video: transitions, a fake product UI being built, cursor clicks, counters, music |
| [`examples/data-story`](examples/data-story) | Charts driven by `data.json` with `{{data.path}}` templating |
| [`examples/vertical-short`](examples/vertical-short) | 9:16 short with kinetic type and word-by-word captions |
| [`examples/code-explainer`](examples/code-explainer) | Typed code, a callout, a checklist |
| [`examples/generative`](examples/generative) | 1,400 canvas particles drawn as a pure function of time |
| [`examples/personalized`](examples/personalized) | One template, many videos (`--props`) |

```bash
npx motionwright render examples/product-promo/index.html -o out/promo.mp4
```

## Programmatic API

```js
import { render, check, snapshot, still, inspect } from 'motionwright';

await render('video.html', { output: 'out/video.mp4', quality: 'high', data: { name: 'Ada' } });
const report = await check('video.html');           // { ok, errors, warnings, issues: [...] }
const { sheet } = await snapshot('video.html');     // path to the contact sheet
```

## Performance

Measured on a small cloud VM (2 vCPU, no GPU), 1080p30, 300 frames:

| | Time |
|---|---|
| Naive loop: one browser, PNG screenshots, no frame reuse | 32.7 s |
| motionwright, 1 worker | 15.0 s (2.2× faster) |
| motionwright, auto workers | 13.3 s (2.5× faster) |

Same GSAP animation rendered by motionwright and HyperFrames on that machine: 22.2 s vs 36.8–40.0 s at the same quality. Method, caveats and the script to re-run it: [`benchmarks/vs-hyperframes`](benchmarks/vs-hyperframes). Run `npx motionwright bench` on your own hardware; more cores and a GPU help a lot.

Where the speed comes from:

1. **beginFrame capture.** On Linux and Windows, motionwright drives `chrome-headless-shell` with `HeadlessExperimental.beginFrame`: Chrome produces exactly one frame when asked, with no waiting for timers or vsync. (macOS uses fast screenshots.)
2. **Parallel browsers** render contiguous chunks; segments are joined without re-encoding.
3. **Static frame reuse.** The runtime knows when nothing on the page changed (no active animation, no clip change, no script) and the engine reuses the previous frame.
4. **Encoding overlaps capture**, with a fast but exact sRGB → BT.709 conversion.
5. **Cheap backgrounds.** Built-in blocks avoid expensive full-frame filters (e.g. gradient blobs are drawn small on a canvas and scaled up).

## How it works

```
HTML ──► local server (injects runtime, expands <mw-include>, {{data}}, serves video frames)
           │
           ▼
 headless Chrome × N  ── runtime: virtual clock, clips, seek all animations to t
           │  beginFrame / screenshot (JPEG or PNG)
           ▼
      ffmpeg × N (segments) ──► concat + audio mix ──► out.mp4
```

- Every `CSSAnimation`, `CSSTransition` and Web Animation is paused and set to the right time for each frame. Animations start at the start of their clip, so `animation-delay` means "after this element appears".
- `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date` and `performance.now` run on virtual time. Code that relies on `requestAnimationFrame` history is fast-forwarded frame by frame so parallel workers match a single worker exactly.
- `<video>` is decoded by ffmpeg into exact frames and shown through the element itself, so your CSS still applies. Audio from `<audio>` and `<video>` is mixed by ffmpeg.

## Requirements

- Node.js 20+
- ffmpeg on your PATH (`brew install ffmpeg`, `sudo apt install ffmpeg`, `winget install ffmpeg`) or `MOTIONWRIGHT_FFMPEG=/path/to/ffmpeg`
- Chrome: `npx motionwright install` downloads `chrome-headless-shell` (Chrome for Testing). It also finds an existing Chrome, or use `MOTIONWRIGHT_CHROME=/path`.

motionwright itself has **zero npm dependencies**.

## License

MIT. motionwright does not bundle Chrome or ffmpeg; they are downloaded or installed separately under their own licenses. Example music and images in this repo were generated for it and are MIT too. Fonts are not bundled: use your own, or ones from your system.

This project was written from scratch. It shares the idea of "render a web page into a video" with tools like another framework and HyperFrames, but no code from them.
