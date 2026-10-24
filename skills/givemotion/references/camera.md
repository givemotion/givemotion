# Camera, paths, riding and parallax

Purpose: `gm.camera` over a big world (maps, diagrams, product tours), `data-parallax`, `gm.path.travel`, and one object riding another.

Contents
- Camera over a world
- Shot options
- Camera craft (what judges rewarded)
- Moving along a path
- One thing riding another

## Camera over a world

Put everything in one big layer and point a camera at it. Shots frame elements, follow moving ones, and blend smoothly; the camera measures elements every frame, so it always lands on them.

```html
<section class="scene" data-duration="12">
  <div class="sky" data-parallax="0.3"></div>            <!-- moves 30% as much: depth -->
  <div id="world" style="position:absolute;left:0;top:0;width:3000px;height:1600px">…route, stops, #pkg…</div>
</section>
<script>
gm.camera('#world')                                        // times are seconds in the world's clip
  .shot(0,   { fit: '#route', padding: 80 })               // frame one or more elements: fit: ['#a', '.stop']
  .shot(1,   { follow: '#pkg', zoom: 1.6, duration: 1 })   // keep a moving element centered
  .shot(6.5, { fit: '.stop', padding: 120, duration: 1.5, ease: 'in-out-quart' })
  .shake(3.2, { duration: 0.35, amount: 14 });             // impact
</script>
```
`data-parallax` layers are siblings of the world (or inside its parent): `0.3` moves 30% as much as the world, so they read as far away; use 0.2–0.5 for backgrounds.

## Shot options

- `fit` | `follow` | `center`: a selector, element, list, `{x,y,w,h}`, `'all'` for the whole world, or `'content'` for everything drawn in it without the empty margins.
- `zoom` (with `fit` it multiplies: `1.05` = a bit closer; with `follow`, `zoom` is the world scale itself: 1 = world px are screen px), `padding` (screen px on each side of the framed elements, default 60; too big a value is clamped with a warning), `offset: [x, y]` (moves where the camera looks, in world px: `+x` looks further right, so the subject slides left), `rotate`, `duration` (blend time from the previous shot), `ease`, `minZoom`, `maxZoom`.
- `overview: true`: a wide shot of the whole UI or map on purpose: `check` does not report small text while it holds; viewers still see tiny labels, so keep such shots short or scale the key labels up for them.
- A shot's time is when the camera **starts** moving to it; it arrives `duration` later (so a last shot at 28 s with `duration: 2` is framed at 30 s; to land a move on a beat, start it at `beat - duration`). Put shots for things that appear later at least as late as they appear.
- `follow` keeps up with anything that moves (timeline, path travel, `onFrame`, a chart head). It trails its target like an operator and settles when the target stops: `lag: 0.3` trails more, `lag: 0` locks on (default 0.15 s).
- **Back-to-back shots are one move.** When a shot starts within 0.25 s of the previous one arriving, the camera flows through the framings without stopping (it eases out of the first and into the last, and still frames each target exactly). Leave ≥ 0.3 s between shots, or put `blend: false` on a shot, when the camera should rest on it (`check` warns `camera-stop` when a camera brakes to a halt and sets off again).
- A fast zoom goes a touch past and settles (`overshoot: false` to turn off). Held shots breathe by a pixel or two: `gm.camera('#world', { breathe: false })` turns it off, a number scales it.
- **Depth:** background layers next to the world (grid-bg, gradient-bg, full-frame text-free layers behind it) drift slightly with the camera. Keep the background outside `#world` to get this. `data-parallax="0.3"` sets a layer's depth yourself (it wins), `data-parallax="0"` pins one, `gm.camera('#world', { depth: false })` turns it off.
- Shot times count from the start of the world's clip; `gm.camera('#world', { global: true })` uses video time instead. `gm.timing('#scene2').start` gives any clip's start time.
- `npx givemotion inspect video.html` lists every shot with what it shows (`shows`: the world area x, y, w, h and the zoom), so you can see a framing before rendering.
- Keep every label fully in or fully out of a held shot (a neighbour's label half in frame reads as a mistake; `check` reports it). `check` also warns (`camera-late`) when a shot would arrive after its scene starts to leave, and `camera-no-target` when a shot's target matches nothing.

## Camera craft (what judges rewarded)

- **One world, one route.** The best explainers put every step in one world and moved one camera through it (warehouse → highway → hub → door), with a short wide recap at the end.
- **Stay close.** Frame one step at a time so text reads big (labels ≥ 32 px on screen, handwriting ≥ 40 px). A `fit` on a small element zooms in far and can cut the labels next to it: fit the element and its label together (`fit: ['#server', '#server-label']`) or add `padding`.
- **Short moves.** Keep the parts of the world close together so moves between them are short and never cross empty space (`empty-frame` warns).
- **Lead room.** When following something that moves right, look ahead of it: `offset: [260, 0]` puts the subject left of center with room ahead.
- **Wide shots only briefly, at the end.** The final pull-back shows the world small; scale key labels up for it or fade small notes out. A fit of the layout box includes its empty space: use `fit: 'content'` or list the elements.
- **Impacts:** `.shake(t, { amount: 10–16, duration: 0.3–0.4 })` on a hit, with a burst (`references/javascript.md`) at the same time.
- Make the world bigger than the frame (2–3 frames wide) and design it as one picture; the edge of the world must not show in the final pull-back.

## Moving along a path

`gm.path.travel('#pkg', '#route', { stops: [[1, 0], [3.2, 0.5], [4.2, 0.5], [6.5, 1]], rotate: true, ease: 'in-out-cubic' })` moves an element along an SVG path: each stop is `[seconds in the clip that contains the moving element, progress 0..1]`, a repeated progress is a hold (a stop on the way). `rotate: true` turns it to face the direction of travel. The element can be HTML (a `<div>`, an `<img>`, an `<svg>`, also one with `data-sketch`) or an SVG shape or `<g>`. It is centered on the path; to ride beside it, `side: 'above'` (`'below'` `'left'` `'right'`, on screen) lifts it off the line by half its size plus a gap (`offset`, default 10 px), and `offset: -40` alone moves it 40 px (at 1080p) to the left of the direction of travel (above a left-to-right path; positive = right, below). Both follow the path's bends, with or without `rotate`.

`.progress(t)` gives the same answer at load time as during the video, so you can plan other moments from it, and other things can follow it, e.g. draw the route behind it: `gm.onFrame('#world', t => route.style.strokeDasharray = trip.progress(t) + ' 2')` (with `pathLength="1"` on the path). A travel also works along a `gm.connect` arrow and along a sketched path (`references/diagrams.md`).

## One thing riding another

A package on a robot, then on a truck: do not give the package its own travel with matching stops. Give each vehicle its own path (one leg each: `#leg1` shelf to dock, `#leg2` dock to hub) and its own `gm.path.travel`, and put one copy of the package on each vehicle: `<div class="pkg" id="pkgA" data-anchor="#robot center">` and `<div class="pkg" id="pkgB" data-anchor="#truck center">` (it follows the vehicle every frame; use `top 0` to sit on its roof). Hand over while both vehicles stand at the dock, where both copies are in the same spot: `gm.timeline().set('#pkgB', { autoAlpha: 0 }, 0).set('#pkgA', { autoAlpha: 0 }, 2.45).set('#pkgB', { autoAlpha: 1 }, 2.45)`. A vehicle with `rotate: true`: put the copy inside the vehicle element instead (a child turns with it). A leg ends where the next begins when the next path starts at the same point.
