# Output: render options, re-rendering, overlays, embed, React

Purpose: everything about producing files: render flags and formats, the parts cache, render speed, transparent overlays, standalone pages and the `<gm-player>` embed, and React/JSX compositions.

Contents
- Render options
- Re-rendering is fast (the parts cache)
- Render cost and speed
- Overlays with transparency
- Share and embed
- React (JSX) compositions

## Render options

`npx givemotion render video.html -o out/video.mp4 [options]`

`-o out.mp4|.webm|.mov|.gif|out.mp3|folder/` (format from the extension; a folder gives PNG frames; `--format mp4|webm|mov|gif|png`) · `--quality draft|standard|high|max` · `--crf <n>` · `--fps 60` · `--width` / `--height` · `--scale 2` (4K from a 1080p layout) · `--frames 0-90` or `2s-5s` (only that part, as a new file) · `--redo 4s-7s` · `--no-cache` · `--transparent` (with `.mov` ProRes 4444 or `.webm`) · `--muted` · `--motion-blur off|auto|8` (default `off`; `--shutter 0.5` = 180°) · `--codec h265|av1` · `--hardware` (GPU encoder; on a Mac on by default once it checks out, `--no-hardware` to turn off) · `--workers N` · `--data f.json` · `--props '{…}'` · `--seed 7` (seed for `Math.random`, default 1) · `--force` (render even with errors) · `--json`.

- `still video.html -t 3.2 -o f.png` (or `--frame <n>`) renders one exact frame; `--transparent` for a PNG with alpha.
- `render v.html -o sound.mp3` (or .wav/.m4a) exports only the soundtrack.
- Motion blur is off by default. `--motion-blur auto` (experimental) gives extra sub-frames only to frames where something moves fast (the render log says how many and the cost); with 2-4 sub-frames very fast text can show stepped copies, so look at those frames. A number forces that many sub-frames on every frame (smooth, but each frame renders n times).
- `npx givemotion doctor` checks Chrome, ffmpeg and which encoder is used; `npx givemotion install` downloads the Chrome build used for rendering; `npx givemotion clean` deletes cached frames.

## Re-rendering is fast (the parts cache)

A render keeps the video in 1-2 s parts (in `.gm-parts/` next to the output) with a fingerprint of what each part shows. Render again after a fix and only the parts that changed are redone:
- Edit one scene and only that scene's parts (plus the transitions into it) are rendered.
- Inside one long scene (a whiteboard, a camera world), editing something that appears later keeps the parts before it, when it is a nested clip (`data-start`), or is held hidden by a delayed `data-enter` and is `position:absolute` or an SVG shape, and no script, camera shot or arrow names it (the log says what changed).
- Change its length and the scenes after it move, so they are redone too; change shared CSS, a script, a file or the data and everything is redone.
- The joined video is byte-identical to a full render. `--redo 4s-7s` forces a part to be redone (e.g. when a script reads something the fingerprint cannot see); `--no-cache` keeps nothing.

## Render cost and speed

Without a GPU, every big element that moves on its own, every `<canvas>`, and everything drawn on top of them is redrawn on each frame, and a `filter` on a big element doubles that. A big blurred glow that stays put is almost free. `npx givemotion bench video.html` prints how much of the frame these layers cover and the biggest ones. Use `--quality draft` while iterating if you must render, and `snapshot`/`still` instead of full renders to review.

## Overlays with transparency

Leave `<html>` and `<body>` without a background, then `npx givemotion render overlay.html -o out/overlay.mov --transparent` (ProRes 4444) or `-o out/overlay.webm --transparent` (VP9 with alpha). `check` and `snapshot` detect a transparent page automatically: contrast is not judged against nothing, and the sheet shows a checkerboard. Pass `--transparent` to `still` for a PNG with alpha. Good for lower thirds, captions and logo bugs placed over footage in an editor.

## Share and embed

`npx givemotion bundle video.html -o dist/` writes a standalone page (runtime inlined, blocks expanded, assets copied; plays in any browser, served by any static web server, not opened as `file://`), `gm-player.js` and a demo `player.html`. Embed in a site or app: `<script src="gm-player.js"></script><gm-player src="video.html" controls autoplay loop muted></gm-player>` (methods `play()`, `pause()`, `seekTo(s)`; events `ready`, `timeupdate`, `ended`; `data='{"name":"Ana"}'` feeds `gm.data`).

## React (JSX) compositions

You can also write a composition as a React component in `video.jsx` (or `.tsx`); every command works the same (`check video.jsx`, `render video.jsx`). Plain HTML is the recommended format (in tests it scored as well or better); use JSX when you already have React components. Read `references/react.md` for the API (`Sequence`, `Scene`, `Clip`, `useTime`, `useTimeline` …).
