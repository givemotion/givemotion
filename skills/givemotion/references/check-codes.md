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
| `text-offscreen` | Text runs past the frame edge for 0.2 s or more (✖). Smaller font, `max-width`, or move it. Inside a camera world it is a ⚠ when a label is cut by the frame edge while the shot holds (even if most of it is out: "st works" of a title reads as a mistake); frame the shot so labels are fully in or fully out. |
| `text-clipped` | Text cut by an `overflow:hidden` box. Make it fit or let it wrap. |
| `text-overflows-box` | Text spills out of its card/background. Add padding/width or shorten. |
| `text-overlap` | Two texts on top of each other while settled. Move one or change timing. |
| `moving-overlap` | Two readable texts (both above half opacity) on top of each other for 0.2 s+ while one of them moves: an exit and the next entrance at the same time ("Your" still under "Copy."). Let the old text leave (or fade below half) before the new one arrives. Crossfades, morph pairs and the letters of one split word are not reported. |
| `text-covered` | Part of a settled label is hidden behind something drawn on top of it. Move one, or raise the label (z-index / later in the HTML). Text of a camera world under a layer outside the world (a caption band, a title card) is reported even when fully hidden: frame the shot so its labels clear the overlay. |
| `text-over-line` | A visible stroke (an arrow, a line, the edge of a box) runs through the letters. Move the label or the line, or give the label a backing. Anything opaque painted above the line where the letters are counts as a backing: the label's own card (background alpha 0.85+), a `::before` scrim, an SVG or `data-sketch` fill riding the line. |
| `tiny-text` | Under 22px on screen (at 1080p, after camera zoom): hard to read in a video. Use ≥ 24px, ≥ 32px for secondary text. A wide shot of a whole UI on purpose: camera shot option `overview: true`. |
| `low-contrast` | Text blends into what is behind it. Targets (WCAG): 4.5:1 normal text, 3:1 large text (≥ 24px, or bold ≥ 18.66px, on screen at 1080p after camera zoom), 1.6:1 for text with a `text-shadow` or outline. ✖ below two thirds of the target. Texts with the same color on the same flat backing get the same verdict, even if only one was measured. Fix the color, or add a backing or shadow. |
| `unsafe-zone` | Text where the app's buttons and titles cover vertical video (with `data-safe-zone` or `check --safe-zone shorts`; also `reels`, `tiktok`, or `"top,right,bottom,left"` px). Move it inward, or `data-check="safe-ok"`. |
| `ghost-overlap` | During a scene change, text of both scenes is half visible on top of each other (a smudge). Use push/whip/cover/wipe/iris, move one text, or let the old one leave first. |

## Pacing and framing codes

| Code | Meaning / fix |
|---|---|
| `still` | Little changes on screen for 2.5 s or more (1.9 s at the very end: a dead end card): nothing enters, leaves or moves, and a slow float or a faint glow does not count. Viewers read it as the video stalling. Cut the hold, start the next beat sooner, or end earlier. |
| `empty-frame` | Almost nothing on screen for a second or more in the middle of the video (a camera crossing empty space between parts, a gap between scenes, a zoom so far out that everything is a speck). |
| `empty-start` | The first half second shows only the background. The first frame is often the thumbnail and the hook: show something from frame 0. |
| `camera-stop` | A camera world brakes to a halt and sets off again within 0.45 s: start the next shot as the previous one arrives (they then blend into one move) or hold it ≥ 0.5 s on purpose. A move that turns straight around (zoom in, then back out) without dwelling is not a stop. |
| `fast-no-blur` | Something moves 40+ px per frame (at 1080p) in classic mode or with `data-motion-blur="off"`: it will strobe. Render with `--motion-blur 8`, or slow the move. |
| `straight-move` | A long dead-straight diagonal move of an element (25%+ of the frame width), measured in its camera world (a camera move is not the element moving). Leave `arc` at its default, or travel along a curved path. |
| `css-scale-vs-tween` | An element has a CSS `scale` (e.g. `scale: 0`) and a `gm.timeline` tween on `scale`: the timeline writes `transform`, and the browser multiplies the two, so `scale: 0` stays 0. Give the start value to the timeline (`fromTo`, `from`, `gm.set`) instead. |
| `same-ease` | 8+ animations and more than 90% use the same bezier curve: drop the explicit eases (the natural defaults vary by role) or vary them (springs for arrivals, `in-*` for exits, `in-out-sine` for long moves). |
| `camera-late` | A camera shot arrives (its time + duration) after its scene starts its exit transition, so it is never seen at rest. Start it earlier or shorten it. |
| `camera-no-target`, `camera-padding` | A shot's target matched nothing in the world; a `padding` too big for the frame was clamped. |

