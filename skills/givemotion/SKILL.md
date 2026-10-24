---
name: givemotion
description: Makes videos from HTML + CSS + JS with givemotion and renders MP4/WebM/GIF/ProRes. Use for any request to create, edit, check or render a video, animation, motion graphic, explainer, promo, logo sting, title card, lower third, animated chart or data story, captions, whiteboard/hand-drawn video, UI or product demo, or vertical social clip, or when a givemotion composition is open.
metadata:
  version: "0.1.0"
---

# givemotion: HTML in, video out

A composition is one HTML file. Every frame is that page at a moment in time. CSS animations, transitions, Web Animations, timers, `requestAnimationFrame`, canvas and WebGL all run on a virtual clock, so what you write renders frame-exact and identically every time. No script tag or import is needed: the runtime (`window.gm`) and a preset stylesheet are injected for you.

This file is the core. Full APIs live in `references/` next to this file; the table at the end says what to read when. Read a file when you first need it, not all of them.

## The loop (always do all five)

0. **Plan.** Read the brief. Read `references/motion-design.md` (once per session), pick one look from `references/styles.md`, and read the genre file if one fits (table below). Then write a shot list as a comment at the top of the HTML, one line per scene: time range, what is on screen, the camera, and how it moves into the next scene.
   ```html
   <!-- shots
   0-3     hook: "Ship faster" mask-up words, 220px, push 1.08     → whip-left
   3-8     one world: fit #dashboard, then follow #chart head        → morph #logo
   8-11    payoff: "40x" count-up + burst + shake at 9.2             → end card 1.5s, still moving
   -->
   ```
1. **Write** or edit the `.html` composition.
2. `npx givemotion check video.html` — fix every ✖ error. Fix ⚠ warnings unless you meant it (exit code 1 when there are errors). Every issue prints its fix; `references/check-codes.md` explains each code. The report starts with a motion strip, one mark per half second (`▁` little changes, `█` the whole picture changes): use it to see the rhythm, and look for long flat runs where it stalls.
3. `npx givemotion snapshot video.html` — **open `snapshots/sheet.png` (next to the HTML file) and look at it.** It shows the key moment of every scene. Fix anything that looks wrong, cramped, cut off, empty or ugly; repeat 2–3. After a fix in one scene, look only at that scene: `snapshot --times 12,13.5` (more recipes in `references/review.md`).
4. `npx givemotion render video.html -o out/video.mp4`. Rendering again after a fix only redoes the parts that changed.

`--json` on any command for machine-readable output; `<command> --help` for its options. `still video.html -t 3.2 -o f.png` renders one exact moment; `inspect video.html` prints every clip's real start/end; `inspect --at 4.5 --el "#logo"` says where an element is at that moment. Humans preview with `npx givemotion dev video.html`.

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
  <main data-sequence data-transition="push-left 0.6">
    <section class="scene" data-duration="3" data-camera="push 1.06">
      <h1 data-enter="rise">Hello</h1>
    </section>
    <section class="scene" data-duration="4" data-camera="float">
      <h1 data-split="words" data-enter="mask-up 0.6" data-stagger="0.08">Any HTML. Any CSS.</h1>
    </section>
  </main>
