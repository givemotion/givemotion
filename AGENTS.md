# Working on motionwright (for AI agents and contributors)

- Using motionwright to make a video? Read `skills/motionwright/SKILL.md` instead.
- Zero runtime dependencies. Node 20+ built-ins only. Keep it that way.
- Layout:
  - `src/runtime/runtime.js` — injected into every page: virtual clock, clips/sequences, seeking animations, enter/exit, split/count/type, media, `window.mw`.
  - `src/runtime/preset.css` — injected first; easings, keyframes, `.scene`, built-in font faces.
  - `src/runtime/motion.js` — timeline, camera, paths, shapes, morph, burst. `src/runtime/sketch.js` — `data-sketch`, `mw.sketch`, `mw.connect`, `mw.rect`, `data-anchor` (labels that follow their shapes), travel along a connect arrow. `src/runtime/chart.js` — `mw.chart.line` (live line charts: head, callouts pinned to points, rescaling axis). `src/runtime/fonts/` — bundled OFL fonts (Caveat).
  - `src/server.js` — local server: runtime injection, `<mw-include>`, `{{data.*}}`, video frame extraction.
  - `src/browser.js`, `src/cdp.js` — Chrome discovery/install, CDP over a pipe, beginFrame/screenshot capture.
  - `src/render.js`, `src/ffmpeg.js` — workers, fixed 1-2 s parts kept in `.mw-parts/` with fingerprints (only changed parts re-render), encoding, concat, audio mix.
  - `src/analyze.js` — `motionwright analyze`: shots, transitions, camera, pacing, palette, sheets of any video file.
  - `src/check.js` — checker + snapshot contact sheets. `src/studio/` — preview UI.
  - `blocks/` — copyable HTML blocks (header comment = docs). `examples/`, `templates/`.
- Agent test rounds (fresh agents make videos from the docs, blind judges score them): `bench/agents/README.md`. Results: `docs/experiments/`.
- Tests: `npm test` (needs Chrome + ffmpeg for the e2e part). Determinism matters: any change to the runtime must keep `1 worker == N workers` byte-identical.
- Before changing a block or example: `node src/cli.js check <file>` and `node src/cli.js snapshot <file>` and look at the sheet.
- Do not copy code from other video frameworks. Write it fresh.
