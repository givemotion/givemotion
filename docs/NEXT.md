# Next steps (open work)

Take one task, do it, then remove it from this file (or update it). Keep this list current.

**Several sessions may work at the same time.** Each task below says which files it touches. Work on a branch
named after the task (`git checkout -b task/anchors`), pull `main` and run `npm test` before merging, and
merge often. If two tasks touch the same file, keep the changes small and merge the first one before starting the
second. Do not reformat files you are not changing.

## Done in the October 2026 session (for context)

- **Test harness** `bench/agents/` (briefs, maker/judge prompts, friction template, `round.js setup/render/sheets/add/pack/results`,
  frozen engine per round, `--maker other` for comparison runs). How to run a round: `bench/agents/README.md`.
- **T2** round-3 examples vs the old ones: 7.9 vs 3.7 (`docs/experiments/2026-10-t2-examples.md`).
- **T3** hand-drawn: `data-sketch`, `mw.sketch`, `data-sketch-mark`, Caveat font, `write`, `mw.connect`, `mw.rect`,
  `fit: 'content'`, many check fixes. Three agent rounds; the last one beat the no-tools baseline on every judge
  (7.6 vs 6.7) and the another framework versions were behind both (`docs/experiments/2026-10-t3-hand-drawn.md`).
- **T4** renders keep fixed parts with fingerprints; only changed parts re-render, byte-identical to a full render.
- **T5** `motionwright analyze` (cuts, transitions, camera, pacing, palette, beat sync, sheets, `--compare`).
- **T6** `mw.connect`, `mw.rect`, `data-safe-zone` / `unsafe-zone`, `mw.log`, `hideBefore`, `snapshot --grid`, `captions` command.
- **T7** speed study (`docs/experiments/2026-10-t7-speed.md`): time is mostly software compositing; fixed an encoder stall
  and a determinism bug (Chrome partial raster).
- Also: tests no longer hang, camera shots at elements that appear later frame correctly, `empty-frame` and
  `text-over-line` checks, script error lines map to the file you wrote.

---

## N0. Remove every another framework mention, also from git history (Leo's request; do it later, as one coordinated step)
So the project carries no implications later. Today the name appears in 16 files and 4 commit messages:
CLAUDE.md, README.md, llms.txt, package.json (keywords), bench/agents/README.md, bench/agents/round.js
(`--maker other`), bench/agents/prompts/maker-other.md, bench/agents/other-scaffold/,
docs/NEXT.md, docs/experiments/2026-10-format-test-backlog.md, 2026-10-t3-hand-drawn.md, experiments/README.md and
experiments/data/*t3-hand-drawn* (run `grep -ril other . --exclude-dir=node_modules`).
- Rewrite the files (keep the findings, drop the name: "another framework", or remove the comparison runs and the
  scaffold), then rewrite history (`git filter-repo` with `--replace-text` and `--replace-message`, or delete the paths
  from history) and force-push every branch.
- **Coordinate first:** a history rewrite changes every commit id. Do it when no other session has open branches, tell
  Leo before the force-push, and have every session re-clone afterwards. Check forks and open PRs on GitHub too.

## N1. A full agent round over all briefs (measure the engine as a whole)
Round 2 and 3 only covered some briefs, one run each. Run `round.js setup r8 --briefs all --runs 2` (18 makers; ~2.5M
tokens), judge with 2-3 judges per brief, and compare with round 2 (`docs/experiments/2026-10-round2.md`). The friction
logs are the main output: fix the engine first, then docs.
- Files: `bench/agents/` (maybe tune briefs), new `docs/experiments/<date>-r8.md`.

## N2. Labels that stay with their shapes (from the last hand-drawn round)
Agents place every label in world px by hand, apart from the shape it names; moving a part meant ~25 edits.
- Idea: `data-anchor="#server bottom 12"` on any element: placed next to that element (side, gap), following it if it moves.
- Also: `data-sketch-mark-padding`; `mw.connect` returning a path that `mw.path.travel` can follow.
- Files: `src/runtime/sketch.js` (or `motion.js`), SKILL.md.

## N3. Partial re-render inside one long scene
Parts are fingerprinted per top-level scene, so a whiteboard video (one long scene) re-renders fully after any edit.
Finer prints (nested clips with their own times, or per-element "first visible at" times) would help. Must stay
byte-identical to a full render (test in `test/features.test.js`). Files: `src/render.js`.

## N4. Render speed
See `docs/experiments/2026-10-t7-speed.md`. Done: `bench` prints layers, layer area and render passes per frame;
idle enter/exit animations and finished from-only CSS animations (`fade-up ... both`) no longer keep elements on
layers (whole scenes with filter passes); still blur blobs bake to an image. Compositor draw -13..-28% on the
examples, -34% with still blobs. Next: wall time on a quiet machine, a GPU machine and 8-16 cores; the second render
pass most frames take; cheaper gradient-bg/grid-bg (their cost is part of their look); raster cost of an SVG with
`drop-shadow` that redraws (data-story). Files: `src/browser.js`, `src/render.js`, `src/bench.js`, blocks.

## N5. `analyze` accuracy
Clean videos: all scene changes found. Busy motion graphics (constant motion, shared background): about 3 of 5 found,
whips and irises sometimes missed or mislabeled (`docs/experiments` has no table yet; test videos: render
`examples/vertical-short`). Ideas: train thresholds on our own renders where `inspect` gives the true transitions
(a small script that scores precision/recall), OCR as an optional extra, per-minute summaries for long videos.
Files: `src/analyze.js`.

## Small known issues
- `text-covered` skips dimmed text (opacity < 0.5) and transitions; a moving element fully covering a settled label for
  ~1 s is not reported (fully covered text is treated as hidden). (`src/check.js`)
- A camera `float` makes labels at the frame edge flicker in and out of `text-offscreen` (agents add `crop-ok`).