Inside a `gm.camera` world, text sliding past the frame edge while the camera moves is fine, but a label cut by the frame edge for 0.3 s or more while the shot holds is a warning: frame each shot so the labels it shows fit, and neighbours are fully out.

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
| `camera-no-world`, `travel-no-element`, `anchor-no-target`, `chart-no-element` | A selector given to `gm.camera` / `gm.path.travel` / `data-anchor` / `gm.chart.line` matched nothing. |
| `chart-no-values`, `chart-no-size`, `chart-bad-point` | `gm.chart.line` got fewer than 2 numbers, its element has no width/height, or a point name is not an index, label, `last` or `max`. |
| `data-missing` | A `{{data.…}}` came out empty: pass `--data`, add `data.json`, or give a default `{{data.x|default}}`. |
| `include-not-found` | A `<gm-include src>` file does not exist. |
| `load-timeout` | Something given to `gm.wait()` never finished. |
| `script-error`, `console-error` | Your JS threw; the message has the stack, file and line. Fix it first: a failed script also causes misleading `still`/`empty-start` warnings. |

## How check decides; data-check

- It compares frames, so anything moving or fading (CSS, timeline, React, onFrame, a camera follow) is skipped by the layout checks while it moves, and a problem must last ~0.2-0.3 s to count. "Moving" means: an entrance/exit/short animation is running on it or a parent, it moves more than ~40 px/s (at 1080p) inside the biggest moving layer around it, or it moves faster than ~600 px/s on screen whatever carries it (a full-frame panel pushed in, a fast camera move). A slow camera drift does not make text "moving". Only `moving-overlap` and `ghost-overlap` look at moving text.
- Text that is fully hidden (outside the frame, behind a mask or clip-path, waiting to slide in) or covered by something solid is not judged (except camera-world text under an overlay, see `text-covered`). Overlap tests use each text's visible part (its own and its parents' `clip-path`: inset, polygon, circle, ellipse).
- `data-check` takes one or more space-separated values, on the element or any parent (its whole subtree):

| Value | What it does |
|---|---|
| `ignore` | Skip every check for that subtree (decorative copies: echoes, ghosts, outlines). `aria-hidden="true"` does the same. |
| `crop-ok` | Being cut by the frame edge is meant: no `text-offscreen`, `text-clipped`, `unsafe-zone` (a film strip, a ticker, a big word bleeding off, zoomed into one line of code). |
| `overlap-ok` | Overlapping is the point (a pile of cards, a collage): no `text-covered`, `text-overlap`, `moving-overlap`, `ghost-overlap` or `text-over-line` for text inside it, or for things inside it covering other text. Every other check still runs. |
| `safe-ok` | Text meant to sit in a vertical-video safe zone: no `unsafe-zone`. |

- Re-check one moment fast with `check --at 7.5`, or part of the video with `--from 6 --to 9`. Problems list every time range they happen in, and times also say how far into the scene the problem is. (`snapshot --times` with `--from/--to` keeps only the times inside that range.)
- Exit code 1 when there are errors; warnings do not fail.
