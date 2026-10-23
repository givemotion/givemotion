# Experiment: HTML vs HTML + blocks vs React (October 2026)

Question (from Leo): with plain HTML, will the AI have to build everything from zero, and would React (components) be better?

## Setup
- 4 briefs: bar chart race (data), product promo, vertical kinetic typography (beat-synced), 20s map explainer.
- 3 versions of each, same engine, same docs except the authoring part:
  H = HTML + ready-made blocks, N = HTML without blocks, R = React (JSX via `motionwright/react`).
- 12 fresh Claude Opus agents, docs only, no engine source, ~25 min each, check/snapshot loop.
- Judging: 8 fresh Opus judges (2 per brief), blind, random labels, 2 fps contact sheets of the rendered mp4s.

## Results
| | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|
| HTML + blocks | 8.62 | 7.75 | 7.25 | 6.12 | 7.25 | 2.38 | 1 / 8 |
| HTML, no blocks | 8.88 | 7.88 | 7.88 | 6.75 | **7.75** | **1.50** | **6 / 8** |
| React | 8.75 | 7.88 | 7.12 | 7.00 | 7.50 | 2.12 | 1 / 8 |

- Effort was the same: ~180k tokens, ~45 tool calls, ~24 min per video in all three.
- Blocks were almost unused (0 or 1 per video): agents preferred custom visuals.
- Same motion written both ways (120 animated dots + title, 8s): HTML/timeline 15.1s, React 13.5s to render. Format does not decide speed.
- Every serious problem agents hit was an engine gap, the same in all three versions: checker misreads moving text, morph transition unreliable, beat grid inaccurate and invisible, no camera-follow / path-travel tools, slow check/snapshot.
- Outside research agrees: DesignBench (2025) found models do best with vanilla HTML/CSS, React/Vue in the middle, especially for editing and repair.

Caveats: one video per brief per version; judges saw stills (2 fps), not playback.

## Decision
- Plain HTML/CSS stays the main, recommended format.
- React stays supported (it works, same quality), for people who already have React components.
- Do not grow a big block library. Put the effort into engine primitives (attributes and functions) that work in both formats.
- Next: fix the engine gaps in `2026-10-format-test-backlog.md`.
