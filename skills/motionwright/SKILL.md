---
name: motionwright
description: Make videos from HTML + CSS with motionwright (HTML in, MP4 out). Use when asked to create, edit, check or render a video, animation, motion graphic, explainer, promo, title card, lower third, animated chart, captions/subtitles, social clip, or any MP4/WebM/GIF/ProRes made with code.
---

# motionwright — HTML in, video out

A composition is one HTML file. Every frame is that page at a moment in time. CSS animations, transitions, Web Animations, timers, `requestAnimationFrame`, canvas and WebGL all run on a virtual clock, so what you write renders frame-exact and identically every time.

## The loop (always do all four)

1. Write or edit the `.html` composition.
2. `npx motionwright check video.html` — fix every ✖ error. Fix ⚠ warnings unless you meant it. (Exit code 1 when there are errors.) The report starts with a motion strip, one mark per half second (`▁` little changes, `█` the whole picture changes): use it to see the rhythm of the video, and look for long flat runs where it stalls.
3. `npx motionwright snapshot video.html` — **open `snapshots/sheet.png` (next to the HTML file) and look at it** (`-o review2` writes to another folder so you can compare). It shows the key moment of every scene. Fix anything that looks wrong, cramped, cut off, or ugly. Repeat 2–3.
4. `npx motionwright render video.html -o out/video.mp4`

