# T3: hand-drawn (whiteboard) videos, before and after sketch tools, and against another framework

October 2026. Brief: `bench/agents/briefs/hand-drawn.md` ("How a web request works", Excalidraw-style, one big canvas the
camera moves over, 25-35 s). Fresh Claude Opus agents, docs only, ~25 min budget, friction logs. 3 blind Opus judges
scored all six videos together from 2 fps sheets.

| group | runs | what the agents had |
|---|---|---|
| baseline | 2 | the engine before this work (no sketch tools, no hand font) |
| new | 2 | `data-sketch` / `gm.sketch`, built-in `Caveat`, `write` preset, `gm.connect`, check fixes (first version) |
| other | 2 | another code-to-video framework (React), installed and ready; free to add npm packages (both added a rough-drawing library) |

## Results

| group | brief fit | motion | craft | errors | overall | avg rank (of 6) | code | agent time | render (4 CPU, no GPU) |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 8.3 | 7.7 | 7.3 | 6.7 | **7.5** | 2.2 | 240-333 lines (17-19 KB) | 8-9 min | 31-32 s |
| new | 8.0 | 7.2 | 6.8 | 6.7 | 6.8 | 4.0 | 157-170 lines (10-12 KB) | 11-14 min | 33-47 s (35-44 s after the encoder fix) |
| other | 8.2 | 7.0 | 6.5 | 5.7 | 6.3 | 4.3 | 589-614 lines (20-22 KB) | 12-13 min | 66-67 s |

All videos 31-34 s, 1920x1080, 30 fps. Per video (overall): baseline 8.0 and 7.0, new 7.0 and 6.7, the other framework 7.3 and 5.3.
One baseline video won all three judges' first place; the spread between two runs of the same setup (up to 2 points for
the other framework) is as large as the spread between setups, so with 2 runs each the quality ranking is weak evidence.

What is clear:
- **Less code, no home-made rough-shape kit.** Baseline agents wrote 60-90 lines of their own rough-stroke code each;
  the new runs wrote none (`data-sketch` on plain SVG shapes) and had half the code. The other framework's agents wrote ~600 lines:
  roughjs wrapping, their own draw-on, their own camera, their own font loading.
- **Render speed:** for the same kind of video givemotion rendered in 31-47 s, the other framework in 66-67 s on the same machine.
- **Friction in the other framework:** both runs lost a render to Google Fonts timing out in headless Chrome, and both had to build a
  camera over a big canvas and hand-drawn draw-on themselves. givemotion has both built in.
- **Why the new runs did not score higher:** judges called their ink "thin, low-contrast, too light and uniform" and their
  overview labels tiny. Both runs copied the docs' example `stroke-width="3"`; in the final pull-back (world at ~half size)
  that is 1.5 px. The baseline winner used bold strokes. That was a docs gap (now: 5-7 px strokes, labels ≥ 48 px in
  world units, saturated accents), plus a default of 4 px for sketched shapes with no stroke width.

## Engine and docs changes from this test

From the baseline friction logs (before the tools existed):
- `data-sketch` (any SVG shape or a whole `<svg>`/`<g>`) and `gm.sketch.*`: seeded rough strokes drawn twice, hatch,
  cross-hatch and solid fills, arrows, underline. Our own algorithm (no Rough.js code).
- `Caveat` handwriting font built in (OFL, ~105 KB, loaded only when used; inlined by `bundle`).
- `write` enter preset (pen-speed reveal, duration from text length), `draw` now eases at pen speed by default.
- `gm.connect` (live arrows between elements, sketchable, drawn on) and `gm.rect` (box in world coordinates).
- `check`: text behind a clip-path wipe that has not started is hidden (a 0.4 px sliver counted as visible before);
  labels the camera passes over while it moves are not crop warnings; snapshot picks a moment per camera shot.
- Typewriter caret hidden before typing starts. Docs: camera shot time = when the move starts; `data-enter` delay
  reveals things later inside one long scene; follow-zoom vs fit-zoom.

