---
name: motionwright
description: Make videos from HTML + CSS with motionwright (HTML in, MP4 out). Use when asked to create, edit, check or render a video, animation, motion graphic, explainer, promo, title card, lower third, animated chart, captions/subtitles, social clip, or any MP4/WebM/GIF/ProRes made with code.
---

# motionwright — HTML in, video out

A composition is one HTML file. Every frame is that page at a moment in time. CSS animations, transitions, Web Animations, timers, `requestAnimationFrame`, canvas and WebGL all run on a virtual clock, so what you write renders frame-exact and identically every time.

## The loop (always do all four)

1. Write or edit the `.html` composition.
2. `npx motionwright check video.html` — fix every ✖ error. Fix ⚠ warnings unless you meant it.
3. `npx motionwright snapshot video.html` — **open `snapshots/sheet.png` and look at it.** It shows the key moment of every scene. Fix anything that looks wrong, cramped, cut off, or ugly. Repeat 2–3.
4. `npx motionwright render video.html -o out/video.mp4`

Use `--json` on any command for machine-readable output. `npx motionwright still video.html -t 3.2 -o f.png` renders one exact moment. Humans preview with `npx motionwright dev video.html` (scrub, play, frame-step, live reload).

## Minimal composition

```html
<!doctype html>
<html data-width="1920" data-height="1080" data-fps="30">
<head>
<style>
  body { background: #0b0d12; color: #fff; font-family: Inter, system-ui, sans-serif; }
  .scene { display: grid; place-items: center; }          /* .scene is already absolute + full frame */
  h1 { font-size: 120px; letter-spacing: -0.03em; margin: 0; }
</style>
</head>
<body>
  <main data-sequence data-transition="fade 0.6">
    <section class="scene" data-duration="3">
      <h1 data-enter="rise">Hello</h1>
    </section>
    <section class="scene" data-duration="4">
      <h1 data-split="words" data-enter="fade-up 0.6" data-stagger="0.08">Any HTML. Any CSS.</h1>
    </section>
  </main>
</body>
</html>
```

No script tag or import is needed: the runtime and a preset stylesheet are injected for you.

## Timing model (read this)

- Settings live on `<html>`: `data-width`, `data-height` (even numbers), `data-fps` (default 30), optional `data-duration`, optional `data-background`.
- Times are seconds: `1.5`, `1.5s`, `500ms`, `45f` (frames), `1:02.5`.
- **Clips.** An element with `data-start`, `data-duration` or `data-end` only exists (is `display`ed) from start to start+duration. Times are relative to its parent clip. Elements without timing are always there.
- **Video length** = `data-duration` on `<html>`, otherwise the end of the last clip.
- **Sequences.** `data-sequence` on a container plays its children one after another. Every child needs `data-duration`. Options: `data-gap="0.2"` (negative = overlap), `data-transition="<name> <seconds> [easing]"` which overlaps neighbours and animates the change.
  Transitions: `fade` `slide-left` `slide-right` `slide-up` `slide-down` (push) `wipe-left` `wipe-right` `wipe-up` `wipe-down` `zoom` `blur` `iris` `fade-up`.
- **CSS animations run on clip time.** `animation: fade-up .6s .4s both` starts .4s after its clip appears, in every frame of the render. Use `both` (or `backwards`) fill so the element is hidden before its delay.
- Timers, `requestAnimationFrame`, `Date.now()`, `performance.now()` are virtual and `Math.random()` is seeded. Normal web animation code just works.

## Built-in motion (no JavaScript)

| Attribute | What it does |
|---|---|
| `data-enter="<preset> [dur] [delay] [easing]"` | Animate in at the start of the element's clip. Defaults: `.6s`, `out-expo`. |
| `data-exit="<preset> [dur] [delay] [easing]"` | Animate out so it finishes at the clip end (delay counts back from the end). |
| `data-stagger="0.08"` | Apply enter/exit to each child (or each split piece) with increasing delay. |
| `data-split="words\|chars\|lines"` | Wrap pieces in `.word` / `.char` spans with `--i` (index) and `--n` (count) for your own CSS. |
| `data-count="0 1250"` | Count up. Also `data-count-duration` (1.6), `-delay`, `-prefix`, `-suffix`, `-decimals`, `-ease`, `-group="false"`. |
| `data-type="30"` | Typewriter at 30 chars/sec, keeps inner markup. Also `data-type-delay`, `data-type-caret`. |