Use `--json` on any command for machine-readable output, and `<command> --help` for its options. `npx motionwright still video.html -t 3.2 -o f.png` renders one exact moment; `snapshot --times 2,5.5,9` shows exactly the moments you choose; `snapshot --from 3.2 --to 3.8 --every 1f` gives a frame-by-frame strip of one move; `snapshot --transitions` shows the start, middle and end of every scene change; `snapshot --grid` draws thirds, the center and the safe zone over the pictures; `inspect video.html --at 4.5 --el "#logo"` prints where an element is on screen at that moment (and which clips are on screen with their local time, the clock that `data-enter` delays and `at` options count in), and `inspect --at 2 --to 3 --el "#logo"` prints its position, size and opacity frame by frame (check easing and speed without watching). Humans preview with `npx motionwright dev video.html` (scrub, play, frame-step, live reload).

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
- **Sequences.** `data-sequence` on a container plays its children one after another. Every child needs `data-duration`, or give the container `data-cuts="0 2.13 4.27 6.41"` (when each child starts, e.g. the music's bar starts from `motionwright audio`) and the durations are worked out for you; the last child runs to the end of the video (or give it `data-duration`). With transitions, `data-cut-align="middle"` puts the middle of each transition on the cut time (so the change lands on the beat). Options: `data-gap="0.2"` (negative = overlap), `data-transition="<name> <seconds> [easing]"` which overlaps neighbours and animates the change.
  Transitions: `fade` `push-left/right/up/down` (new pushes old out) `cover-left/right/up/down` (new slides over) `whip-left/right/up/down` (fast, blurred) `wipe-left/right/up/down` `diagonal` `clock` `iris` `zoom` `zoom-through` (fly into the next scene) `flip` (3D) `dip` (through black) `blur` `fade-up`, and **`morph`**: elements with the same `data-morph="name"` in both scenes fly and resize from the old place to the new one while the rest crossfades (keynote "magic move"). Use it to carry a logo, card, photo or shape from one scene into the next. Pairs with different shapes (e.g. two texts) fly center to center and scale evenly; for a clean look give both the same look and proportions. Put `data-morph` on an element the camera or a path travel is not moving at the same time (wrap it).
  A child can set its own `data-transition` (how it comes in). **Each transition overlaps two scenes, so it takes its length off the total**: 3 scenes of 4s with `fade 0.5` last 11s. `npx motionwright inspect video.html` prints the real start/end of every clip.
- **CSS animations run on clip time.** `animation: fade-up .6s .4s both` starts .4s after its clip appears, in every frame of the render. Use `both` (or `backwards`) fill so the element is hidden before its delay.
- Timers, `requestAnimationFrame`, `Date.now()`, `performance.now()` are virtual and `Math.random()` is seeded. Normal web animation code just works.

## Built-in motion (no JavaScript)

| Attribute | What it does |
|---|---|
| `data-enter="<preset> [dur] [delay] [easing]"` | Animate in at the start of the element's clip. Defaults: `.6s`, `out-expo`. |
| `data-exit="<preset> [dur] [delay] [easing]"` | Animate out so it finishes at the clip end (delay counts back from the end). |
| `data-stagger="0.08"` | Apply enter/exit to each child (or each split piece) with increasing delay. |
| `data-split="words\|chars\|lines"` | Wrap pieces in `.mw-word` / `.mw-char` spans with `--i` (index) and `--n` (count) for your own CSS. |
| `data-count="0 1250"` | Count up. Also `data-count-duration` (1.6), `-delay`, `-prefix`, `-suffix`, `-decimals`, `-ease`, `-group="false"`. |
| `data-type="30"` | Typewriter at 30 chars/sec, keeps inner markup. Also `data-type-delay`, `data-type-caret` (a blinking caret; `data-type-caret="0.8"` removes it 0.8 s after the typing ends). |
| `data-scramble="1.2"` | Text decodes from random glyphs, left to right, over 1.2s. Also `data-scramble-delay`, `data-scramble-chars`. |
| `data-camera="push 1.1"` | Slow camera move over the clip (added on top of other transforms). Moves: `push [scale]` `pull [scale]` `move-left/right/up/down [px]` `rotate [deg]` `orbit [deg]` (3D) `float [px]` (gentle drift, default 14) `handheld [px]` (default 7) `shake [px] [from-to]` (an impact: rises and dies away inside its window, e.g. `shake 14 2.1-2.5`). Combine with commas: `"push 1.08, float"`. Optional window `"push 1.2 1-3"` (seconds into the clip) and easing. Put it on the scene or on a wrapper of the content. |
| `data-morph="logo"` | Shared element for `data-transition="morph"` (see Timing). |
| `data-fit` | Shrink the text until it fits its box (give the box a width/height). `data-fit="grow"` makes one line exactly fill the box width (great for big kinetic lines; `data-fit-max="300"` caps the size). |
| `data-loop="2"` `data-freeze="1.5"` `data-speed="0.5"` | On a clip: its content repeats every 2s / stops at 1.5s / plays at half speed (CSS animations, timeline, counters, video, onFrame). |

Classes the engine uses: `.scene` (full-frame layer), `.mw-word` / `.mw-char` (made by `data-split`), `.mw-caret`; everything else is yours.

Presets (motion is named by direction of travel): `fade` `fade-up` `fade-down` `fade-left` `fade-right` `rise` (up + unblur) `scale` `pop` (overshoot) `zoom` (from big) `blur` `slide-up/down/left/right` (by own size) `wipe-right/left/up/down` `iris` `draw` (SVG strokes) `none`, and for text and objects: `mask-up` `mask-down` `mask-left` `mask-right` (slides out from behind an invisible edge: the classic kinetic-type reveal, best with `data-split`) `flip-up` `drop` (falls in and bounces) `swing` `stretch` `tilt` `spin-in` `elastic` `grow` `grow-x` `grow-y` (bars, lines) `typewriter` (use with `data-split="chars"`) `write` (handwriting: the text appears left to right at pen speed; with `data-split="lines"` and `data-stagger` each line is written after the other). Each has good default timing.

**Something appears later inside a long scene** (one camera world, one whiteboard): the delay in `data-enter` counts from the start of the element's clip, so `data-enter="write 0.8 11.9"` writes a label 11.9 s into the scene and keeps it hidden until then. No extra clip needed.
Easings: `linear` `ease` `in/out/in-out-` + `sine` `quad` `cubic` `quart` `quint` `expo` `circ` `back` `elastic` `bounce`, springs `spring` `bouncy` `snappy` `gentle`, `steps(4)`, `cubic-bezier(…)`. GSAP names also work: `power2.out`, `back.out(1.7)`, `elastic.out(1,0.3)`, `sine.inOut`, `none`.

Enter/exit use the `translate`, `scale`, `opacity`, `filter`, `clip-path` properties, so they combine with your own `transform`. Do not also animate `opacity` on the same element in your CSS; wrap it instead.

## Preset CSS you can use

- Keyframes: `fade-in` `fade-out` `fade-up` `fade-down` `fade-left` `fade-right` `scale-in` `pop-in` `zoom-in` `blur-in` `slide-in-up/down/left/right` `wipe-right/left/up/down` `draw` `spin` `float` `pulse` `shimmer` `blink`.
  Example: `animation: pop-in .5s var(--ease-out-back) .3s both;`
- Easing variables: `--ease-out-expo` `--ease-out-back` `--ease-in-out-cubic` `--ease-spring` `--ease-bouncy` `--ease-snappy` `--ease-gentle` and the usual `--ease-in/out/in-out-{quad,cubic,quart,expo,back}`.
- `var(--px)` = 1px when the **short side** of the frame is 1080px (1920×1080, 1080×1920 and 1080×1080 all have `--px` = 1px; 4K has 2px). `calc(var(--px) * 48)` scales with the video. In JS: `mw.px`. `var(--stage-w)` / `var(--stage-h)` = frame size. Block sizes ("px at 1080p") use the same unit.
- Stagger with split text: `.title .mw-word { animation: fade-up .5s var(--ease-out-expo) calc(var(--i) * 60ms) both; }`
- SVG line drawing: `<path pathLength="1" style="stroke-dasharray:1; animation: draw 1.2s var(--ease-in-out-cubic) both">`.

## Timeline: precise choreography (GSAP-style API, built in)

For anything with more than a few moving parts, use `mw.timeline`. It is the GSAP API you know, but every value is computed from the time, so it renders frame-exact and in parallel. Times are seconds **relative to the clip that contains the scope** (or each target's own clip).

```js
mw.timeline('#scene2')                                     // scope: selectors are looked up inside it
  .from('.title .mw-word', { y: 120, opacity: 0, rotate: 8, stagger: 0.06, duration: 0.8, ease: 'expo.out' })
  .to('.card', { x: 400, scale: 1.2, duration: 1, ease: 'power3.inOut' }, '+=0.3')
  .fromTo('.bar', { scaleY: 0 }, { scaleY: 1, stagger: { each: 0.08, from: 'center' } }, '<')
  .to('#blob', { morph: mw.shape.star(5, 120), duration: 1.2 }, 2)   // shape morph
  .to('#line', { draw: 1, duration: 1.5 }, 2)                       // draw an SVG stroke (0..1, or "0.2 0.8")
  .to('.price', { textContent: 249, duration: 1.5 }, 2.5)           // count a number
  .to('.dot', { x: 'random(-200, 200)', y: 'random(-120, 120)' }, 3) // seeded random per target
  .addLabel('outro', 5).to('.all', { autoAlpha: 0 }, 'outro');
mw.to('#logo', { rotate: 360, duration: 2, delay: 0.5, repeat: -1, ease: 'none' });  // one-off tween
```
- Positions: number (seconds), `'<'` (with previous), `'>'` (after previous, default), `'+=0.3'`, `'-=0.2'`, `'<0.2'`, labels.
- Props: `x` `y` `z` `xPercent` `yPercent` `rotate` `rotateX` `rotateY` `scale` `scaleX` `scaleY` `skewX` `skewY` `transformPerspective` (written to `transform`), any CSS property (`backgroundColor`, `clipPath`, `filter`, `borderRadius`, `--css-var` …; colors blend in OKLab), `autoAlpha`, `attr: {cx: 50}`, `morph`, `draw`, `text` (type a new string), `textContent` (count). Options: `duration` (0.5) `ease` (`power1.out`) `delay` `stagger` (number, `{each, from: 'center'|'end'|'edges'|'random'|index, amount}`, or a function `(i, el) => seconds`) `repeat` `yoyo` `repeatDelay` `keyframes` `onUpdate(progress, el)`.
- `mw.timeline(scope, { repeat: -1, yoyo: true, delay: 1, global: true })` (global = times from the start of the video).
- The timeline uses `transform`, added on top of the element's own CSS transform (so `translate(-50%,-50%)` centering is kept). `data-enter`/`data-exit` use `translate`/`scale`, and `data-camera` adds on top, so all of them combine on one element.
- `from()` and `fromTo()` show their start values from the beginning of the clip until the tween starts (useful to keep things hidden until they enter); pass `immediateRender: false` to stop that. `hideBefore: true` on any tween keeps the element hidden (`visibility`) until that tween starts, without touching its other styles. `tl.set(el, {…}, time)` sets values instantly. When tweens overlap on the same property, the one that started last (in video time) wins, also across different timelines. The element's own CSS `transform` (e.g. `translate(-50%, -50%)` centering) is kept and the tween is added on top.
- SVG shapes scale and rotate around their own center unless you set `transform-origin`. A timeline transform replaces the SVG `transform="…"` attribute, so put the position on a parent `<g transform="translate(…)">` and animate the child (a gauge needle: `<g transform="translate(400 300)"><path id="needle" style="transform-origin: 0 0" …/></g>`). `draw` uses the stroke dashes itself, so it replaces your own `stroke-dasharray`; for a dotted line that draws on, draw a solid copy as a mask or reveal the dotted line with a `clip-path`.
- Plain objects work too (for canvas/three.js): `const s = { r: 0 }; mw.to(s, { r: 100, duration: 2 }); mw.onFrame(() => draw(s.r));`

## Camera over a world (maps, big diagrams, product tours)

Put everything in one big layer and point a camera at it. Shots frame elements, follow moving ones, and blend smoothly; the camera measures elements every frame, so it always lands on them.

```html
<section class="scene" data-duration="12">
  <div class="sky" data-parallax="0.3"></div>            <!-- moves 30% as much: depth -->
  <div id="world" style="position:absolute;left:0;top:0;width:3000px;height:1600px">…route, stops, #pkg…</div>
</section>
<script>
mw.camera('#world')                                        // times are seconds in the world's clip
  .shot(0,   { fit: '#route', padding: 80 })               // frame one or more elements: fit: ['#a', '.stop']
  .shot(1,   { follow: '#pkg', zoom: 1.6, duration: 1 })   // keep a moving element centered
  .shot(6.5, { fit: '.stop', padding: 120, duration: 1.5, ease: 'in-out-quart' })
  .shake(3.2, { duration: 0.35, amount: 14 });             // impact
</script>
```
Shot options: `fit` | `follow` | `center` (selector, list, `{x,y,w,h}`, `'all'` for the whole world, or `'content'` for everything drawn in it without the empty margins), `zoom` (with `fit` it multiplies: `1.05` = a bit closer), `padding` (screen px on each side of the framed elements, default 60), `offset: [x, y]` (moves where the camera looks, in world px: `+x` looks further right, so the subject slides left), `rotate`, `duration` (blend time from the previous shot), `ease`, `minZoom`, `maxZoom`. A shot's time is when the camera **starts** moving to it; it arrives `duration` later (so a last shot at 28 s with `duration: 2` is framed at 30 s). With `follow`, `zoom` is the world scale itself (1 = world px are screen px); with `fit` it multiplies the fitted scale. `npx motionwright inspect video.html` lists every shot with what it shows (`shows`: the world area x, y, w, h and the zoom), so you can see a framing before rendering. Shot times count from the start of the world's clip; `mw.camera('#world', { global: true })` uses video time instead. `mw.timing('#scene2').start` gives any clip's start time.

## Moving along a path

`mw.path.travel('#pkg', '#route', { stops: [[1, 0], [3.2, 0.5], [4.2, 0.5], [6.5, 1]], rotate: true, ease: 'in-out-cubic' })` moves an element along an SVG path: each stop is `[seconds in the clip that contains the moving element, progress 0..1]`, a repeated progress is a hold (a stop on the way). `rotate: true` turns it to face the direction of travel. The element can be HTML (a `<div>`, an `<img>`) or an SVG shape or `<g>` (it is centered on the path either way). `.progress(t)` gives the same answer at load time as during the video, so you can plan other moments from it. The returned object has `.progress(t)` so other things can follow it, e.g. draw the route behind it: `mw.onFrame('#world', t => route.style.strokeDasharray = trip.progress(t) + ' 2')` (with `pathLength="1"` on the path).

## Arrows between elements

`mw.connect('#browser', '#server', { curve: 0.2, draw: [2, 0.8] })` draws a line or arrow from the edge of one element to the edge of the other and keeps it attached every frame, while they move or the camera zooms. Options: `head` (`'end'` default, `'start'`, `'both'`, `'none'`), `curve` (bend, a share of the length: positive bends clockwise, so a left-to-right arrow sags down; negative bends up), `sketch: true` (hand-drawn), `draw: [start, duration]` (draws it on; seconds in the clip of the element that holds both), `color`, `width` (px), `gap` (px between arrow and element, default 10), `dash: '8 10'`, `behind: true` (under the elements), `in: '#world'` (which element holds the arrow), `from` / `to` (`'top'` `'right'` `'bottom'` `'left'` `'center'`: attach to the middle of that side; by default it attaches where the line between the two centers crosses each edge), `label: 'GET /'` (or `{ text, size, offset, color, font }`; hand-drawn arrows use Caveat: text halfway along, outside the bend; shown once the arrow is half drawn). Any element with an id works as an end, sketched SVG shapes too (they also work as camera targets). The arrow attaches to the element's whole box: aim at the part (the screen, not the whole laptop group) if the group is wide. `mw.rect('#el', '#world')` gives an element's box `{x, y, w, h, cx, cy}` in the world's own coordinates (camera zoom and pan do not change it), for placing your own SVG next to it.

## Hand-drawn (whiteboard, Excalidraw-style)

Add `data-sketch` to an SVG shape (`rect` `circle` `ellipse` `line` `polyline` `polygon` `path`), or to an `<svg>` / `<g>` to sketch every shape inside: each becomes rough, slightly wobbly strokes drawn twice by a quick hand, the same in every frame. A `fill` becomes hatching in that color (`data-sketch-fill="cross"` cross-hatch, `"solid"` a flat fill, `"none"`). Options: `data-sketch="1.5"` (roughness, default 1), `data-sketch-seed`, `data-sketch-gap` (hatch spacing), `data-sketch-angle`, `data-sketch-passes="1"`, `data-sketch-arrow="end"` (`start`, `both`: an arrowhead on a `path`, `line` or `polyline`). The shape keeps its id, classes and `data-enter` (and references your script took before, e.g. for a timeline, still work), so `data-enter="draw 1.2 3"` draws it on (both strokes, the hatching and a solid fill together, ending with the arrowhead), and `mw.path.travel('#pkg', '#route')` follows a sketched `#route` exactly.

```html
<svg viewBox="0 0 1920 1080" data-sketch style="position:absolute;inset:0">
  <rect x="160" y="300" width="420" height="260" fill="#ffd43b" stroke="#1e1e1e" stroke-width="5" data-enter="draw 1.2 0.5"/>
  <circle cx="900" cy="430" r="140" fill="#74c0fc" stroke="#1e1e1e" stroke-width="5" data-enter="draw 1 1.5"/>
</svg>
<h2 style="font-family: Caveat; font-size: 72px" data-enter="write 1 2.5">the server</h2>
```
- **`Caveat`** (a handwriting font, weights 400-700) is built in: `font-family: Caveat`. No file or download needed.
- **Marks on text** (any HTML text, also inside a camera world): `<span data-sketch-mark="highlight">93.184.216.34</span>` (also `underline`, `circle`, `box`, `strike`) draws a hand-made mark on it, right after the element's own `data-enter` (or at `data-sketch-mark-at="2.5"`, seconds in its clip; `data-sketch-mark-duration`, `data-sketch-mark-color`). The mark moves and fades with the text.
- **Hand-drawn boxes in HTML**: `data-sketch` on a `<div>` (a card, a pill, a button) replaces its CSS border with a sketched one in the same color and width.
- Path data for your own SVG (dynamic shapes, `onFrame`; passes are one continuous stroke, so `draw` goes around twice): `mw.sketch.rect(x, y, w, h)` `.line(x1, y1, x2, y2)` `.circle(cx, cy, r)` `.ellipse(cx, cy, rx, ry)` `.polygon(points)` `.polyline(points)` `.path(d)` (any path, redrawn by hand) `.arrow(x1, y1, x2, y2, { curve: 0.2, head: 22, heads: 'both' })` `.hachure(shape, { gap, angle, cross })` (shape = path data, points or `{x, y, w, h}`) `.underline(x1, y, x2, { loops: 2 })`. Options for all: `roughness`, `seed` (same seed = same drawing), `passes` (1-3). Put the result in a `<path d>` with `fill: none` and a stroke; `draw` draws it on.
- Use a light paper background (`#fbfaf6`), dark ink (`#1e1e1e`) and one or two accent colors (saturated, not pastel: `#1971c2`, `#e8590c`). Keep everything on one big world and move a `mw.camera` over it; earlier drawings stay, and a last shot that fits everything shows the whole diagram.
- **Camera craft (what judges rewarded):** stay close. Frame one step at a time so the handwriting reads big (labels 40 px or more on screen), keep the parts of the drawing close together so moves between them are short and never cross empty paper, and show the whole diagram only at the end (and briefly). A shot's time is when the move starts; put shots for things that appear later at least as late as they appear.
- **Size for the zoomed-out shots.** The final pull-back shows the world at maybe half size, so strokes and labels shrink with it: use 5-7 px strokes and labels of 48 px or more in world units (they then read as ~3 px and ~24 px in the overview). Judges called 3 px ink "thin and faint" and overview labels "tiny". Bold, simple drawings beat detailed thin ones; for the overview, fade out small notes and keep the big labels.

## Shapes and path morphs

- `mw.shape.circle(r)` `.rect(w, h, {r})` `.polygon(sides, r)` `.star(points, outer, inner)` `.heart(size)` `.wave(width, {amp, freq, phase})` `.blob(r, {t, wobble, points, seed})` return SVG path data centered on 0,0 (`{cx, cy}` to move). Animate a living blob: `mw.onFrame(t => path.setAttribute('d', mw.shape.blob(200, { t })))`.
- Morph any path into any other: timeline `{ morph: '#other' or 'M…' }`, or `const f = mw.path.morph(a, b); f(0.5)`.
- Point on a path: `mw.path.point(d, 0.3)` → `{x, y, angle}`. Or plain CSS: `offset-path: path('M…'); offset-rotate: auto;` and animate `offset-distance` from `0%` to `100%`.

## JavaScript (when CSS is not enough)

```js
mw.onFrame((t, info) => { box.style.rotate = `${t * 90}deg`; });        // t = seconds; info.frame, info.progress
mw.onFrame('#scene2', (local, info) => { /* local time while that clip is on screen; info.time = video time */ });
mw.interpolate(t, [0, 1, 2], [0, 300, 0], { easing: 'out-cubic' });     // numbers or colors; clamps by default
mw.spring(t, { from: 0, to: 1, stiffness: 170, damping: 26, delay: 0.2 });
mw.noise(t) /* smooth, 0..1 */, mw.lerp(a, b, p), mw.clamp(v), mw.ease.outExpo(p)
mw.burst('#scene3', { at: 2.1, kind: 'confetti', x: '50%', y: '60%' })  // also 'sparks', 'dust', 'bubbles'
//   at: seconds into #scene3 (add global: true for a video time, e.g. a beat or a voice word)
//   from: '#icon' throws from that element's center instead of x/y; behind: '#icon' draws under it
//   count, colors, size (px), speed (px/s), gravity (px/s²), duration (s), spread (deg), angle (deg, -90 = up)
mw.data            // JSON passed with --data / --props, or <script type="application/json" id="mw-data">
mw.beat(8), mw.bar(2)  // video time of beat 8 / bar 2 from <html data-bpm data-beat-offset data-bar-offset> (printed by `motionwright audio`); ready at once, so you can build timelines on the beat: tl.to(..., mw.beat(8)) in a { global: true } timeline
mw.width, mw.height, mw.fps, mw.duration
mw.wait(promise)   // hold rendering until it resolves (fetch JSON, load a model…)
mw.onLayout('#scene2', (local) => { /* runs after all animations are placed: measure with getBoundingClientRect, follow or aim at elements */ });
mw.color.mix('#ff0', 'oklch(60% .2 260)', 0.5), mw.mapRange(v, 0, 1, 10, 50), mw.wrap(v, 0, 360)
mw.random('dot-7')  // the same number in [0,1) for that seed, every frame and every render; mw.rng(seed) → generator
mw.log('pkg at', x)  // like console.log, but `check` and `inspect --at` print it with the video time (repeats are grouped)
```

Rules for seekable JS:
- In `onFrame`, compute everything from `t`. Don't accumulate state between calls.
- Don't toggle classes inside `onFrame` to start CSS transitions; they can't be seeked. To do something "at 2s", use `setTimeout(fn, 2000)` (virtual and exact) or give the element `data-start="2"`.
- Canvas / WebGL / three.js: draw inside `onFrame` (three.js: `preserveDrawingBuffer: true`). Libraries that animate with `requestAnimationFrame` (anime.js, Motion, GSAP) also work as they are, because the clock is virtual; `mw.timeline` is faster and frame-exact in parallel.
- Lottie (After Effects JSON): `<mw-include src="blocks/lottie.html" file="anim.json" width="500" height="500">` plays it on the video clock.
- Animated GIF / WebP / APNG in `<img>` play frame-exact on clip time (`data-loop="false"`, `data-rate`).

## Media

```html
<video src="clip.mp4" data-start="2" data-duration="4" data-from="1.5" data-rate="1" data-volume="0.8" muted loop></video>
<audio id="music" src="music.mp3" data-volume="0.4" data-fade-in="1" data-fade-out="2" data-duck="0.25" loop></audio>
<audio src="voice.mp3" data-start="1.5"></audio>
```
- Video is decoded frame-exact by ffmpeg (any codec); style the `<video>` element with CSS as usual. `data-from` = where to start in the source. `muted` drops its audio.
- Audio is mixed by ffmpeg: `data-start`, `data-duration`, `data-from`, `data-rate`, `data-volume`, `data-fade-in`, `data-fade-out`, `loop`. Volume curve: `data-volume="0:0 1:0.8 9:0.8 10:0"` (seconds in the clip : volume). `data-duck="0.25"` lowers music to 25% while any other sound plays (voice-over, video with sound).
- **Plan cuts on the beat first**: `npx motionwright audio music.mp3` prints the tempo, every beat, bar starts (downbeats), the biggest hits (best moments for a logo or a big cut) and quiet gaps. Beats sit on the kick drum.
- **React to sound**: `const music = mw.audio('#music')` (or a file path like `'music.mp3'`; call it once at the top of your script). In `onFrame(t => …)`: `music.level(t)` (0..1 loudness), `music.bass(t)` `music.mid(t)` `music.treble(t)`, `music.bands(t, 16)` (spectrum), `music.wave(t, 128)` (waveform), `music.beat(t, 0.25)` (1 on each beat, fading to 0: great for pulses), `music.beats` / `music.downbeats` / `music.onsets` (times in the video, to cut on the beat), `music.bpm`. To build a timeline from beats at load time: `mw.wait(music.ready.then(() => { const b = music.beats; mw.timeline().to('#logo', { scale: 1.2, duration: 0.2 }, b[4]); }))`. Beat lists only cover the part of the song that plays in the video.
- `render v.html -o sound.mp3` (or .wav/.m4a) exports only the soundtrack; `--muted` renders without audio.
- Paths are relative to the HTML file. Use local fonts (`@font-face` with a file next to the HTML) for identical results on every machine; `Caveat` (handwriting) is built in. Web fonts (a Google Fonts `<link>`) also load and the render waits for them, but they need the network on every render.

## Templates and blocks

- Data (one template, many videos): pass `--data file.json` or `--props '{"title":"Q3 results"}'` to any command (render, check, snapshot, still, inspect). With neither, a `data.json` next to the HTML is used, then `<script type="application/json" id="mw-data">{…}</script>` in the page (good for defaults). Use it anywhere in the HTML as `{{data.title}}`, `{{data.users[2]}}` or `{{data.stats.total}}`; an array becomes a comma list (`{{data.users}}` → `1200,1850,1700`, which is what the chart blocks take); `{{data.label|Monthly users}}` gives a default. In JS: `mw.data`. Also `<h1 data-bind="title">`, `<img data-bind-src="logo">`, `data-bind-style-color="brand"`. `check` warns when a `{{data.…}}` came out empty. Test a template with a second data file that has other values and a different number of items.
- Reuse: `<mw-include src="parts/intro.html" title="Hi" data-start="2">optional inner HTML</mw-include>` inserts the file; `{{title}}` / `{{title|default}}` / `{{content}}` are replaced.
- Layering: `.scene` is its own layer. Background blocks (`gradient-bg`, `grid-bg`) always sit behind the scene's content. Full-frame blocks (`title-card`, `end-card`, `quote`, `logo-reveal`, `word-pop`, `captions`, `callout`, `cursor`) cover the scene themselves; other blocks are normal boxes you place with flex/grid.
- `class`, `style`, `id` and `data-*` on `<mw-include>` go to a wrapper `div` around the block. Block parameters are any other attribute.
- Cursor demos: the `cursor` block aims at real elements: `points="1700,980 #email #submit! .menu li:nth-child(3)!"` (selector or x,y; `!` = click). It follows elements while they move, presses them, and sets `data-mw-hover` / `data-mw-pressed` on them so you can style hover and press.
- Ready-made blocks: `npx motionwright blocks` lists them; `npx motionwright add lower-third captions` copies them into `./blocks/`. Each file's header shows its params and usage. Blocks: title-card, lower-third, captions, code-window, bar-chart, line-chart, stat, checklist, steps, browser-window, phone, cursor, callout, compare, quote, word-pop, logo-reveal, end-card, gradient-bg, grid-bg, lottie.

## Make it feel like animation, not slides

The most common failure is a video that looks like a slideshow or a website: a centered box of text fades in, sits still, fades out. Motion design is different. Check your sheet against this list:

1. **Something always moves.** Give every scene a slow camera (`data-camera="push 1.06"`, `"float"`), living backgrounds (drifting gradients, shapes, particles, a morphing blob), and never leave the frame frozen for more than ~1s.
2. **Scenes flow into each other.** Prefer transitions with direction and continuity: `morph` (carry an element into the next scene), `push-*`, `whip-*`, `zoom-through`, or match cuts (an element ends where the next scene's element starts). Plain `fade` is the slideshow default; use it rarely.
3. **Choreograph, don't dump.** Elements arrive one after another (stagger 40-90ms), with overshoot and settle (`back.out`, `spring`, `bouncy`), and small secondary motion (a slight rotate that settles, a shadow that grows). Use `mw.timeline` to overlap moves (`'<0.1'`, `'-=0.2'`).
4. **Kinetic type.** Split headlines into words or chars and reveal them (`mask-up`, `flip-up`, `stretch`), scale up the key word, change its color, move the camera through the text. Big type (120-260px) beats paragraphs.
5. **Shapes over boxes.** Build visuals from SVG shapes, lines that draw on, icons made of simple paths, blobs and morphs. Rows of rounded cards on a grid look like a web page; use them only for UI demos, and then move the camera over the UI, zoom into the part that matters, and use the cursor.
6. **Rhythm.** Change something every 0.5-1.5s. With music, cut and pulse on the beat (`mw.audio(...).beats`, `.beat(t)`).
7. **Depth.** Layers that move at different speeds (parallax), soft shadows, blur on fast moves (`--motion-blur 8` at render), light and grain.

## Making it look good

- Layout for 1920×1080: keep text ≥ 96px from the edges. Titles 96–160px, body ≥ 36px, captions ≥ 56px. Max ~10 words on screen at once.
- Vertical 1080×1920 (Shorts/Reels/TikTok): the same pixel sizes work (the short side is 1080). Keep the top 220px and bottom 380px free of key text (app buttons and titles cover them) and 60px at the sides. Put `data-safe-zone="shorts"` (or `reels`, `tiktok`) on `<html>` and `check` warns about text in those edges (`unsafe-zone`), and `snapshot --grid` draws the zone. Preview how captions will page: `npx motionwright captions captions.json --words 3`. Titles 90–140px, captions 56–72px, max ~6 words per line.
- One idea per scene, 2.5–5s each. Let things hold ≥ 1s after they land before the next change.
- Enter with ease-out (`out-expo`, `out-back`, `spring`), exit with ease-in, and keep exits shorter than entrances. Stagger 40–90ms between items.
- Animate `opacity`, `translate`, `scale`, `rotate`, `filter`, `clip-path`. Avoid animating `width`/`height`/`top`/`left` (slower, jittery).
- Render cost: without a GPU, every big element that moves on its own, every `<canvas>`, and everything drawn on top of them is redrawn on each frame, and a `filter` on a big element doubles that. A big blurred glow that stays put is almost free. `npx motionwright bench video.html` prints how much of the frame these layers cover and the biggest ones.
- Prefer depth: soft gradients, subtle grain, shadows, slight blur on entrance. Avoid pure #000 backgrounds and pure #fff text on busy images (add a scrim).
- Use `.scene` for full-frame scenes and absolute layout inside; use flex/grid for groups.

## Learning from a reference video (and reviewing your render)

`npx motionwright analyze reference.mp4` turns any video into a report you can read: every shot with its length and camera move, the scene changes and their type (`cut` `fade` `dip` `wipe-*` `push-*` `zoom-in/out` `iris`, best guesses), a pacing strip, the palette (background, accents), where the detail sits, and how many cuts land on the beat. It ends with a style recipe in motionwright terms, and writes `analysis/<name>/sheet.png` (the whole video at even steps) and `shots.png` (start, middle, end of every shot): **open both**. To match a reference, analyze it first, build, render, then `npx motionwright analyze out/video.mp4 --compare reference.mp4`, which lists the differences ("yours: median shot 2.4 s, reference 0.9 s"). Transition types are guesses from the pixels; trust the shot times and the sheets more.

## Overlays with transparency

Leave `<html>` and `<body>` without a background, then `npx motionwright render overlay.html -o out/overlay.mov --transparent` (ProRes 4444) or `-o out/overlay.webm --transparent` (VP9 with alpha). `check` and `snapshot` detect a transparent page automatically: contrast is not judged against nothing, and the sheet shows a checkerboard. Pass `--transparent` to `still` for a PNG with alpha.

## Share and embed

`npx motionwright bundle video.html -o dist/` writes a standalone page (plays in any browser, no server), `mw-player.js` and a demo `player.html`. Embed in a site or app: `<script src="mw-player.js"></script><mw-player src="video.html" controls autoplay loop muted></mw-player>` (methods `play()`, `pause()`, `seekTo(s)`; events `ready`, `timeupdate`, `ended`; `data='{"name":"Ana"}'` feeds `mw.data`).

## React (JSX) compositions

You can also write a composition as a React component in `video.jsx`; every command works the same (`check video.jsx`, `render video.jsx`). See `react.md` next to this file.

## Render options

`-o out.mp4|.webm|.mov|.gif|out.mp3|folder/` · `--quality draft|standard|high|max` · `--fps 60` · `--scale 2` (4K from a 1080p layout) · `--frames 0-90` or `2s-5s` (only that part, as a new file) · `--redo 4s-7s` · `--no-cache` · `--transparent` (with `.mov` ProRes 4444 or `.webm`) · `--muted` · `--motion-blur 8` · `--codec h265|av1` · `--hardware` · `--workers N` · `--data f.json` · `--props '{…}'` · `--seed 7` · `--force`.

**Re-rendering is fast.** A render keeps the video in 1-2 s parts (in `.mw-parts/` next to the output) with a fingerprint of what each part shows. Render again after a fix and only the parts that changed are redone: edit one scene and only that scene's parts (plus the transitions into it) are rendered; change its length and the scenes after it move, so they are redone too; change shared CSS, a script, a file or the data and everything is redone. The joined video is byte-identical to a full render. `--redo 4s-7s` forces a part to be redone (e.g. when a script reads something the fingerprint cannot see); `--no-cache` keeps nothing.

## Check codes

| Code | Meaning / fix |
|---|---|
| `text-offscreen` | Text runs past the frame edge. Smaller font, `max-width`, or move it. |
| `text-clipped` | Text cut by an `overflow:hidden` box. Make it fit or let it wrap. |
| `text-overflows-box` | Text spills out of its card/background. Add padding/width or shorten. |
| `text-overlap` | Two texts on top of each other while settled. Move one or change timing. |
| `unsafe-zone` | Text where the app's buttons and titles cover vertical video (with `data-safe-zone` or `check --safe-zone shorts`). Move it inward, or `data-check="safe-ok"`. |
| `text-over-line` | A visible stroke (an arrow, a line, the edge of a box) runs through the letters. Move the label or the line, or give the label a backing. |
| `empty-frame` | Almost nothing on screen for a second or more in the middle of the video (a camera crossing empty space between parts, a gap between scenes, a zoom so far out that everything is a speck). |
| `still` | Little changes on screen for 2.5 s or more: nothing enters, leaves or moves, and a slow float or a faint glow does not count. Viewers read it as the video stalling. Cut the hold, start the next beat sooner, or end earlier. |
| `tiny-text` | Hard to read in a video. Use ≥ 24px at 1080p. |
| `low-contrast` | Text blends into what is behind it. Targets: 4.5:1 normal text, 3:1 large text (≥ 32px, or bold ≥ 24px), 1.6:1 for text with a `text-shadow` or outline. ✖ below two thirds of the target. Fix the color, or add a backing or shadow. |
| `image-broken`, `http-404`, `video-frame` | A file path is wrong (paths are relative to the HTML file). |
| `bad-time`, `bad-enter`, `bad-transition`, `sequence-missing-duration`, `no-duration` | Fix the attribute as the message says. |
| `non-seekable-animation` | A CSS animation started inside `onFrame`; use `data-start` or set styles from `t`. |
| `timeline-no-target`, `cursor-target` | A selector matched nothing. |
| `morph-no-pairs` | `morph` transition without matching `data-morph` names in both scenes. |
| `audio-not-found`, `audio-no-beats`, `audio-late` | `mw.audio()` found no file/element, found no steady beat, or was called after the video started. |
| `camera-no-world`, `travel-no-element` | A selector given to `mw.camera` / `mw.path.travel` matched nothing. |
| `load-timeout` | Something given to `mw.wait()` never finished. |
| `script-error`, `console-error` | Your JS threw; the message has the stack. |

Inside a `mw.camera` world, text sliding past the frame edge is fine, but a label that stays mostly in view and cut for 0.3 s or more is a warning: when the camera zooms in, frame the shot so the labels it is showing fit. When the crop is on purpose (zoomed into one line of code, a big word bleeding off), put `data-check="crop-ok"` on that text or a parent. Times in the report also say how far into the scene the problem is.

How check decides: it compares frames, so anything moving or fading (CSS, timeline, React, onFrame, a camera follow) is skipped while it moves, and a problem must last ~0.25s to count. Text that is fully hidden (outside the frame, behind a mask, waiting to slide in) or covered by something solid is not judged. Mark decorative copies (echoes, ghosts, outlines) with `data-check="ignore"`, and layers that are meant to run past the frame edge (a film strip, a ticker, a big word bleeding off) with `data-check="crop-ok"`. Re-check one moment fast with `check --at 7.5`, or part of the video with `--from 6 --to 9`. Problems list every time range they happen in.
