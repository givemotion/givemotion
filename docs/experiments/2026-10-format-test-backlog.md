# Engine fixes found during the experiment (apply AFTER all runs, to keep runs comparable)

## from race-H
- [critical] data-camera (float) makes check treat everything as mid-animation → check silently passes. Fix moving-detection (compare rects across nearby frames; ignore camera).
- float drift too large (~46px); camera + timeline on same element combine badly (composite add order). Compose camera outermost; maybe smaller default.
- CLI to print audio analysis: `gm audio music.m4a` (bpm, beats, onsets).
- check flags JS-moved elements (onFrame) as settled → overlap warnings mid-swap. Detect motion by position diff over nearby frames.
- check time ranges merge separate occurrences (2.6–7.8s) → report separate ranges.
- tiny-text during timeline scale tween → same motion detection.
- check slow (77s for 15s JS-heavy) → faster sampling.
- snapshot auto moments skip long single-clip videos → add evenly spaced moments inside long clips.
- want: odometer/rolling digits primitive; smooth rank/reorder helper for races.
- want: snapshot --range a-b --every 1f.
- docs: gm.audio analysis covers only composition duration; gm.wait(fetch) + timeline inside is OK (document).
- fonts: docs say use local @font-face; consider shipping a few open fonts (Inter etc., OFL) with blocks.

## from promo-N
- [critical] morph: ancestors of morph element stay opaque (ghost card) — fadeKids keeps whole ancestor chain; should fade siblings but keep ancestor backgrounds fading too (only the morph element itself must stay solid). Use per-element opacity compensation? Better: lift morph elements into an overlay layer during the transition (clone/portal) so ancestors can fade normally.
- morph + timeline transform on target → double image / snap. Morph must own transform of a wrapper, or compose.
- text waiting before entrance (timeline .from with overflow:hidden mask) flagged as clipped → motion-detection across frames + "not yet entered" detection.
- gm.audio('../x') treated as selector → only treat as selector if no '/' and no extension... detect file paths by extension.
- server root = html folder; files outside 404 → docs or allow parent (project root detection).
- still should report page errors/404s.
- snapshot output should list frame filenames.
- snapshot --every slow; speed.
- want: inspect --at 12.3 '#logo' → element rect/opacity/transform at a time.
- want: snapshot --gif a-b (short preview), onion skin strip.
- measuring layout at timeline build: scenes display:none while loading → provide layout-available hook or relative units in timeline (e.g. x: 'to #target').

## from kinetic-R
- [critical] useAudio('music.m4a') without <audio> element → bpm 0 silently. In React, `<audio>` rendered by React then useAudio('#music') → empty (selector resolved before mount). Fix: resolve lazily; report empty analysis.
- check false errors for React/JS-driven motion (same as above: detect motion by frame diff).
- check ranges misleading (same).
- tight tracking split chars → text-overlap warnings between neighbor letters of same word → ignore overlap between siblings of same split.
- covered text (under opaque layer) judged for contrast → check occlusion (elementFromPoint at text center).
- check --at / --from --to.
- easing names in React interpolate unclear → document names list in react.md (same as gm).
- want: beat grid helper (downbeats, bars, beatAt(n)).
- gradient text split chars manual → we do fixClipText for data-split; for React per-char spans nothing. Maybe CSS approach.
- want: preview gif for agents (snapshot --gif / --strip).

## from explainer-H
- check: text not yet revealed (mask/clip-path before enter) flagged offscreen → treat clip-path fully clipped as invisible; use visible-area test.
- docs: fromTo/from immediateRender rule; "latest started tween wins"; info.time in onFrame; transformOrigin in timeline OK for SVG?
- auto snapshot picks one frame for long scene / mid camera move → evenly spaced inside long clips; avoid mid-transition.
- snapshot --every slow, no progress output → progress + --scale 0.5 draft.
- [big want] camera/world primitive: gm.camera('#world', {follow:'#pkg', lag, zoom}) and shots framing elements (fit:['#a','#b']).
- [big want] path travel with stops: gm.path.travel(el, path, stops) with auto-rotate.
- want: inspect --audio (bpm/beats).
- want: low-res preview gif/strip for agents (preview --fps 6 --scale .25).
- want: data-enter delay referencing timeline labels or JS API gm.enter(el,'mask-up',{at}).

## from promo-R
- SVG transform-origin under timeline: I set transformBox fill-box + origin 50% 50% when not given; but user set transformOrigin in style → my check `!el.style.transformOrigin` respected it, yet transformBox fill-box changes meaning of px origin → only set transform-box when we also set origin.
- fromTo from-state visible before start for strokes/round caps (draw:0 shows dots) → draw 0 should also hide caps (set stroke-opacity 0 / visibility when len 0?). Document tl.set. Option immediateRender:false documented.
- [critical] morph transition fade animation overrides user's opacity (WAAPI wins over inline opacity) → brings back faded elements. Fade must multiply, not replace: use a wrapper-level approach or composite... opacity can't multiply via composite? 'accumulate' for opacity is additive. Alternative: fade via `filter: opacity()`! filter composes separately from opacity property. Use filter opacity for transition fades.
- doc: only data-morph elements travel; siblings crossfade.
- snapshot --transitions (start/mid/end of each transition + frame 0 of each scene).
- check: stray from-states visible before first tween (hard), opacity changes during transitions.
- Scene ref forwarding in React → make Scene/Clip forward refs (merge with internal).
- want: sequence durations computed from cut times / "cut on beat N" (e.g. data-cuts or Sequence cuts={[...]}).
- motionPath prop in timeline.

## from kinetic-H
- [critical] beat grid inaccurate: bpm 112.5 vs real 112 (0.5357s), phase 0.067 vs real first kick 0.52 → grid drifts ~80ms. Fix: refine period sub-frame (fit to onsets, least squares), phase from strongest low-band onsets, first beat = first real onset; analyze at higher resolution (hop 256 samples, not per video frame).
- handle.ready is a boolean but looks like promise → expose `loaded` promise (doc) and make `ready` a promise-like? Rename boolean.
- beats limited to video length (doc) but onsets go beyond → consistent.
- console.log output not visible in check --json → include console messages in check/inspect output.
- want: audio command printing bpm/beats/downbeats/sections; snapshot --beats; beat strip on sheet.
- want: sequence from cut times.

## from race-N / explainer-N / kinetic-N
- data-fit="grow" did nothing (lines ~30px instead of filling 920px) → investigate: inline-block children, measuring container width; test.
- measuring hidden scenes: provide gm.measure(el) / layout-ready hook where all scenes are displayed; document when scripts run.
- check ignores aria-hidden? want data-check="ignore" / decorative copies excluded.
- does data-split exist when timeline selectors resolve? (yes, lazily at build) → document.
- check slow (~2 min/run) on JS-heavy pages.
- [big want, x3] camera/world primitive: follow element with lag, fit-to-elements shots, parallax layers.
- morph inside camera-transformed / onFrame layers → now live-measured (post hook) — document.

## from race-R
- [bug] gm.random('a12') with string seed → same value; AIs expect a random(seed) → number in [0,1). Make gm.random(seed) return a number (hash strings), add gm.rng(seed) for a generator.
- checker ignores masks/clip-path (visible area).

## from promo-H
- timeline tweens replace the element's CSS transform silently (decompose reads computed matrix; but translate(-50%,-50%) centering etc. becomes px, and rotate/scale combos lost?) → keep CSS transform as a base string prefix instead of decomposing? Better: compose: base computed transform string (original CSS) + tween transform. Document.
- silent audio failures outside check (still/snapshot) → print page errors in still/snapshot.
