# Next steps (open work)

Take one task, do it, then remove it from this file (or update it). Keep this list current.

**Several sessions may work at the same time.** Each task below says which files it touches. Work on a branch
named after the task (`git checkout -b task/anchors`), pull `main` and run `npm test` before merging, and
merge often. If two tasks touch the same file, keep the changes small and merge the first one before starting the
second. Do not reformat files you are not changing.

## Done in the October 2026 session (for context)

- **Test harness** `bench/agents/` (briefs, maker/judge prompts, friction template, `round.js setup/render/sheets/add/pack/results`,
  frozen engine per round). How to run a round: `bench/agents/README.md`.
- **T2** round-3 examples vs the old ones: 7.9 vs 3.7 (`docs/experiments/2026-10-t2-examples.md`).
- **T3** hand-drawn: `data-sketch`, `mw.sketch`, `data-sketch-mark`, Caveat font, `write`, `mw.connect`, `mw.rect`,
  `fit: 'content'`, many check fixes. Three agent rounds; the last one beat the no-tools baseline on every judge
  (7.6 vs 6.7) and the versions made with another framework were behind both (`docs/experiments/2026-10-t3-hand-drawn.md`).
- **T4** renders keep fixed parts with fingerprints; only changed parts re-render, byte-identical to a full render.
- **T5** `motionwright analyze` (cuts, transitions, camera, pacing, palette, beat sync, sheets, `--compare`).
- **T6** `mw.connect`, `mw.rect`, `data-safe-zone` / `unsafe-zone`, `mw.log`, `hideBefore`, `snapshot --grid`, `captions` command.
- **T7** speed study (`docs/experiments/2026-10-t7-speed.md`): time is mostly software compositing; fixed an encoder stall
  and a determinism bug (Chrome partial raster).
- **N2** labels that stay with their shapes: `data-anchor="#server bottom 12"` (HTML and SVG text, follows timeline/travel/
  camera, chains), `data-sketch-mark-padding`, `mw.path.travel(el, mw.connect(...))` rides a live arrow. Not yet tried by
  a fresh agent round: the next hand-drawn round should check that makers use it and that moving a part is one edit.
- **N1** round 8, all 9 briefs x 2 runs, 2 judges each: 7.1 average, no video under 6 (`docs/experiments/2026-10-r8.md`).
  ~20 fixes from the friction logs and judge notes: code-window marks, `zoom-through`, `mw.burst` layering in camera
  worlds, a frame-start tween glitch, `fromTo` + keyframes, pop-in `fit`, many `check` false positives (SVG text,
  occluded lines, fades/scrims), new `camera-late`, `ghost-overlap`, `data-pulse`, beat `data-cuts`, shot `overview`.
- Also: tests no longer hang, camera shots at elements that appear later frame correctly, `empty-frame` and
  `text-over-line` checks, script error lines map to the file you wrote.

---

## N3. Partial re-render inside one long scene (first version done; follow-ups)
Done: inside a top-level clip, "late" elements get their own print plus the time T before which they cannot change a
pixel, so an edit to something that appears at 40 s keeps 0-40 s (`src/parts.js`, called from `dependencyPrints` in
`src/render.js`; tests "render keeps parts inside one long scene" in `test/features.test.js`). Late = a nested clip
(display:none before its start), or an element held at opacity 0 / visibility hidden by its own delayed entrance that
is out of the flow (absolute/fixed) or an SVG shape; and nothing names it (no script string, selector, attribute or
url(#id); no named SVG group around it), no CSS sibling/:has()/counter/anchor rules, no script walks the page. Every
print also covers the live HTML after the runtime set it up, which also fixes an older hole: a sketched shape added in
one scene moved the seeds of the shapes in later scenes, and those parts were wrongly reused. Reveal presets (`write`,
`draw`, wipes, `iris`, masks, `grow`) now hide fully before they start (they showed a sliver before).
Follow-ups:
- CSS animations the runtime has not taken over at load (`animation: pop-in … both` in a later scene) do not count as
  hiding (their state at load depends on Chrome's clock). Could be read from the keyframes and the clip start instead.
- `data-split` + `data-stagger` text (each piece has its own entrance) is not late; nor is anything inside a block whose
  script uses `document`/`window` (cursor, lottie), and any script that walks the page (`children`, `getBBox`,
  `scrollWidth`, text reads) turns the rule off (`render` result: `parts.lateOff` says why). Blocks could declare their
  scope instead.
- An edit that changes what `fit: 'content'` measures redoes everything (correct, but a shot list could be finer).

## N4. Render speed
See `docs/experiments/2026-10-t7-speed.md`. Next: fewer/smaller composited layers in blocks and examples (static
backgrounds need no own layer), a "layer area" number in `bench` (`bench/speed/layers.mjs` has the code), and a
measurement on a GPU machine and on 8-16 cores. Files: `src/browser.js`, `src/render.js`, `src/bench.js`, blocks.

## N5. `analyze` accuracy
Measured: `node bench/analyze/score.mjs` renders 13 videos with known scene changes (from `inspect`) and scores
`analyze`. Now: scene changes found 100% (tuning) / 90% (held-out), precision 0.95 / 0.77, transition type right
81% / 65% of found (was 64% / 69% found, 61% / 50% typed); 30 s 1080p analyzes in 6 s (was 18 s).
Results and the method: `docs/experiments/2026-10-analyze-accuracy.md`. Still open: see-through scenes whose content
enters during a wipe/iris (direction taken from the entrances), dip on a dark shared background (reads as fade), `zoom`
(reads as fade), flip/morph/clock, fast `mw.camera` pans and pull-outs over a world (read as push/zoom-out). Ideas:
a "see-through transition" model, OCR as an optional extra, per-minute summaries for long videos.
Files: `src/analyze.js`, `bench/analyze/`.

## Small known issues
- `text-covered` skips dimmed text (opacity < 0.5) and transitions; a moving element fully covering a settled label for
  ~1 s is not reported (fully covered text is treated as hidden). (`src/check.js`)
- A camera `float` makes labels at the frame edge flicker in and out of `text-offscreen` (agents add `crop-ok`).
- Determinism: after the camera zoom has animated (e.g. a `fit` shot whose target pops in), a worker that starts on a
  still frame draws one box edge a pixel row differently from the worker that rendered the zoom (which reuses its
  earlier capture for the unchanged frame). Seen with 1 vs 3 workers at a shot start (frame 60), also before N3. Repro: the `longScene` page in `test/features.test.js` with `fit: ['#a', '#b']` shots and `pop` on `#b`.
  Likely Chrome's raster scale heuristics for layers whose scale changed. (`src/browser.js`)
