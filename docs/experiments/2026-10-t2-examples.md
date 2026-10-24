# T2: blind judging of the round-3 examples (old vs new)

October 2026. Made with the new harness (`bench/agents/round.js`, see `bench/agents/README.md`).

Question: did the round-3 remakes of `examples/data-story`, `vertical-short` and `code-explainer` (agents with the
round-3 engine and docs) beat the examples they replaced (git `e3a75b7^`)? Both versions were rendered with today's
engine, so only the authoring differs. 3 blind Opus judges per brief, each saw the two 2 fps contact sheets in random
order and scored 1-10.

Round-1/2 agent videos were not kept (they lived in /tmp), so they could not be judged again. From now on runs live in
`bench/agents/runs/` and the results tables in `docs/experiments/`.

| brief | video | brief fit | motion | craft | errors | overall | #1 picks |
|---|---|---|---|---|---|---|---|
| data-story | new | 8.7 | 8.0 | 7.7 | 7.3 | **8.0** | 3 / 3 |
| data-story | old | 5.3 | 3.7 | 5.0 | 5.3 | 4.0 | 0 |
| vertical-short | new | 8.7 | 8.0 | 8.0 | 7.0 | **8.0** | 3 / 3 |
| vertical-short | old | 4.0 | 3.0 | 4.0 | 3.3 | 3.0 | 0 |
| code-explainer | new | 8.3 | 7.7 | 7.3 | 6.7 | **7.7** | 3 / 3 |
| code-explainer | old | 5.0 | 4.0 | 5.3 | 5.7 | 4.0 | 0 |
| **all** | **new** | 8.6 | 7.9 | 7.7 | 7.0 | **7.9** | 9 / 9 |
| **all** | **old** | 4.8 | 3.6 | 4.8 | 4.8 | 3.7 | 0 |

Every judge preferred the new version, by about 4 points. The old ones were called "slides": frozen stretches of 2-4 s,
small type in big empty frames, an empty first frame, a frozen last scene. `analyze` agrees: the new videos change
26-40% of the picture per half second, the old ones 12-22%.

What judges still marked down on the new examples (the next things to fix):
- **Small text in wide shots** (code, axis labels, chart captions): all three videos. `check` only flags text under
  18 px at 1080p; judges see sheets, but small text is also weak on a phone.
- **Zooms that crop code or labels at the frame edge** (code explainer), a frame strip cut at both edges (vertical short,
  on purpose).
- **Near-empty transition frames**: a blur transition in the data story leaves an almost empty, blurred frame at 8.0 s;
  a half-drawn text frame in the vertical short at 7.0 s.
- **Holds of 1.5-2 s at the end** (gauge, end card).
- **Shapes over text**: burst rays crossing a headline (vertical short).
- Content slip: a "6 lines" claim over nine lines of code, a counter passing through "3 lines".
