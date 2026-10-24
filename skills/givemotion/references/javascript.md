# JavaScript: onFrame, helpers, particles, canvas

Purpose: the `gm.*` JavaScript helpers (frame callbacks, interpolation, springs, noise, seeded random, particles, logging) and the rules that keep scripts seekable.

Contents
- The gm API
- Particle bursts
- Rules for seekable JS
- Canvas, WebGL, libraries, Lottie, GIFs

## The gm API

```js
gm.onFrame((t, info) => { box.style.rotate = `${t * 90}deg`; });        // t = seconds; info.frame, info.progress
gm.onFrame('#scene2', (local, info) => { /* local time while that clip is on screen; info.time = video time */ });
gm.interpolate(t, [0, 1, 2], [0, 300, 0], { easing: 'out-cubic' });     // numbers or colors; clamps by default
gm.spring(t, { from: 0, to: 1, stiffness: 170, damping: 26, delay: 0.2 });
gm.noise(t) /* smooth, 0..1 */, gm.lerp(a, b, p), gm.clamp(v), gm.ease.outExpo(p)
gm.data            // JSON passed with --data / --props, or <script type="application/json" id="gm-data">
gm.beat(8), gm.bar(2)  // video time of beat 8 / bar 2 from <html data-bpm data-beat-offset data-bar-offset> (printed by `givemotion audio`); ready at once, so you can build timelines on the beat: tl.to(..., gm.beat(8)) in a { global: true } timeline
gm.width, gm.height, gm.fps, gm.duration, gm.px, gm.time
gm.timing('#scene2')   // { start, end, duration } of that clip in video time
gm.wait(promise)   // hold rendering until it resolves (fetch JSON, load a model…)
gm.onLayout('#scene2', (local) => { /* runs after all animations are placed: measure with getBoundingClientRect, follow or aim at elements */ });
gm.color.mix('#ff0', 'oklch(60% .2 260)', 0.5), gm.mapRange(v, 0, 1, 10, 50), gm.wrap(v, 0, 360), gm.snap(v, 10)
gm.random('dot-7')  // the same number in [0,1) for that seed, every frame and every render; gm.rng(seed) → generator; gm.pick(array, seed)
gm.log('pkg at', x)  // like console.log, but `check` and `inspect --at` print it with the video time (repeats are grouped)
gm.motion          // 'natural' (default) or 'classic' (<html data-motion="classic">): which motion defaults the engine uses
```
Shapes, paths and sketch path data (`gm.shape`, `gm.path`, `gm.sketch`): `references/diagrams.md`. Timeline and tweens: `references/timeline.md`. Audio analysis (`gm.audio`): `references/media-audio.md`. Charts (`gm.chart`): `references/charts.md`.

## Particle bursts

```js
gm.burst('#scene3', { at: 2.1, kind: 'confetti', x: '50%', y: '60%' })  // also 'sparks', 'dust', 'bubbles'
```
- `at`: seconds into `#scene3` (add `global: true` for a video time, e.g. a beat or a voice word).
- `x`, `y`: `'50%'` of `#scene3`'s box, or px at 1080p (`960` or `'960px'`); default the center.
- `from: '#icon'` throws from that element's center instead of x/y (and follows it; inside a camera world the particles pan and zoom with the camera); `behind: '#icon'` draws under that element (in its layer, so it works in camera worlds).
- `count`, `colors`, `size` (px), `speed` (px/s), `gravity` (px/s²), `duration` (s), `spread` (deg), `angle` (deg, -90 = up), `seed`.
- Defaults: confetti 160 / speed 1000 / size 17 / 2.8 s; sparks 80 / 1600 / 6 / 1 s; dust 60 / 260 / 6 / 2.2 s; bubbles 40 / 380 / 16 / 2.4 s.
- For a big hit, layer it: a burst of sparks + a ring (`tl.fromTo` scale/opacity) + `camera.shake` (or `data-camera="shake 14 2.1-2.5"`) at the same time. Keep particles off key text (judges marked down confetti and rays crossing numbers and headlines).

## Rules for seekable JS

- In `onFrame`, compute everything from `t`. Don't accumulate state between calls.
- Don't toggle classes inside `onFrame` to start CSS transitions; they can't be seeked (`check`: `non-seekable-animation`). To do something "at 2s", use `setTimeout(fn, 2000)` (virtual and exact) or give the element `data-start="2"`.
- Measure elements in `gm.onLayout`, not in `onFrame` (in `onFrame` boxes are from before this frame's animations).
- Script errors are reported with file and line (`script-error`, `console-error`); fix them first, they can cause misleading pacing warnings.

## Canvas, WebGL, libraries, Lottie, GIFs

- Canvas / WebGL / three.js: draw inside `onFrame` (three.js: `preserveDrawingBuffer: true`). Libraries that animate with `requestAnimationFrame` (anime.js, Motion, GSAP) also work as they are, because the clock is virtual; `gm.timeline` is faster and frame-exact in parallel.
- Lottie (After Effects JSON): `<gm-include src="blocks/lottie.html" file="anim.json" width="500" height="500">` plays it on the video clock (`lib="path/to/lottie.min.js"` for offline renders).
- Animated GIF / WebP / APNG in `<img>` play frame-exact on clip time (`data-loop="false"`, `data-rate`).
