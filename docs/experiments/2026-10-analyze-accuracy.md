# N5: `analyze` accuracy, measured

October 2026, 4 vCPU shared cloud machine. Question: how often does `motionwright analyze` find the scene changes of a
video, and how often does it name the transition right? Before this there was only an impression ("busy motion
graphics: about 3 of 5 found").

## The benchmark (`bench/analyze/`)

`node bench/analyze/score.mjs [--verbose] [--debug] [--tuning] [--only name,name] [--analyzer file.js]`

- Renders each case once (cached in `bench/analyze/out/`, redone when the HTML changes), takes the truth from `inspect`
  (every transition with start/end; a hard cut = a scene clip that starts where no transition is), runs `analyze`
  (no sheets, no audio) and matches detections to the truth.
- **Hit**: the detected `at` is within 0.25 s of the true midpoint (cut: the cut time), or inside the true transition.
  Each true change takes at most one detection (greedy by distance). Precision = hits / detections, recall = hits / truth.
- **Type** is right when it is in the transition's family: `push/slide/whip-dir` = `push-dir`; `cover-dir` = `push-dir`
  or `wipe-dir`; `wipe-dir` = `wipe-dir`; `fade`, `crossfade`, `blur`, `morph`, `fade-up` = `fade`; `zoom` = `zoom-out`;
  `zoom-through` = `zoom-in`; `iris` = `iris`; `dip` = `dip`; `diagonal` = any wipe; `clock` = `clock`/`other`/any wipe;
  `flip` = `flip`/`other`; `cut` = `cut`. Directions must match.
- `--analyzer` scores another copy of `analyze.js` (put it in `src/` so its imports resolve), e.g. the old one:
  `git show ad2f88a:src/analyze.js > src/old-analyze.js`.

Cases (13 videos, 65 true scene changes). The **held-out** ones were not looked at while tuning; they were scored once
at the end ("first look" below), then two generic fixes followed that a new probe video also needed (see the end).

| case | set | what it tests |
|---|---|---|
| plain-basic | tuning | plain colored scenes: cut, fade, dip, iris, push-left; text enters inside shots |
| plain-moves | tuning | wipe-right, cover-up, whip-down, zoom-through, push-down, cut |
| shared-gradient | tuning | one drifting gradient behind see-through scenes, small cards: fade, push-right, wipe-up, zoom, cut, iris, whip-left |
| busy-bg | tuning | a background that never stops (scrolling stripes, drifting dots, a turning ring) + motion in every scene: whip-up, iris, push-left, cut, dip, zoom-through |
| camera-in-shot | tuning | `mw.camera` over a world (fits, a fast pan, a pull-out), `push + float`, `move-left 700`: 2 true changes, the camera moves must not count |
| vertical-short | tuning | the repo example (shared gradient, constant motion): whip-up, zoom-through, push-left, whip-left, iris |
| product-promo | tuning | repo example: blur, slide-left, zoom, fade, iris |
| held-other | held-out | flip, blur, morph, diagonal, clock, cover-left on gradient scenes |
| held-busy | held-out | shared gradient + rising particles + floating camera, small content: whip-right, zoom-through, wipe-left, cut, fade, push-up, iris |
| held-vertical | held-out | 720x1280, panels, camera drift: push-left, cut, whip-up, dip, wipe-down, zoom |
| data-story, code-explainer, photosynthesis | held-out | repo examples (`mw.camera` worlds, slide-left between scenes) |

## Results

| | precision | recall | type right (of hits) | type right (of all changes) |
|---|---|---|---|---|
| tuning, baseline | 0.852 | 0.639 | 0.609 | 0.389 |
| **tuning, now** | **0.947** | **1.000** | **0.806** | **0.806** |
| held-out, baseline | 0.741 | 0.690 | 0.500 | 0.345 |
| **held-out, first look** (untouched) | **0.743** | **0.897** | **0.654** | **0.586** |
| held-out, final | 0.765 | 0.897 | 0.654 | 0.586 |
| all 13, baseline | 0.796 | 0.662 | 0.558 | 0.369 |
| all 13, final | 0.861 | 0.954 | 0.742 | 0.708 |

Per case (found / extra detections / precision / recall / type right of found):

| case | baseline | now |
|---|---|---|
| plain-basic | 5/5, 1 extra, 0.83 / 1.00, 4/5 | 5/5, 0, 1.00 / 1.00, 5/5 |
| plain-moves | 6/6, 1, 0.86 / 1.00, 3/6 | 6/6, 0, 1.00 / 1.00, 6/6 |
| shared-gradient | 2/7, 0, 1.00 / 0.29, 0/2 | 7/7, 0, 1.00 / 1.00, 4/7 |
| busy-bg | 0/6, 0, - / 0.00, - | 6/6, 0, 1.00 / 1.00, 4/6 |
| camera-in-shot | 2/2, 2, 0.50 / 1.00, 2/2 | 2/2, 2, 0.50 / 1.00, 2/2 |
| vertical-short | 3/5, 0, 1.00 / 0.60, 2/3 | 5/5, 0, 1.00 / 1.00, 4/5 |
| product-promo | 5/5, 0, 1.00 / 1.00, 3/5 | 5/5, 0, 1.00 / 1.00, 4/5 |
| held-other | 6/6, 1, 0.86 / 1.00, 2/6 | 6/6, 0, 1.00 / 1.00, 3/6 |
| held-busy | 0/7, 0, - / 0.00, - | 5/7, 2, 0.71 / 0.71, 3/5 |
| held-vertical | 6/6, 2, 0.75 / 1.00, 3/6 | 6/6, 1, 0.86 / 1.00, 3/6 |
| data-story | 1/3, 1, 0.50 / 0.33, 1/1 | 2/3, 2, 0.50 / 0.67, 2/2 |
| code-explainer | 2/2, 2, 0.50 / 1.00, 1/2 | 2/2, 3, 0.40 / 1.00, 1/2 |
| photosynthesis | 5/5, 1, 0.83 / 1.00, 3/5 | 5/5, 0, 1.00 / 1.00, 5/5 |

The vertical-short problems from NEXT.md are gone: the missed whip-up and iris are found, the whip-left is a push-left
(was wipe-down); the iris is still named wrong (see below).

**Speed** (30 s 1080p, `photosynthesis`, same idle machine, back to back): report only 17-19 s → **6 s**; the whole
command with both contact sheets and the music analysis: 13 s. Profiling the old code: 25 of 30 s were the camera
search (`globalMotion`, full-size exhaustive). Output is deterministic (same video, same report).

## What changed in `src/analyze.js`

1. **"Replaced", not "different".** Scene-change novelty now uses `replaced(i, j)`: per pixel, does its color fall
   inside the 3x3 neighbourhood range (±18) of the other frame (forgives a 1 px move, particles, gradient drift), and
   (a) the share of pixels with a new color, both ways, or (b) the share of the old frame's edges gone AND of the new
   frame's edges that were not there. Something entering keeps the old edges, something leaving brings no new ones, a
   moving background stays inside the tolerance. Novelty = replaced across the moment minus the smaller of the two
   sides (not their average: content that builds in right after a transition no longer hides it). This is the main
   recall gain on shared backgrounds and busy backgrounds (0/6 and 2/7 found before).
2. **Extents** by how far each frame is from old to new (mean color difference), not by a threshold that collapsed in
   fades; rejected candidates no longer hide a longer change at another scale; the two halves of a dip, the same cut
   found twice, and a cut on the last frame of a gradual change (an old see-through scene removed at the end) merge.
3. **Cuts**: one frame changes a lot, and the picture was still for 0.2 s (and since the change began) before it and
   stays for 2 frames after it. New content may enter after the cut; a fast out-expo fade or the last frame of a whip or
   an iris is no cut.
4. **Camera moves** (must not count): the whole move is followed (it may start before and end after the candidate),
   every frame must be the previous one moved (weighted by how much each step changes; a step "fits" by mean
   difference or when 75% of its pixels fit), for 3 frames at least, with the same colors, and something must move. A
   slide of a third of the frame or more in 0.35 s or less counts as a transition (a push or a whip on a plain or
   smooth background looks exactly like a fast camera pan). Camera labels per shot skip the transition frames (they
   showed transition motion as camera moves, e.g. "move-left 210px" in photosynthesis, which has no camera).
5. **Classification**, in this order: dip (mean luma); **content moved** (where is the old content a quarter of the
   way in, where is the new content three quarters in: a shift along one axis = push in that direction; a wipe leaves
   the content in place); **revealed in place** (each content pixel switches from old to new within 2 frames, and the
   switch time is ordered by x, y, distance from the center or angle, within the old content, the new content or the
   changed background, over many moments, not one lump per element) = wipe-dir / iris / iris-in / clock; frame-by-frame
   slide or zoom on the changing detail (x, y and zoom searched separately: a horizontal edge says nothing about x);
   fade (blend, or pixels that go straight from old to new); other.
6. **Speed**: the global motion search runs at half size first, then refines at full size around the answer, with
   per-zoom lookup tables (about 4x less work per call, and it searches twice as far).

## What is still wrong, and why

- **See-through scenes with content entering during the transition** (shared background, `data-enter` delays that
  overlap the transition): the new content's timing is the entrances', not the wipe's or the iris's, and the old scene
  is not covered but removed at the end. shared-gradient wipe-up → wipe-down, iris → iris-in; vertical-short iris →
  cut. From pixels alone this is close to ambiguous.
- **dip on a dark shared background** (busy-bg, held-vertical): the content goes black, the background stays, which
  looks like a fade through the background.
- **zoom** (new scene 1.25 → 1 while fading in) → fade, in all 3 cases: the scale change is small and faint.
- **flip** → dip, **morph** → push-right (the carried element dominates), **clock** → push-left (held-other).
- **Fast camera moves over a world** (a 0.7 s pan between two cards, a 1.2 s pull-out with cards entering) still read
  as push/zoom-out: camera-in-shot and code-explainer have 2-3 such extras. data-story's whip-left between two
  `mw.camera` worlds is missed and found 0.5 s late.
- held-busy: the fade and the iris are found late (an old scene removed at the end looks like a cut 0.5 s after the
  fade's middle).

## Notes

- After the first held-out look, two generic changes were made: rejected candidates no longer block other scales, and
  "content on one side only" (an entrance onto an empty frame) counts half unless most of the frame changes color
  (held-out precision 0.743 → 0.765, the rest unchanged; tuning unchanged). Then a new probe (now
  `test/features.test.js` 'analyze: on one shared background ...': small cards pushed, wiped and cut on a smooth
  gradient) found 1 of 3: the camera test was too eager on smooth backgrounds (a push of small cards is a perfect
  "camera pan" there). Fixed by requiring 3 fitting frames, using the whole move for the slide check and a third of a
  frame as the limit; neither the tuning nor the held-out numbers moved.
- Ideas not done: OCR as an optional extra; per-minute summaries for long videos; a "see-through transition" model
  (old layer stays, new layer revealed) for the cases above; using the audio's onsets as a prior for cut times.
