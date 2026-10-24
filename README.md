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
- **Timing with attributes.** `data-start`, `data-duration`, `data-sequence`, `data-cuts="0 2.1 4.3"`, and 27 scene transitions including `morph` (shared elements fly from one scene into the next), `push`, `whip`, `zoom-through`, `flip`, `clock`.
- **Motion with attributes.** `data-enter="mask-up"`, `data-exit="fade"`, `data-split="words"` + `data-stagger="0.06"`, `data-camera="push 1.1, float"`, `data-fit="grow"`, `data-scramble`, `data-count`, `data-type`, `data-loop` / `data-freeze` / `data-speed`.
- **Choreography in code when you need it.** A built-in GSAP-style timeline (`mw.timeline().from('h1 .mw-word', {y: 80, stagger: .05})`) where every value is computed from the time, a camera that frames and follows elements (`mw.camera('#world').shot(2, {follow: '#pkg', zoom: 1.6})`), motion along paths with stops, shape and path morphs, springs, noise.
- **Music that drives the edit.** `npx motionwright audio music.mp3` prints the tempo, beats and bar starts; `mw.audio()` gives loudness, frequency bands and a beat pulse for any frame. Volume curves, ducking under voice-over, soundtrack export.
- **React too, if you want it.** Write `video.jsx` with `motionwright/react` (`<Scene>`, `<Sequence>`, `useTime()`); same engine, same commands. We tested both with blind judges: plain HTML scored as well or better, so it stays the default ([experiment](docs/experiments/2026-10-format-test.md)).
- **Plays anywhere.** `motionwright bundle` makes a standalone page, and `<mw-player>` embeds it in any site or app with controls and sound.
- **Eyes for the agent.** `check` finds text that is cut off, off-screen, overlapping, too small or low-contrast, plus broken assets and script errors, each with a fix. It compares frames, so moving, fading or hidden text does not cause false alarms. `snapshot` makes one contact-sheet image of every scene (or a frame-by-frame strip of one move) so the agent can *look* at its video, and `inspect --at 3.2 --el "#logo"` says where anything is at any moment.
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
| `inspect [file]` | Timeline as JSON; `--at 3.2 --el "#logo"` for where elements are at a moment |
| `audio <file>` | Tempo, beats, bar starts and big hits of a song |
| `analyze <video.mp4>` | Report on any video (a reference, or your render): shots and cuts, transitions, camera, pacing, colors, cuts on the beat, contact sheets. `--compare ref.mp4` lists how yours differs |
| `bundle [file] -o dir` | Standalone page + `<mw-player>` to embed the video in any site |
| `blocks` / `add <name>` | Ready-made, editable blocks |
| `install` / `doctor` | Get Chrome / check the setup |
| `bench [file]` | Measure speed on your machine |

Render options: `--quality draft|standard|high|max`, `--fps`, `--scale 2` (4K from a 1080p layout), `--frames 2s-5s`, `--transparent` (ProRes 4444 or VP9 alpha), `--motion-blur 8`, `--codec h265|av1`, `--hardware`, `--workers`, `--muted`, `--data file.json`, `--props '{…}'`. `-o sound.mp3` exports only the soundtrack.

## Blocks

Plain-HTML building blocks you copy into your project and edit freely (`npx motionwright add <name>`):

title-card · lower-third · captions (word-by-word, from JSON or SRT) · code-window (syntax highlighting + typing) · bar-chart · line-chart · stat · checklist · steps · browser-window · phone · cursor (aims at real elements, hovers, clicks) · callout · compare (before/after) · quote · word-pop · logo-reveal · end-card · gradient-bg · grid-bg · lottie (After Effects animations, frame-exact)

```html
<mw-include src="blocks/lower-third.html" name="Ada Lovelace" role="Mathematician" data-start="1" data-duration="4"></mw-include>
```

## Examples

| Example | Shows |
|---|---|
| [`examples/product-promo`](examples/product-promo) | 22 s launch video: transitions, a fake product UI being built, cursor clicks, counters, music |
| [`examples/data-story`](examples/data-story) | Data story where every number and chart shape comes from `data.json` (try `--data examples/data-story/other.json`): a camera that rides the line, bars, a gauge |
| [`examples/vertical-short`](examples/vertical-short) | 9:16 short: kinetic type synced to word-timed captions, cuts on the music's beats |
| [`examples/code-explainer`](examples/code-explainer) | Code that types itself, a camera that zooms into one line, and the idea drawn as a timeline |
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