</body>
</html>
```

Built-in fonts, no file or network needed (same on every machine): `Inter`, `JetBrains Mono`, `Playfair Display`, `Space Grotesk`, `Bebas Neue`, `Caveat` (handwriting). Pairings per look: `references/styles.md`.

## Timing model (read this)

- Settings live on `<html>`: `data-width`, `data-height` (even numbers), `data-fps` (default 30), optional `data-duration`, optional `data-background`.
- Times are seconds: `1.5`, `1.5s`, `500ms`, `45f` (frames), `1:02.5`.
- **Clips.** An element with `data-start`, `data-duration` or `data-end` only exists (is `display`ed) from start to start+duration. Times are relative to its parent clip. Elements without timing are always there.
- **Video length** = `data-duration` on `<html>`, otherwise the end of the last clip.
- **Sequences.** `data-sequence` on a container plays its children one after another. Every child needs `data-duration`, or give the container `data-cuts="0 2.13 4.27"` (when each child starts; also `"beats: 0 4 8"` / `"bars: 0 1 2"`). `data-gap="0.2"` (negative = overlap). `data-transition="<name> <seconds> [easing]"` overlaps neighbours and animates the change; a child can set its own `data-transition` (how it comes in). **Each transition takes its length off the total**: 3 scenes of 4s with `fade 0.5` last 11s. Cuts on the beat, `data-cut-align`, and where a scene's time 0 then sits: `references/timeline.md`.
- **Transitions:** `push-left/right/up/down` (new pushes old out) `cover-left/right/up/down` (new slides over) `whip-left/right/up/down` (fast, blurred) `wipe-left/right/up/down` `diagonal` `clock` `iris` `zoom` `zoom-through` (the old scene flies past the camera) `flip` (3D) `dip` (through black) `blur` `fade-up` `fade`, and **`morph`**: elements with the same `data-morph="name"` in both scenes fly and resize from the old place to the new one while the rest crossfades. Use it to carry a logo, card, number or shape into the next scene. Inside one scene, use `gm.fly` instead.
- **CSS animations run on clip time.** `animation: fade-up .6s .4s both` starts .4s after its clip appears. Use `both` (or `backwards`) fill so the element is hidden before its delay.
- **Something appears later inside a long scene** (one camera world, one whiteboard): the delay in `data-enter` counts from the start of the element's clip, so `data-enter="write 0.8 11.9"` writes a label 11.9 s into the scene and keeps it hidden until then. No extra clip needed.
- Timers, `requestAnimationFrame`, `Date.now()`, `performance.now()` are virtual and `Math.random()` is seeded. Normal web animation code just works.

## Quality rules (what blind judges rewarded and punished)

The most common failure is a video that looks like slides or a website: a centered box of text fades in, sits still, fades out. Check every sheet against this list. Numbers and recipes: `references/motion-design.md`.

1. **Something always moves.** Every scene gets a slow camera (`data-camera="push 1.06"`, `"float"`) and a living background (drifting gradients, shapes, particles, a morphing blob); never leave the frame frozen for more than ~1 s. Holds still for 1.5–2.5 s (mostly the end card) were the #1 complaint: end on motion, keep the end card ≤ 2 s.
2. **Frame 0 is the hook.** Something on screen and moving from the first frame (it is also the thumbnail). Nearly empty openings were marked down.
3. **Text is big enough on screen, after camera zoom.** 1920×1080: titles 96–160px (kinetic lines 120–260px), body ≥ 36px, captions ≥ 56px, secondary text (taglines, card subtitles, axis labels, code, labels in a wide shot) ≥ 32px. Keep text ≥ 96px from the edges, max ~10 words on screen at once. Small secondary text was the #2 complaint.
4. **Nothing cut by the frame.** In a camera shot, keep every label fully in or fully out of frame; frame the part you are talking about with room around it.
5. **Fill the frame with a clear subject.** No small UI in a big empty frame, no layouts crowded into one corner or the top half, no frames that go nearly empty mid-transition. One hero per moment; dim the rest.
6. **Scenes flow into each other.** Prefer transitions with direction and continuity: `morph`, `push-*`, `whip-*`, `zoom-through`, match cuts. Plain `fade` is the slideshow default; use it rarely, and never crossfade two text-heavy scenes (the texts ghost on top of each other). Often the best structure is one big world and a camera moving through it.
7. **Choreograph, don't dump.** Elements arrive one after another (stagger 40–90 ms) with overshoot and settle (`back.out`, `spring`, `bouncy`) and small secondary motion. Enter with ease-out (`out-expo`, `out-back`, `spring`), exit with ease-in, exits shorter than entrances. Overlap moves with `gm.timeline` (`'<0.1'`, `'-=0.2'`).
8. **Kinetic type over paragraphs.** Split headlines into words or chars and reveal them (`mask-up`, `flip-up`, `stretch`), scale up the key word, change its color, move the camera through the text.
9. **Shapes over boxes.** Build visuals from SVG shapes, lines that draw on, simple icons, blobs and morphs. Rows of rounded cards look like a web page; use them only for UI demos, and then move the camera over the UI, zoom into the part that matters, and use the cursor.
10. **Rhythm and variety.** Change something every 0.5–1.5 s; one idea per scene, 2.5–5 s; hold ≥ 1 s after a thing lands. Do not repeat the same layout or the same move in every scene. With music, cut and pulse on the beat.
11. **Depth and look.** Layers at different speeds (`data-parallax`), soft gradients, light, grain, shadows, slight blur on entrances; `--motion-blur 8` at render for fast moves. Avoid pure `#000` backgrounds and pure `#fff` text on busy images (add a scrim). Keep one look (palette, fonts, motion personality) for the whole video.
12. **Vertical 1080×1920:** the same pixel sizes work (the short side is 1080); keep the top 220px and bottom 380px free of key text, 60px at the sides; `data-safe-zone="shorts"` on `<html>` makes `check` warn. Titles 90–140px, captions 56–72px, max ~6 words per line.
13. Animate `opacity`, `translate`, `scale`, `rotate`, `filter`, `clip-path`, not `width`/`height`/`top`/`left` (slower, jittery). `.scene` for full-frame scenes, absolute layout inside, flex/grid for groups.

## Built-in motion (no JavaScript)