From the new-engine friction logs (fixed after the round, not yet tested by agents):
- `draw` on a sketched shape finished at half its duration (SVG restarts dashes at each subpath): each pass is now its
  own path and strokes and hatching are continuous, so drawing runs at an even pace.
- Solid sketch fills showed before their draw started: they now fade in with the drawing.
- `data-sketch-arrow`, travel along a sketched route (hidden exact guide path), `fit: 'all'`, a warning when a camera
  shot target matches nothing, `gm.connect` `from`/`to` sides and `label`, `data-type-caret="0.8"`, no contrast
  judgement on text cut by the frame.

## Round 2 (r6): 3 more runs with the fixed tools

Judged together with the 2 baseline and 2 other-framework videos (7 per judge, 3 judges):

| group | runs | overall | avg rank (of 7) |
|---|---|---|---|
| baseline | 2 | **8.2** | 1.7 |
| new tools (r6) | 3 | 6.2 (7.0, 6.3, 5.3) | 4.9 |
| other framework | 2 | 6.2 | 5.0 |

All three makers hit the same new bugs, now fixed: round-cap **dots** where shapes were waiting to be drawn (a
zero-length dash still paints its caps), connector labels parked at the top-left while an end was hidden, script
references to shapes that `data-sketch` had replaced, `stroke="none"` drawn with an outline. They asked for marks on HTML
text (now `data-sketch-mark`), sketched borders on HTML boxes (`data-sketch` on a div) and `fit: 'content'`.

The worst video (5.3) had a half-second **camera glitch**: a shot that fit an element whose clip had not started yet
(`data-start` later) measured an empty box at the screen corner and zoomed far out. This bug was in every engine
version; such shots now frame where the element will be.

**Same compositions, current engine (r6-live).** Re-rendering the three r6 compositions with all fixes and judging them
again with the baseline (5 per judge): new tools 6.6 (7.0, 6.7, 6.0; the glitched one went from 5.3 to 7.0), baseline
8.0. So the engine fixes helped, but the gap is mostly in what the agents made, and the judges said what:
- "**lines too clean to feel hand-sketched**": our default strokes were close to ruler-straight and the two passes nearly
  coincided, while the baseline agents' home-made strokes wobble and part. Default roughness is now stronger, and pale
  fills hatch in a deeper shade of the same hue.
- **long, nearly static wide shots** with tiny labels, and **near-empty frames** while the camera crosses blank paper.
  New `empty-frame` check, and camera craft guidance in the docs (stay close, keep parts near each other, the whole
  diagram only at the end).

## Round 3 (r7): 3 more runs with all fixes

Judged with the 2 baseline videos (5 per judge, 3 judges):

| group | runs | brief fit | motion | craft | errors | overall | avg rank (of 5) | #1 picks | agent time | render |
|---|---|---|---|---|---|---|---|---|---|---|
| **new tools (r7)** | 3 | 8.6 | 7.6 | 7.6 | 7.3 | **7.6** (8.0, 7.7, 7.0) | **2.2** | **3 / 3** | 7-9 min | 26-29 s |
| baseline | 2 | 7.5 | 7.3 | 6.7 | 6.8 | 6.7 | 4.2 | 0 | 8-9 min | 31-32 s |

The ranking flipped: the two baseline videos that won every earlier table came 4th and 5th. (Absolute scores move between
tables, since judges calibrate to what they see; compare ranks within a table.) The makers said the tools "worked almost
entirely on the first try" and spent their time on content, not on writing a rough-stroke kit.

What r7's makers still hit, now fixed or open:
- `gm.connect` labels came out in the page's default font: now handwriting for sketched arrows, and a `font` option.
- Lines running through labels were not caught: new `text-over-line` check (it finds the cases they saw by eye).
- Predicting what a `fit` shot shows: `inspect` now lists each shot's visible world area and zoom.
- Open: labels are placed by hand in world px apart from their shapes (a `data-anchor="#server bottom"` idea); the
  circle mark has no padding option; arrows to a wide group attach to the group's whole box (documented).

## Next

- One long scene re-renders fully after any edit (parts are fingerprinted per scene); finer fingerprints would help
  whiteboard videos.