Presets (motion is named by direction of travel): `fade` `fade-up` `fade-down` `fade-left` `fade-right` `rise` (up + unblur) `scale` `pop` (overshoot) `zoom` (from big) `blur` `slide-up/down/left/right` (by own size) `wipe-right/left/up/down` `iris` `draw` (SVG strokes) `none`.
Easings: `linear` `ease` `in-cubic` `out-cubic` `in-out-cubic` `out-quart` `out-expo` `in-out-expo` `out-back` `in-out-back` `out-circ` `spring` `bouncy` `snappy` `gentle`.

Enter/exit use the `translate`, `scale`, `opacity`, `filter`, `clip-path` properties, so they combine with your own `transform`. Do not also animate `opacity` on the same element in your CSS; wrap it instead.

## Preset CSS you can use

- Keyframes: `fade-in` `fade-out` `fade-up` `fade-down` `fade-left` `fade-right` `scale-in` `pop-in` `zoom-in` `blur-in` `slide-in-up/down/left/right` `wipe-right/left/up/down` `draw` `spin` `float` `pulse` `shimmer` `blink`.
  Example: `animation: pop-in .5s var(--ease-out-back) .3s both;`
- Easing variables: `--ease-out-expo` `--ease-out-back` `--ease-in-out-cubic` `--ease-spring` `--ease-bouncy` `--ease-snappy` `--ease-gentle` and the usual `--ease-in/out/in-out-{quad,cubic,quart,expo,back}`.
- `var(--px)` = 1px at 1080p, so `calc(var(--px) * 48)` scales with the video height. `var(--stage-w)` / `var(--stage-h)` = frame size.
- Stagger with split text: `.title .word { animation: fade-up .5s var(--ease-out-expo) calc(var(--i) * 60ms) both; }`
- SVG line drawing: `<path pathLength="1" style="stroke-dasharray:1; animation: draw 1.2s var(--ease-in-out-cubic) both">`.

## JavaScript (when CSS is not enough)

```js
mw.onFrame((t, info) => { box.style.rotate = `${t * 90}deg`; });        // t = seconds; info.frame, info.progress
mw.onFrame('#scene2', (local, info) => { /* local time while that clip is on screen */ });
mw.interpolate(t, [0, 1, 2], [0, 300, 0], { easing: 'out-cubic' });     // numbers or colors; clamps by default
mw.spring(t, { from: 0, to: 1, stiffness: 170, damping: 26, delay: 0.2 });
mw.noise(t), mw.lerp(a, b, p), mw.clamp(v), mw.ease.outExpo(p)
mw.data            // JSON passed with --data / --props, or <script type="application/json" id="mw-data">
mw.width, mw.height, mw.fps, mw.duration
mw.wait(promise)   // hold rendering until it resolves (fetch JSON, load a model…)
```

Rules for seekable JS:
- In `onFrame`, compute everything from `t`. Don't accumulate state between calls.
- Don't toggle classes inside `onFrame` to start CSS transitions; they can't be seeked. To do something "at 2s", use `setTimeout(fn, 2000)` (virtual and exact) or give the element `data-start="2"`.
- Canvas / WebGL / three.js: draw inside `onFrame`. GSAP (bring your own copy): `const tl = gsap.timeline({ paused: true }); mw.onFrame(t => tl.seek(t));`. Lottie: `mw.onFrame(t => anim.goToAndStop(t * 1000))`.

## Media

