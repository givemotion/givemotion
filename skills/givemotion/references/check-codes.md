# Check codes

Purpose: what each `check` code means and how to fix it, how `check` decides, and how to mark intentional cases with `data-check`. (Every issue in the `check` output already prints a message and a fix; read this when one is unclear.)

Contents
- Layout and readability codes
- Pacing and framing codes
- Attribute, script and asset codes
- How check decides; data-check

## Layout and readability codes

| Code | Meaning / fix |
|---|---|
| `text-offscreen` | Text runs past the frame edge. Smaller font, `max-width`, or move it. |
| `text-clipped` | Text cut by an `overflow:hidden` box. Make it fit or let it wrap. |
| `text-overflows-box` | Text spills out of its card/background. Add padding/width or shorten. |
| `text-overlap` | Two texts on top of each other while settled. Move one or change timing. |
| `text-covered` | Part of a settled label is hidden behind something drawn on top of it. Move one, or raise the label (z-index / later in the HTML). |
| `text-over-line` | A visible stroke (an arrow, a line, the edge of a box) runs through the letters. Move the label or the line, or give the label a backing. |
| `tiny-text` | Under 22px on screen (at 1080p, after camera zoom): hard to read in a video. Use ≥ 24px, ≥ 32px for secondary text. A wide shot of a whole UI on purpose: camera shot option `overview: true`. |
| `low-contrast` | Text blends into what is behind it. Targets: 4.5:1 normal text, 3:1 large text (≥ 32px, or bold ≥ 24px), 1.6:1 for text with a `text-shadow` or outline. ✖ below two thirds of the target. Fix the color, or add a backing or shadow. |
| `unsafe-zone` | Text where the app's buttons and titles cover vertical video (with `data-safe-zone` or `check --safe-zone shorts`; also `reels`, `tiktok`, or `"top,right,bottom,left"` px). Move it inward, or `data-check="safe-ok"`. |
| `ghost-overlap` | During a scene change, text of both scenes is half visible on top of each other (a smudge). Use push/whip/cover/wipe/iris, move one text, or let the old one leave first. |

## Pacing and framing codes

| Code | Meaning / fix |
|---|---|
| `still` | Little changes on screen for 2.5 s or more (1.9 s at the very end: a dead end card): nothing enters, leaves or moves, and a slow float or a faint glow does not count. Viewers read it as the video stalling. Cut the hold, start the next beat sooner, or end earlier. |
| `empty-frame` | Almost nothing on screen for a second or more in the middle of the video (a camera crossing empty space between parts, a gap between scenes, a zoom so far out that everything is a speck). |
| `empty-start` | The first half second shows only the background. The first frame is often the thumbnail and the hook: show something from frame 0. |
| `camera-stop` | A camera world brakes to a halt and sets off again within 0.45 s: start the next shot as the previous one arrives (they then blend into one move) or hold it ≥ 0.5 s on purpose. |
| `fast-no-blur` | Something moves 40+ px per frame (at 1080p) in classic mode or with `data-motion-blur="off"`: it will strobe. Render with `--motion-blur 8`, or slow the move. |
| `straight-move` | A long dead-straight diagonal move (25%+ of the frame width). Leave `arc` at its default, or travel along a curved path. |
| `same-ease` | 8+ animations and more than 90% use the same bezier curve: drop the explicit eases (the natural defaults vary by role) or vary them (springs for arrivals, `in-*` for exits, `in-out-sine` for long moves). |
| `camera-late` | A camera shot arrives (its time + duration) after its scene starts its exit transition, so it is never seen at rest. Start it earlier or shorten it. |
| `camera-no-target`, `camera-padding` | A shot's target matched nothing in the world; a `padding` too big for the frame was clamped. |

Inside a `gm.camera` world, text sliding past the frame edge is fine, but a label that stays mostly in view and cut for 0.3 s or more is a warning: when the camera zooms in, frame the shot so the labels it is showing fit.

## Attribute, script and asset codes

| Code | Meaning / fix |
|---|---|
| `image-broken`, `image-failed`, `http-404`, `video-frame`, `video-no-src` | A file path is wrong (paths are relative to the HTML file). |
| `bad-time`, `bad-enter`, `bad-exit`, `bad-transition`, `bad-camera`, `bad-count`, `sequence-missing-duration`, `no-duration`, `cuts-short` | Fix the attribute as the message says. |
| `odd-size` | Width or height is odd; video codecs need even sizes (1920x1080). |
| `non-seekable-animation` | A CSS animation started inside `onFrame`; use `data-start` or set styles from `t`. |
| `timeline-no-target`, `cursor-target`, `fly-no-from`, `connect-no-target`, `burst-no-target` | A selector matched nothing. |
| `morph-no-pairs` | `morph` transition without matching `data-morph` names in both scenes. |
| `audio-not-found`, `audio-no-beats`, `audio-late` | `gm.audio()` found no file/element, found no steady beat, or was called after the video started. |
| `camera-no-world`, `travel-no-element`, `anchor-no-target`, `chart-no-element`, `loop-no-target` | A selector given to `gm.camera` / `gm.path.travel` / `data-anchor` / `gm.chart.line` / `gm.sketch.loop` matched nothing. |
| `travel-inline`, `travel-bad-side` | `gm.path.travel` on an inline element (a `<span>`: give it `display: inline-block`), or a `side` that is not `above` `below` `left` `right`. |
| `chart-no-values`, `chart-no-size`, `chart-bad-point` | `gm.chart.line` got fewer than 2 numbers, its element has no width/height, or a point name is not an index, label, `last` or `max`. |
| `data-missing` | A `{{data.…}}` came out empty: pass `--data`, add `data.json`, or give a default `{{data.x|default}}`. |
| `include-not-found` | A `<gm-include src>` file does not exist. |
| `load-timeout` | Something given to `gm.wait()` never finished. |
| `script-error`, `console-error` | Your JS threw; the message has the stack, file and line. Fix it first: a failed script also causes misleading `still`/`empty-start` warnings. |

## How check decides; data-check

- It compares frames, so anything moving or fading (CSS, timeline, React, onFrame, a camera follow) is skipped while it moves, and a problem must last ~0.25 s to count.
- Text that is fully hidden (outside the frame, behind a mask, waiting to slide in) or covered by something solid is not judged.
- Mark decorative copies (echoes, ghosts, outlines) with `data-check="ignore"` (or `aria-hidden="true"`), and layers that are meant to run past the frame edge (a film strip, a ticker, a big word bleeding off, zoomed into one line of code) with `data-check="crop-ok"` on that text or a parent. `data-check="safe-ok"` for text meant to sit in a vertical safe zone.
- Re-check one moment fast with `check --at 7.5`, or part of the video with `--from 6 --to 9`. Problems list every time range they happen in, and times also say how far into the scene the problem is.
- Exit code 1 when there are errors; warnings do not fail.
