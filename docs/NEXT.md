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
Clean videos: all scene changes found. Busy motion graphics (constant motion, shared background): about 3 of 5 found,
whips and irises sometimes missed or mislabeled (`docs/experiments` has no table yet; test videos: render
`examples/vertical-short`). Ideas: train thresholds on our own renders where `inspect` gives the true transitions
(a small script that scores precision/recall), OCR as an optional extra, per-minute summaries for long videos.
Files: `src/analyze.js`.

## Small known issues
- `text-covered` skips dimmed text (opacity < 0.5) and transitions; a moving element fully covering a settled label for
  ~1 s is not reported (fully covered text is treated as hidden). (`src/check.js`)
- A camera `float` makes labels at the frame edge flicker in and out of `text-offscreen` (agents add `crop-ok`).
- Determinism: after the camera zoom has animated (e.g. a `fit` shot whose target pops in), a worker that starts on a
  still frame draws one box edge a pixel row differently from the worker that rendered the zoom (which reuses its
  earlier capture for the unchanged frame). Seen with 1 vs 3 workers at a shot start (frame 60), also before N3. Repro: the `longScene` page in `test/features.test.js` with `fit: ['#a', '#b']` shots and `pop` on `#b`.
  Likely Chrome's raster scale heuristics for layers whose scale changed. (`src/browser.js`)
