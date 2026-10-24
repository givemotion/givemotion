# T3: hand-drawn (whiteboard) videos, before and after sketch tools, and against another framework

October 2026. Brief: `bench/agents/briefs/hand-drawn.md` ("How a web request works", Excalidraw-style, one big canvas the
camera moves over, 25-35 s). Fresh Claude Opus agents, docs only, ~25 min budget, friction logs. 3 blind Opus judges
scored all six videos together from 2 fps sheets.

| group | runs | what the agents had |
|---|---|---|
| baseline | 2 | the engine before this work (no sketch tools, no hand font) |
| new | 2 | `data-sketch` / `mw.sketch`, built-in `Caveat`, `write` preset, `mw.connect`, check fixes (first version) |
| other | 2 | another framework 4.0.538, installed and ready; free to add npm packages (both added roughjs) |

## Results

| group | brief fit | motion | craft | errors | overall | avg rank (of 6) | code | agent time | render (4 CPU, no GPU) |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 8.3 | 7.7 | 7.3 | 6.7 | **7.5** | 2.2 | 240-333 lines (17-19 KB) | 8-9 min | 31-32 s |
| new | 8.0 | 7.2 | 6.8 | 6.7 | 6.8 | 4.0 | 157-170 lines (10-12 KB) | 11-14 min | 33-47 s (35-44 s after the encoder fix) |
| other | 8.2 | 7.0 | 6.5 | 5.7 | 6.3 | 4.3 | 589-614 lines (20-22 KB) | 12-13 min | 66-67 s |

All videos 31-34 s, 1920x1080, 30 fps. Per video (overall): baseline 8.0 and 7.0, new 7.0 and 6.7, another framework 7.3 and 5.3.
One baseline video won all three judges' first place; the spread between two runs of the same setup (up to 2 points for
another framework) is as large as the spread between setups, so with 2 runs each the quality ranking is weak evidence.

What is clear:
- **Less code, no home-made rough-shape kit.** Baseline agents wrote 60-90 lines of their own rough-stroke code each;
  the new runs wrote none (`data-sketch` on plain SVG shapes) and had half the code. The another framework agents wrote ~600 lines:
  roughjs wrapping, their own draw-on, their own camera, their own font loading.
- **Render speed:** for the same kind of video motionwright rendered in 31-47 s, another framework in 66-67 s on the same machine.
- **another framework friction:** both runs lost a render to Google Fonts timing out in headless Chrome, and both had to build a
  camera over a big canvas and hand-drawn draw-on themselves. motionwright has both built in.
- **Why the new runs did not score higher:** judges called their ink "thin, low-contrast, too light and uniform" and their
  overview labels tiny. Both runs copied the docs' example `stroke-width="3"`; in the final pull-back (world at ~half size)
  that is 1.5 px. The baseline winner used bold strokes. That was a docs gap (now: 5-7 px strokes, labels ≥ 48 px in
  world units, saturated accents), plus a default of 4 px for sketched shapes with no stroke width.

## Engine and docs changes from this test

From the baseline friction logs (before the tools existed):
- `data-sketch` (any SVG shape or a whole `<svg>`/`<g>`) and `mw.sketch.*`: seeded rough strokes drawn twice, hatch,
  cross-hatch and solid fills, arrows, underline. Our own algorithm (no Rough.js code).
- `Caveat` handwriting font built in (OFL, ~105 KB, loaded only when used; inlined by `bundle`).
- `write` enter preset (pen-speed reveal, duration from text length), `draw` now eases at pen speed by default.
- `mw.connect` (live arrows between elements, sketchable, drawn on) and `mw.rect` (box in world coordinates).
- `check`: text behind a clip-path wipe that has not started is hidden (a 0.4 px sliver counted as visible before);
  labels the camera passes over while it moves are not crop warnings; snapshot picks a moment per camera shot.
- Typewriter caret hidden before typing starts. Docs: camera shot time = when the move starts; `data-enter` delay
  reveals things later inside one long scene; follow-zoom vs fit-zoom.

From the new-engine friction logs (fixed after the round, not yet tested by agents):
- `draw` on a sketched shape finished at half its duration (SVG restarts dashes at each subpath): each pass is now its
  own path and strokes and hatching are continuous, so drawing runs at an even pace.
- Solid sketch fills showed before their draw started: they now fade in with the drawing.
- `data-sketch-arrow`, travel along a sketched route (hidden exact guide path), `fit: 'all'`, a warning when a camera
  shot target matches nothing, `mw.connect` `from`/`to` sides and `label`, `data-type-caret="0.8"`, no contrast
  judgement on text cut by the frame.

## Next

- Run the hand-drawn brief again (3 runs) with the fixed tools and the new size guidance.
- One long scene re-renders fully after any edit (parts are fingerprinted per scene); finer fingerprints would help
  whiteboard videos.