```html
<video src="clip.mp4" data-start="2" data-duration="4" data-from="1.5" data-rate="1" data-volume="0.8" muted loop></video>
<audio src="music.mp3" data-volume="0.4" data-fade-in="1" data-fade-out="2" loop></audio>
```
- Video is decoded frame-exact by ffmpeg (any codec); style the `<video>` element with CSS as usual. `data-from` = where to start in the source. `muted` drops its audio.
- Audio is mixed by ffmpeg: `data-start`, `data-duration`, `data-from`, `data-rate`, `data-volume`, `data-fade-in`, `data-fade-out`, `loop`.
- Paths are relative to the HTML file. Use local fonts (`@font-face` with a file) for identical results on every machine.

## Templates and blocks

- Data: `npx motionwright render v.html --props '{"title":"Q3 results"}'` (or `--data file.json`) then `<h1 data-bind="title">`, `<img data-bind-src="logo">`, `data-bind-style-color="brand"`, or `mw.data` in JS.
- Reuse: `<mw-include src="parts/intro.html" title="Hi" data-start="2">optional inner HTML</mw-include>` inserts the file; `{{title}}` / `{{title|default}}` / `{{content}}` are replaced.
- Ready-made blocks: `npx motionwright blocks` lists them; `npx motionwright add lower-third captions` copies them into `./blocks/`. Each file's header shows its params and usage. Blocks: title-card, lower-third, captions, code-window, bar-chart, line-chart, stat, checklist, steps, browser-window, phone, cursor, callout, compare, quote, word-pop, logo-reveal, end-card, gradient-bg, grid-bg.

## Making it look good

- Layout for 1920×1080: keep text ≥ 96px from the edges. Titles 96–160px, body ≥ 36px, captions ≥ 56px. Max ~10 words on screen at once.
- One idea per scene, 2.5–5s each. Let things hold ≥ 1s after they land before the next change.
- Enter with ease-out (`out-expo`, `out-back`, `spring`), exit with ease-in, and keep exits shorter than entrances. Stagger 40–90ms between items.
- Animate `opacity`, `translate`, `scale`, `rotate`, `filter`, `clip-path`. Avoid animating `width`/`height`/`top`/`left` (slower, jittery).
- Prefer depth: soft gradients, subtle grain, shadows, slight blur on entrance. Avoid pure #000 backgrounds and pure #fff text on busy images (add a scrim).
- Use `.scene` for full-frame scenes and absolute layout inside; use flex/grid for groups.

## Render options

`-o out.mp4|.webm|.mov|.gif|folder/` · `--quality draft|standard|high|max` · `--fps 60` · `--scale 2` (4K from a 1080p layout) · `--frames 0-90` or `2s-5s` · `--transparent` (with `.mov` ProRes 4444 or `.webm`) · `--motion-blur 8` · `--codec h265|av1` · `--hardware` · `--workers N` · `--data f.json` · `--props '{…}'` · `--seed 7` · `--force`.

## Check codes

| Code | Meaning / fix |
|---|---|
| `text-offscreen` | Text runs past the frame edge. Smaller font, `max-width`, or move it. |
| `text-clipped` | Text cut by an `overflow:hidden` box. Make it fit or let it wrap. |
| `text-overflows-box` | Text spills out of its card/background. Add padding/width or shorten. |
| `text-overlap` | Two texts on top of each other while settled. Move one or change timing. |
| `tiny-text` | Hard to read in a video. Use ≥ 24px at 1080p. |
| `low-contrast` | Text blends into what is behind it. Change color or add a backing/shadow. |
| `image-broken`, `http-404`, `video-frame` | A file path is wrong (paths are relative to the HTML file). |
| `bad-time`, `bad-enter`, `bad-transition`, `sequence-missing-duration`, `no-duration` | Fix the attribute as the message says. |
| `non-seekable-animation` | A CSS animation started inside `onFrame`; use `data-start` or set styles from `t`. |
| `script-error`, `console-error` | Your JS threw; the message has the stack. |

Checks skip elements that are mid-animation; look at `sheet.png` for motion problems.
