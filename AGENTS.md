# Working on motionwright (for AI agents and contributors)

- Using motionwright to make a video? Read `skills/motionwright/SKILL.md` instead.
- Zero runtime dependencies. Node 20+ built-ins only. Keep it that way.
- Layout:
  - `src/runtime/runtime.js` — injected into every page: virtual clock, clips/sequences, seeking animations, enter/exit, split/count/type, media, `window.mw`.
  - `src/runtime/preset.css` — injected first; easings, keyframes, `.scene`.
  - `src/server.js` — local server: runtime injection, `<mw-include>`, `{{data.*}}`, video frame extraction.
  - `src/browser.js`, `src/cdp.js` — Chrome discovery/install, CDP over a pipe, beginFrame/screenshot capture.
  - `src/render.js`, `src/ffmpeg.js` — workers, chunking, encoding, concat, audio mix.
  - `src/check.js` — checker + snapshot contact sheets. `src/studio/` — preview UI.
  - `blocks/` — copyable HTML blocks (header comment = docs). `examples/`, `templates/`.
- Tests: `npm test` (needs Chrome + ffmpeg for the e2e part). Determinism matters: any change to the runtime must keep `1 worker == N workers` byte-identical.
- Before changing a block or example: `node src/cli.js check <file>` and `node src/cli.js snapshot <file>` and look at the sheet.
- Do not copy code from other video frameworks. Write it fresh.
