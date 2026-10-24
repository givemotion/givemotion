# Next steps (open work)

Take one task, do it, then remove it from this file (or update it). Keep this list current.

**Several sessions may work at the same time.** Each task below says which files it touches. Work on a branch
named after the task (`git checkout -b task/partial-render`), pull `main` and run `npm test` before merging, and
merge often. If two tasks touch the same file, keep the changes small and merge the first one before starting the
second. Do not reformat files you are not changing.

---

## T1. Test harness in the repo (do this first: other tasks use it)
Today the agent test rounds are run by hand with throwaway files in /tmp, so every session rebuilds them.
- Make `bench/agents/` with: the briefs (promo, explainer, data story, vertical short, code explainer, logo sting,
  UI demo, year recap, plus T3's hand-drawn brief), the exact prompt given to the maker agents, the exact prompt
  given to the blind judges, and a friction-log template.
- Friction-log template: every problem gets a tag: **engine** (the engine lacks a tool or does it badly),
  **docs** (the engine can do it but the docs led the agent wrong), or **agent** (the agent's own mistake; nothing to fix).
- A script that sets up one folder per run (brief, SKILL.md, blocks, assets, a `./mw` wrapper), and after the runs
  renders the videos, makes 2 fps contact sheets, shuffles them for the judges, and writes a results table.
- Run each brief 2-3 times per round: one run per brief is too noisy (round 2 showed that).
- Done when: a new session can run a full round with one command plus the agent launches, and compare scores
  with earlier rounds in docs/experiments/.
- Files: new `bench/agents/`, `docs/experiments/README.md`.

## T2. Blind judging of the round-3 examples
Compare the new examples (examples/data-story, vertical-short, code-explainer) against the old ones (git history
before commit e3a75b7) and against round-1/2 videos, using T1. Write the result in docs/experiments/.

## T3. Hand-drawn (Excalidraw-style) video test, compared with another framework
Leo has made hand-drawn whiteboard-style videos with another framework and they worked well: sketchy shapes and arrows that
draw themselves on, handwritten-looking text, everything feeling like it lives on one big canvas that the camera
moves around, with transitions that stay on that canvas.
- Write a brief for it, run fresh Opus agents with our docs (T1), and look at where they struggle.
- Likely engine needs: a "sketchy" style for shapes and lines (rough, slightly wobbly strokes that stay the same
  every frame), draw-on for those shapes, a hand-drawn font option, arrows between elements (see `mw.connect`
  below), and the camera world (already exists) as the "infinite canvas".
- Compare with a another framework version of the same brief (Leo can provide or we make one). Compare quality, how
  much code the agent wrote, time to make it, and render time. Learn from another framework's features only; never copy
  its code (or any library's code). For rough shapes, write our own small algorithm; do not copy Rough.js.
- Files: likely `src/runtime/motion.js` (new shape style), a new block, SKILL.md.

## T4. Re-render only what changed
Plan: docs/ideas/video-analysis-and-partial-render.md (part 2). In short: keep the rendered video as saved
2-second pieces, redo only the pieces that changed, join without re-encoding the rest.
- Start with the simple, safe version: `render --redo 4s-7s` patches that range into the existing output.
- Then the automatic version: fingerprint each scene's HTML plus shared CSS, scripts, data and media; redo only
  the scenes that changed; redo everything when shared code changed.
- Must stay byte-identical to a full render (add a test).
- Files: `src/render.js`, `src/ffmpeg.js`, `src/cli.js`, tests, README, SKILL.md.

## T5. `motionwright analyze`: let an agent "see" a video
Plan: docs/ideas/video-analysis-and-partial-render.md (part 1). A command that turns any MP4 (a reference, or
our own render) into a report: cuts and shot lengths, pacing (motion strip), transition types, camera moves,
color palette, where text sits, cuts on beats, a contact sheet per shot, and a "style recipe" in our terms.
- Use it for self-review too: analyze our own render and compare with the reference report.
- Files: new `src/analyze.js`, `src/cli.js`, SKILL.md, README.
- Leo's note: this is an experiment. Build the smallest useful version first (cuts, shot lengths, pacing,
  palette, sheets) and show him before going further.

## T6. Tools the agents asked for (from friction logs, not built yet)
Each is small; can be split across sessions. Files: mostly `src/runtime/motion.js`, `src/check.js`, SKILL.md.
- `mw.connect('#a', '#b', { curve, draw })`: a line or arrow between two elements that follows them (also needed by T3).
- `mw.rect(el, '#world')`: an element's box in a camera world's coordinates.
- `check --safe-zone shorts`: warn about text near the edges on vertical video (side 60 px, top 220, bottom 380).
- `mw.log(...)` that `inspect --at` and `check` print with the frame time.
- `hideBefore: true` on a tween: a clear way to keep something hidden until it enters.
- `snapshot` grid overlay / frame-center marks; a caption paging preview (`motionwright captions captions.json --words 3`).

## T7. Render speed without a GPU
Rich agent-made pages render at about 3 fps per worker on a 2-CPU machine with no GPU (the benchmark page does 18).
The cost is spread over software drawing of many full-frame layers; no single Chrome flag helped (see
docs/experiments/2026-10-round2.md). Ideas: fewer full-frame layers in blocks, a cheaper grain, measure on a
bigger machine, compare with a GPU machine. Files: `src/browser.js`, `src/render.js`, blocks.

## Small known issues
- SyntaxError line numbers point at the `<script>` tag (except "already declared" errors). (`src/browser.js`)
- `text-covered` skips dimmed text (opacity < 0.5) and transitions; watch for false alarms. (`src/check.js`)