| Attribute | What it does |
|---|---|
| `data-enter="<preset> [dur] [delay] [easing]"` | Animate in at the start of the element's clip. Defaults: `.6s`, `out-expo`. |
| `data-exit="<preset> [dur] [delay] [easing]"` | Animate out so it finishes at the clip end (delay counts back from the end). |
| `data-stagger="0.08"` | Apply enter/exit to each child (or each split piece) with increasing delay. |
| `data-split="words\|chars\|lines"` | Wrap pieces in `.gm-word` / `.gm-char` spans with `--i` (index) and `--n` (count) for your own CSS. |
| `data-count="0 1250"` | Count up. Also `data-count-duration` (1.6), `-delay`, `-prefix`, `-suffix`, `-decimals`, `-ease`, `-group="false"`. |
| `data-type="30"` | Typewriter at 30 chars/sec, keeps inner markup. Also `data-type-delay`, `data-type-caret` (a blinking caret; `data-type-caret="0.8"` removes it 0.8 s after the typing ends). |
| `data-scramble="1.2"` | Text decodes from random glyphs, left to right, over 1.2s. Also `data-scramble-delay`, `data-scramble-chars`. |
| `data-camera="push 1.1"` | Slow camera move over the clip (added on top of other transforms). Moves: `push [scale]` `pull [scale]` `move-left/right/up/down [px]` `rotate [deg]` `orbit [deg]` (3D) `float [px]` (gentle drift, default 14) `handheld [px]` (default 7) `shake [px] [from-to]` (an impact: rises and dies away inside its window, e.g. `shake 14 2.1-2.5`). Combine with commas: `"push 1.08, float"`. Optional window `"push 1.2 1-3"` (seconds into the clip) and easing. Put it on the scene or on a wrapper of the content. |
| `data-parallax="0.3"` | Next to a `gm.camera` world: moves 30% as much as the world (depth). |
| `data-morph="logo"` | Shared element for `data-transition="morph"`. |
| `data-fit` | Shrink the text until it fits its box (give the box a width/height). `data-fit="grow"` makes one line exactly fill the box width (big kinetic lines; `data-fit-max="300"` caps the size). |
| `data-pulse="beat 0.06 0.25"` | Scale up on every beat of the `<html data-bpm>` grid (`references/media-audio.md`). |
| `data-loop="2"` `data-freeze="1.5"` `data-speed="0.5"` | On a clip: its content repeats every 2s / stops at 1.5s / plays at half speed (CSS animations, timeline, counters, video, onFrame). |

**Presets** (named by direction of travel): `fade` `fade-up` `fade-down` `fade-left` `fade-right` `rise` (up + unblur) `scale` `pop` (overshoot) `zoom` (from big) `blur` `slide-up/down/left/right` (by own size) `wipe-right/left/up/down` `iris` `draw` (SVG strokes) `none`, and for text and objects: `mask-up` `mask-down` `mask-left` `mask-right` (slides out from behind an invisible edge: the classic kinetic-type reveal, best with `data-split`) `flip-up` `drop` (falls in and bounces) `swing` `stretch` `tilt` `spin-in` `elastic` `grow` `grow-x` `grow-y` (bars, lines) `typewriter` (use with `data-split="chars"`) `write` (handwriting: the text appears left to right at pen speed; with `data-split="lines"` and `data-stagger` each line is written after the other). Each has good default timing.

**Easings:** `linear` `ease` `in/out/in-out-` + `sine` `quad` `cubic` `quart` `quint` `expo` `circ` `back` `elastic` `bounce`, springs `spring` `bouncy` `snappy` `gentle`, `steps(4)`, `cubic-bezier(…)`. GSAP names also work: `power2.out`, `back.out(1.7)`, `elastic.out(1,0.3)`, `sine.inOut`, `none`.

Enter/exit use the `translate`, `scale`, `opacity`, `filter`, `clip-path` properties, so they combine with your own `transform`, but they replace your own CSS `translate:`/`scale:` properties while they run: center with `transform: translate(-50%, -50%)`, `margin: auto` or a wrapper, not `translate: -50% 0`. Do not also animate `opacity` on the same element in your CSS; wrap it instead.

Classes the engine uses: `.scene` (full-frame layer), `.gm-word` / `.gm-char` (made by `data-split`), `.gm-caret`; everything else is yours.

## Preset CSS you can use

