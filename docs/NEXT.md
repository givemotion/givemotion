# Next steps (open work)

Keep this list short and current. Take an item, do it, remove it.

## Measure
- Blind judging of the round-3 examples against the old ones and the round-1/2 videos (method in
  docs/experiments/2026-10-format-test.md). Run each brief 2-3 times: one run per brief is too noisy.
  Test videos live in /tmp and are gone after a session; regenerate them with fresh Opus agents.

## Wished-for tools (from agent friction logs, not built yet)
- `mw.connect('#a', '#b', { curve, draw })`: a line between two elements that follows them.
- A helper to get an element's box in a camera world's coordinates (`mw.rect(el, '#world')`).
- `snapshot` option for a grid overlay / frame center, and a caption paging preview
  (`motionwright captions captions.json --words 3`).
- `check --safe-zone shorts`: warn about text near the edges on vertical video (side 60 px, top 220, bottom 380).
- `mw.log(...)` that `inspect --at` and `check` print with the frame time.
- `hideBefore: true` on a tween, as a clearer way to keep something hidden until it enters.

## Known weak spots
- Render speed on machines without a GPU: rich agent-made pages render at about 3 fps per worker on
  2 vCPUs. The cost is spread over software raster and compositing of many full-frame layers; no single
  Chrome flag helped. Ideas not yet tried: fewer full-frame layers in blocks, a lower-cost grain.
- SyntaxError line numbers point at the `<script>` tag except for "already declared" errors.
- `text-covered` ignores dimmed text (opacity < 0.5) and transitions; watch for false alarms.

## Ideas waiting for Leo (do not build without asking)
- docs/ideas/video-analysis-and-partial-render.md: `motionwright analyze` (see a reference video) and re-rendering only changed parts.
