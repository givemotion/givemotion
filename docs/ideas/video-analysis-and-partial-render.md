# Ideas: video analysis and partial re-render

Status: ideas only, from Leo (Oct 2026). Not built. Ask Leo before starting either one.

## 1. `givemotion analyze`: help an agent see a video

### The problem
An agent cannot watch a video. Given a reference video ("make ours look like this"), it would grab a few
frames and guess, building its own throwaway tools on the fly each time. Results would vary run to run.
The same gap hurts self-review: today the agent only sees still frames of its own work.

### The idea
One command turns any video (a reference, or our own render) into a report an agent can read:

```bash
npx givemotion analyze reference.mp4      # writes analysis/report.json, report.md and pictures
```

What it could measure (all with ffmpeg and Chrome, which we already use, so no new paid tools):

| What | How |
|---|---|
| Cuts and shot lengths | Scene-change detection between frames; list of shots with start, end, length |
| Pacing | The motion strip that `check` already computes (how much of the picture changes, per half second), plus average shot length and how it changes over the video |
| Transitions | Look at the frames around each cut: hard cut, fade (brightness ramps), wipe/push (one region changes first, in a direction), zoom (change grows from the center), whip (heavy blur) |
| Camera moves | Global motion between frames: pan, zoom in/out, shake, still |
| Color and branding | Main colors per shot and for the whole video (a palette), background vs accent, light or dark |
| Text and type | Where text sits on screen, how big, how long it stays; read the words if a text reader (OCR) is available |
| Music sync | Run the existing beat analysis on the audio track and say how many cuts land on beats |
| Pictures | One contact sheet per shot (start, middle, end), and frame strips around each transition |

The report ends with a "style recipe" in our terms, for example: "hard cuts every 0.6-1.2 s on the beat,
push transitions, dark navy background with one lime accent, bold condensed type at 140 px, slow camera
push on every shot". An agent can then build with `data-cuts`, `data-transition`, `data-camera` and so on.

### Why in the engine and not in the prompt
- Same answer every time for the same video (deterministic), instead of a new tool made per session.
- It reuses what the engine already has: ffmpeg frame decoding, the motion strip, beat detection, snapshot sheets.
- It closes the loop: render, then `analyze` our own MP4, then compare with the reference report
  ("your shots average 2.4 s, the reference 0.9 s").

### Open questions
- How good can transition-type guessing be without a trained model? Start with cuts, fades, pushes and zooms.
- OCR: a free local option exists (Tesseract) but is an extra install; keep it optional.
- Size of the report for long videos (summarize per minute).

## 2. Re-render only the part that changed

### What exists today
- `render --frames 4s-7s` renders only that part, but as its own new file. It does not patch the full video.
- Each render already works in chunks (one per worker) that are joined without re-encoding, but the chunks are
  thrown away after the render.
- Frames that do not change are reused within one render.

### The idea
Keep the chunks between renders and only redo the ones that changed:

1. Cut every render into fixed segments (for example 2 s each, each starting with a keyframe) and keep them in a
   cache folder next to the output, with a fingerprint of what each segment depended on.
2. On the next render, find which segments changed and redo only those, then join all segments again (no
   re-encode of the old ones, so joining is a few seconds).
3. Audio is mixed again at the end (cheap).

### How to know what changed
- **Simple and safe:** the agent says it: `render --redo 4s-7s` patches that range into the existing video.
- **Automatic, per scene:** fingerprint each scene's own HTML, plus the shared CSS, scripts, data and media
  files. If only scene 3's HTML changed, redo scene 3's time range (plus the transitions on both sides). If shared
  CSS or a script changed, we cannot know which frames it touched, so redo everything (or ask for a range).
- **Exact but costly:** render a tiny fingerprint of every frame and compare. This costs almost as much as rendering,
  because drawing the frame is the slow part, so it is not worth it.

### Would it be efficient?
Yes, for the common case of fixing one scene: a 60 s video where one 5 s scene changed would redo about 3 segments
instead of 30, roughly 10 times faster. Determinism (1 worker == N workers, byte for byte) is what makes splicing
safe: a re-rendered segment matches what a full render would have produced. Edge cases to handle: segment edges must
line up with keyframes, motion blur needs frames from just before the segment, and the fingerprint must include
`--data`, `--seed`, quality and size settings.