- Keyframes: `fade-in` `fade-out` `fade-up` `fade-down` `fade-left` `fade-right` `scale-in` `pop-in` `zoom-in` `blur-in` `slide-in-up/down/left/right` `wipe-right/left/up/down` `draw` `spin` `float` `pulse` `shimmer` `blink`. Example: `animation: pop-in .5s var(--ease-out-back) .3s both;`
- Easing variables: `--ease-out-expo` `--ease-out-back` `--ease-in-out-cubic` `--ease-spring` `--ease-bouncy` `--ease-snappy` `--ease-gentle` and the usual `--ease-in/out/in-out-{quad,cubic,quart,expo,back}`.
- `var(--px)` = 1px when the **short side** of the frame is 1080px (1920×1080, 1080×1920 and 1080×1080 all have `--px` = 1px; 4K has 2px). `calc(var(--px) * 48)` scales with the video. In JS: `gm.px`. `var(--stage-w)` / `var(--stage-h)` = frame size. Block sizes ("px at 1080p") use the same unit.

## Timeline: precise choreography (GSAP-style, built in)

For anything with more than a few moving parts, use `gm.timeline`: the GSAP API you know, but every value is computed from the time, so it renders frame-exact and in parallel. Times are seconds **relative to the clip that contains the scope**.

```js
gm.timeline('#scene2')                                     // scope: selectors are looked up inside it
  .from('.title .gm-word', { y: 120, opacity: 0, rotate: 8, stagger: 0.06, duration: 0.8, ease: 'expo.out' })
  .to('.card', { x: 400, scale: 1.2, duration: 1, ease: 'power3.inOut' }, '+=0.3')
  .fromTo('.bar', { scaleY: 0 }, { scaleY: 1, stagger: { each: 0.08, from: 'center' } }, '<')
  .to('#line', { draw: 1, duration: 1.5 }, 2)                       // draw an SVG stroke
  .to('.price', { textContent: 249, duration: 1.5 }, 2.5);          // count a number
gm.fly('#event', { from: '#slot2', at: 7.5, duration: 0.8 });      // fly from another element's box into its own place
```
`from()`/`fromTo()` show their start values from the beginning of the clip (keeps things hidden until they enter). When tweens overlap on the same property, the one that started last wins. Positions, all props and options, labels, keyframes, `gm.fly` and SVG caveats: `references/timeline.md`.

## Blocks

`npx givemotion blocks` lists ready-made blocks; `npx givemotion add lower-third captions` copies them into `./blocks/`, then `<gm-include src="blocks/captions.html" file="captions.json">`. Each file's header shows its params and usage. Blocks: title-card, lower-third, captions, code-window, bar-chart, line-chart, stat, checklist, steps, browser-window, phone, cursor, callout, compare, quote, word-pop, logo-reveal, end-card, gradient-bg, grid-bg, lottie. Custom visuals score better than stock blocks; use blocks for captions, code, cursor clicks, backgrounds (`references/data-templates.md`).

## What to read (rules)

| When… | Read first |
|---|---|
| Any video, before planning | `references/motion-design.md` (once) and `references/styles.md` (pick one look) |
| You use `gm.camera`, `data-parallax`, `gm.path.travel`, a map or big diagram, a product tour, or one object riding another | `references/camera.md` |
| The brief mentions a chart, graph, numbers over time, growth, a data story; or `gm.chart.line`, `line-chart`, `bar-chart` | `references/charts.md` |
| Arrows, flows, diagrams, whiteboard, hand-drawn, sketch, Excalidraw; `data-sketch`, `gm.connect`, `data-anchor`, `gm.shape`, path morphs | `references/diagrams.md` |
| Music, beats, voice-over, sound, a video clip, captions/subtitles; `<audio>`, `<video>`, `gm.audio`, `data-pulse`, `data-cuts` in beats | `references/media-audio.md` |
| Data-driven or personalized videos, templates, `{{data.…}}`, `--data`/`--props`, `<gm-include>`, blocks, the cursor block, UI clicks | `references/data-templates.md` |
| `gm.onFrame`, canvas, three.js, particles/confetti (`gm.burst`), springs, noise, seeded random, Lottie, animated GIFs | `references/javascript.md` |
| More than a few moving parts, staggers, labels, keyframes, `gm.fly`, SVG transforms; cut-align and morph details | `references/timeline.md` |
| Render options (4K, 60 fps, GIF, codecs), transparent overlays, cache and re-render, slow renders, bundle/embed, React/JSX | `references/output.md` (JSX: `references/react.md`) |
| Reviewing frames, checking one move, matching or learning from a reference video (`analyze`) | `references/review.md` |
| A `check` code you do not understand, or `data-check` | `references/check-codes.md` |

Genre files in `references/genres/` (structure, pacing, what judges marked down): `explainer.md`, `data-story.md`, `promo.md` (product launch), `ui-demo.md` (app demo), `code-explainer.md`, `logo-sting.md` (intro, sting), `vertical.md` (Short/Reel/TikTok), `hand-drawn.md` (whiteboard), `year-recap.md` (stats recap).
