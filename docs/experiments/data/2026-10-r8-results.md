# Round r8: results

Engine: refs/heads/main @ ad2f88a7ae. Runs set up 2026-10-24T12:38:51.427Z. 18 judge sheets. Scores 1-10, means over judges.

## Per video

| brief | video | group | brief | motion | craft | errors | overall | avg rank | #1 | length | render |
|---|---|---|---|---|---|---|---|---|---|---|---|
| code-explainer | code-explainer-1 | r8 | 8.0 | 7.5 | 7.5 | 7.0 | 7.5 | 1.5 of 2 | 1 | 22.5 s | 37.8 s |
| code-explainer | code-explainer-2 | r8 | 8.0 | 7.5 | 7.5 | 7.0 | 7.5 | 1.5 of 2 | 1 | 22.4 s | 34.77 s |
| data-story | data-story-2 | r8 | 9.0 | 8.0 | 7.0 | 7.0 | 7.5 | 1.0 of 2 | 2 | 18.9 s | 40.83 s |
| data-story | data-story-1 | r8 | 8.0 | 7.5 | 7.5 | 6.0 | 7.0 | 2.0 of 2 | 0 | 18.7 s | 35.81 s |
| explainer | explainer-1 | r8 | 8.5 | 7.5 | 7.5 | 6.5 | 7.5 | 1.5 of 2 | 1 | 28 s | 53.87 s |
| explainer | explainer-2 | r8 | 8.0 | 7.5 | 7.5 | 6.5 | 7.5 | 1.5 of 2 | 1 | 25.8 s | 47.96 s |
| hand-drawn | hand-drawn-2 | r8 | 9.0 | 8.0 | 8.0 | 7.0 | 8.0 | 1.0 of 2 | 2 | 30 s | 35.61 s |
| hand-drawn | hand-drawn-1 | r8 | 8.0 | 7.0 | 7.0 | 6.5 | 7.0 | 2.0 of 2 | 0 | 31 s | 39.73 s |
| logo-sting | logo-sting-2 | r8 | 7.0 | 7.0 | 7.5 | 7.5 | 7.0 | 1.5 of 2 | 1 | 5.2 s | 18.85 s |
| logo-sting | logo-sting-1 | r8 | 8.0 | 7.5 | 7.0 | 8.0 | 7.0 | 1.5 of 2 | 1 | 5.4 s | 30.15 s |
| promo | promo-1 | r8 | 8.0 | 7.5 | 7.0 | 6.0 | 7.0 | 1.0 of 2 | 2 | 18.6 s | 44.13 s |
| promo | promo-2 | r8 | 8.0 | 6.0 | 7.0 | 7.5 | 6.0 | 2.0 of 2 | 0 | 18.5 s | 41.19 s |
| ui-demo | ui-demo-1 | r8 | 9.0 | 7.5 | 8.0 | 6.0 | 8.0 | 1.0 of 2 | 2 | 18 s | 61.63 s |
| ui-demo | ui-demo-2 | r8 | 8.0 | 7.5 | 7.5 | 7.0 | 7.0 | 2.0 of 2 | 0 | 18.8 s | 45.75 s |
| vertical-short | vertical-short-2 | r8 | 8.0 | 7.0 | 7.0 | 6.5 | 7.0 | 2.0 of 2 | 0 | 13.367 s | 66.39 s |
| vertical-short | vertical-short-1 | r8 | 8.0 | 7.0 | 8.0 | 7.0 | 7.0 | 1.0 of 2 | 2 | 12.833 s | 31.19 s |
| year-recap | year-recap-1 | r8 | 8.0 | 7.0 | 7.0 | 7.5 | 7.0 | 1.0 of 2 | 2 | 18.2 s | 56.31 s |
| year-recap | year-recap-2 | r8 | 8.0 | 6.0 | 7.0 | 7.0 | 6.0 | 2.0 of 2 | 0 | 17.133 s | 44.77 s |

## Per group

| group | videos | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|---|
| r8 | 18 | 8.1 | 7.3 | 7.4 | 6.9 | 7.1 | 1.5 | 18 |

## Friction logs

56 engine, 48 docs, 31 agent entries.

- code-explainer-1 [engine] code-window `⟦ ⟧` marks are shifted and break the line structure
- code-explainer-1 [engine] check false positives on SVG text over a filled SVG circle
- code-explainer-1 [agent] last camera shot never landed before the transition
- code-explainer-1 [docs] arrows to a code mark run over neighbouring punctuation
- code-explainer-1 [docs] `mw.burst` x/y units
- code-explainer-1 [docs] timeline opacity vs `data-enter` on the same element
- code-explainer-1 [engine] render speed
- code-explainer-2 [engine] code-window `⟦ ⟧` marks are shifted by one character per line
- code-explainer-2 [engine] marks have no ids and no timed highlight
- code-explainer-2 [engine] `still` warning during an intentional pause / small-element motion
- code-explainer-2 [docs] `mw.burst` x/y units unclear
- code-explainer-2 [docs] `mw.connect` curve and side attachment for short arrows
- code-explainer-2 [docs] default snapshot moment for the title scene is mid-animation
- code-explainer-2 [agent] note labels too close to the code
- code-explainer-2 [agent] camera follow cropped the lane labels
- code-explainer-2 [docs] code-window title text is tiny once the window is scaled
- data-story-1 [engine] Tween renders its *natural* (end-ish) state on the exact frame it starts
- data-story-1 [engine] `mw.burst(..., { from: '#head' })` inside a camera world spawns at the wrong place
- data-story-1 [engine] No chart primitive for a "live" data line (camera-follow, rescaling axis)
- data-story-1 [engine] check `text-over-line` fires for gridline labels and for the chart line passing under a HUD with a scrim
- data-story-1 [docs] Unclear whether the camera `follow` sees elements I move in `onFrame`
- data-story-1 [docs] `offset` sign for camera shots took a moment
- data-story-1 [agent] Callouts measured against previous-frame boxes
- data-story-1 [agent] Overview shot started too late to be seen
- data-story-1 [engine] check and render are slow for an 18.7 s 1080p video
- data-story-2 [agent] Broke my own file with a string splice
- data-story-2 [engine] The line-chart block cannot drive the story the brief asks for
- data-story-2 [docs] A small dip is invisible on a linear axis that ends at 48,000
- data-story-2 [engine] No warning when a camera shot cannot complete before its clip ends
- data-story-2 [engine] Fit-all overview shrinks every label to unreadable sizes
- data-story-2 [engine] text-over-line still fires when the label has a backing
- data-story-2 [docs] Unclear whether camera `follow` sees elements moved in `onFrame`
- data-story-2 [docs] Scene length cannot follow the data
- data-story-2 [docs] `inspect` lists scene clips twice
- data-story-2 [engine] Morph between two texts looks like a crossfade
- explainer-1 [engine] text-over-line false positives on an opaque panel
- explainer-1 [engine] camera fit on an element that is scaled to 0 before it pops in
- explainer-1 [engine] low-contrast error for white SVG text
- explainer-1 [docs] CSS start transform multiplied by timeline transform
- explainer-1 [agent] hand-off box drawn under the truck
- explainer-1 [docs] keeping subjects clear of a screen-space panel
- explainer-1 [docs] intro title over a blurred world gives text-over-line warnings
- explainer-2 [engine] text-over-line flags captions that have a solid backing
- explainer-2 [docs] Camera `fit` on a small element zooms too far and cuts the labels next to it
- explainer-2 [docs] World edge shows in the final pull-back
- explainer-2 [agent] fromTo rings visible before their tween
- explainer-2 [agent] Gave a shot both `center` and `fit`
- explainer-2 [agent] Route trail left a dot at its start
- explainer-2 [docs] Caption pill shows empty before its masked words reveal
- explainer-2 [engine] Render speed
- hand-drawn-1 [engine] connect label too small and in the wrong place
- hand-drawn-1 [engine] arrows attach to the middle of a side only
- hand-drawn-1 [docs] unit and placement of `label.size` not documented
- hand-drawn-1 [agent] first layout too spread out
- hand-drawn-1 [agent] the follow shot ended before the next move, so a label was cut at the edge
- hand-drawn-1 [docs] does `fit` include hidden (not yet written) labels?
- hand-drawn-2 [docs] White fill under data-sketch rendered as pink hatching
- hand-drawn-2 [engine] text-offscreen warnings for neighbours in a camera world
- hand-drawn-2 [engine] mw.connect label placement hard to control
- hand-drawn-2 [agent] Arrow from the URL bar ran through the step-1 label
- hand-drawn-2 [docs] connect `label.offset` unexplained
- hand-drawn-2 [engine] Render speed
- hand-drawn-2 [docs] Small: arrow drawing time vs camera move
- logo-sting-1 [docs] fromTo() start values show from clip start, so "hidden until hit" elements appeared at t=0
- logo-sting-1 [agent] wordmark chars showed on the wrong side of the moving icon
- logo-sting-1 [engine] render is slow for a short sting
- logo-sting-1 [docs] draw segment tween semantics guessed
- logo-sting-1 [engine] biggest hit had to be copied by hand
- logo-sting-2 [engine] `mw.burst` `behind` does not layer the sparks under the element
- logo-sting-2 [engine] Burst sparks are too small to read as a hit at 1080p
- logo-sting-2 [docs] `fromTo` start values showed my hidden shockwave rings from frame 0
- logo-sting-2 [agent] Chars overlapped the mark while it slid left
- logo-sting-2 [agent] Opening frame almost empty
- logo-sting-2 [agent] Second hit centered on the wrong point
- promo-1 [agent] Truncated video.html with a broken Python edit script
- promo-1 [engine] Cursor block times are clip-local and can't refer to beats or video time
- promo-1 [docs] Camera `fit` frames the layout box, including empty space
- promo-1 [docs] Overview shot of a wide world shrinks text below the readable size
- promo-1 [docs] Travel dot drawn over the node icons
- promo-1 [docs] Default snapshot misses some key moments of long camera scenes
- promo-2 [docs] Clip local time is not the cut time when cut-align is middle
- promo-2 [engine] Camera shots start at their time, I want them to *arrive* on the beat
- promo-2 [docs] No documented persistent background under a whole sequence
- promo-2 [engine] Render is slow
- promo-2 [engine] browser-window scroll timing is fixed
- promo-2 [docs] Can `data-check` take several values?
- promo-2 [engine] First frame is nearly empty, nothing warns
- promo-2 [agent] Misread a snapshot cell as wrongly scaled
- promo-2 [agent] Benefits nodes too close in the camera world
- ui-demo-1 [engine] Cursor block inside a camera world flies off screen
- ui-demo-1 [docs] No guidance for cursor + camera together
- ui-demo-1 [engine] Low-contrast false errors during fades and under an outro scrim
- ui-demo-1 [engine] Lots of tiny-text warnings for the establishing overview shot
- ui-demo-1 [engine] No same-scene "fly from A to B"
- ui-demo-1 [docs] Camera fit on a small element over-zooms
- ui-demo-1 [agent] fromTo start values show from the clip start
- ui-demo-1 [agent] Camera offset sign
- ui-demo-1 [docs] Step captions
- ui-demo-1 [engine] text-covered warnings for UI overlays
- ui-demo-1 [engine] Render speed
- ui-demo-2 [engine] fromTo with keyframes shows the element before the tween starts
- ui-demo-2 [docs] data-enter overrides my own `translate` centering
- ui-demo-2 [engine] low-contrast error, when the real cause is a caption box covering the label
- ui-demo-2 [engine] tiny-text warnings for intentional wide shots of a UI
- ui-demo-2 [docs] tl.set with className not documented
- ui-demo-2 [docs] snapshot --times and --transitions together
- ui-demo-2 [agent] hand-computed flight deltas
- vertical-short-1 [docs] Clip start times with data-cuts + cut-align middle + transitions
- vertical-short-1 [agent] Big kinetic type overlapped the captions
- vertical-short-1 [docs] `text-covered` not in check codes table
- vertical-short-1 [agent] First frame was empty
- vertical-short-1 [agent] Forgot the red REC dot element
- vertical-short-1 [docs] code-window block and HTML code
- vertical-short-1 [engine] Beat pulse needs manual onFrame code
- vertical-short-1 [engine] Voice-over shorter than requested length
- vertical-short-2 [engine] Beat pulse needs hand-written glue
- vertical-short-2 [engine] data-cuts cannot be written in beats
- vertical-short-2 [docs] music.beat(t): video time or clip time?
- vertical-short-2 [engine] Morph between different shapes looks muddy
- vertical-short-2 [agent] Big type pushed off-screen by camera push plus beat pulse
- vertical-short-2 [agent] Pink text on a pink gradient failed contrast
- vertical-short-2 [engine] check/snapshot are slow
- vertical-short-2 [engine] Empty first frame not flagged
- year-recap-1 [engine] Extra top-level statement makes a scene lose its background
- year-recap-1 [engine] zoom-through transition looks broken at the midpoint
- year-recap-1 [docs] Timeline transform overrides SVG `transform="rotate()"`: sun rays collapsed
- year-recap-1 [docs] mw.burst tuning without units/defaults
- year-recap-1 [agent] Cream number on orange failed contrast
- year-recap-2 [engine] zoom-through transition looks broken on solid-color scenes
- year-recap-2 [engine] check missed a label crossing a dashed SVG ring
- year-recap-2 [engine] check missed big-number descender overlapping the label below
- year-recap-2 [docs] where does clip time 0 sit with data-cut-align="middle"?
- year-recap-2 [docs] low-contrast fix for colored type on colored background
- year-recap-2 [agent] sun, pin and flag overlapped in the Lisbon scene
- year-recap-2 [agent] first frame nearly empty

## Judges' notes

- code-explainer-1: Covers every beat: the code types on, the camera pushes into clearTimeout/setTimeout with hand-drawn arrows and notes, and a live search-box sim shows two bursts each giving one call. But the code window and the sim sit small in a lot of empty frame, so the sim labels are tiny, the zoomed code is cut hard at the left edge, and the outro card holds almost still for about 2.5 s.
- code-explainer-1: Dims the rest of the code during the zoom so the key lines stand out, and the hand-drawn arrows feel lively. The visual ties events to a real search box being typed into ('react js'), with live event and call counters, so the cause and effect reads very clearly. The visual text is still small, a faint 'Wait' ghost overlaps the timeline during the cut to the outro (19 s), and the end card is mostly static for about 2.5 s.
- code-explainer-2: Polished, readable explainer: numbered callouts (cancel / start fresh / runs after quiet) on the zoomed code, then a large timeline where the camera follows a countdown that keeps resetting until a 'fire!' burst gives '10 events -> 1 call'. Problems: during the zoom the last code line is clipped at the bottom of the frame, callout 3's text runs into the right edge, and the outro is nearly static.
- code-explainer-2: Covers everything the brief asks for: the title, the code typed out, a camera push-in with three numbered callouts (cancel, restart, runs after quiet), and a clear '10 events -> 1 call' timeline with a countdown and a fire burst. The timeline text is small, with empty space around it, the row labels get cut at the left edge while the camera pans (14-15 s), and the outro holds still for about 2.5 s.
- data-story-2: The camera really does follow the line: the month axis scrolls along, the counter rides on the tip of the line, the full-year reveal fills the frame with both callouts, and the 36x-to-40x ending is clean. But the counters and annotation text are small and less dramatic, the viral-video tag crowds the AUG counter at 8.5s, and the counter shows MAR 2,217 after leaving March.
- data-story-2: The camera really follows the line: the counter rides on the line head, and the month axis scrolls and rescales smoothly. The pullback to an annotated full-year chart (outage and viral pills, 48,000 at the peak) flows well into a nicely lit 40x ending. The main problem is tiny secondary text (the 'monthly active users' labels and axis values are unreadable), plus a few ghost overlaps while things fade (48,000 at 12.5s, a faint '1,200 → 48,000' at 14.5s).
- data-story-1: Large, dramatic month counters with a strong type hierarchy, clear outage and viral-video callouts, and a punchy 1x-to-40x count-up with confetti at the end. But callouts get cut off by the bottom of the frame (Outage at 6.5s, Viral video box at 10s), the counter says MAR 2,135 while still showing the -8% tag, and the full-year overview is squashed into a thin strip with tiny labels and a lot of empty space.
- data-story-1: Strong hierarchy: a big top-left counter, a red flash for the outage, a gold ring for the viral jump, and a 1x-to-40x count-up with confetti for the finale. But during the camera moves, callouts get cut off at the bottom edge ('Outage' at 6.5s, the 'Viral video' pill at 10s, axis labels at 4s), the 3s frame is almost empty, and the zoomed-out overview at 13-14.5s uses text too small to read.
- explainer-1: Strong single-map world with a real camera that travels warehouse to highway to hub to door, numbered step cards and a nice wide pull-back recap. Problems: the map is busy and the robot step reads small, the card subtitles are tiny, the title and outro hold almost still, and labels/props get cut by the frame edge ('Your door' and the phone at 6-7.5s, 'Your door' at the bottom around 19.5-20s).
- explainer-1: Sets up the whole map world first, then the camera travels a single winding route through all four steps, with numbered step cards and a kinetic 'Tap. Pick. Drive. Deliver.' payoff over the full overview. Some small flaws: the title overlaps the map labels during the 3 s transition, the phone and 'Your door' label are cut at the frame edge around 6-7 s and 19.5-20 s, the card subtitles are tiny, and the title holds near-static for a bit at the start and end.
- explainer-2: Clean, legible design. The phone tap hands off along a route line into a clearly animated robot pick, then the truck, hub and courier, all on one continuous camera path, ending in a clear wide recap. Problems: step 1 is a separate phone scene rather than part of the map, the headline is clipped at the right edge during the 5s transition, labels are cut while panning ('Local hu', 'Your door' at 18.5s), and the outro hold is static.
- explainer-2: From the warehouse on, one continuous camera follows the package along a single route through a nicely detailed map to a clean overview ending. The first 5 s are a static website-style hero (phone mockup plus a big headline), the step labels are small, and labels get cut by the frame edge during camera moves ('Local hub' at 12 s, 'Your door' at 18.5 s, the headline clipping the right edge at 5 s).
- hand-drawn-2: Bolder and more Excalidraw-like: hatched fills, the DNS step shown as a 'phone book' card, an extra 'the internet' node, and the page drawn right inside the laptop with a 'ta-da!' scribble. The camera pans and zooms with clear purpose before pulling back to the full diagram. Problems: elements are often cut by the frame edge (the IP card at 11-14 s, the globe and IP on the right at 23-28 s), and the overview labels end up tiny.
- hand-drawn-2: The camera feels the most like real motion design: it pushes in on each step (typed URL with highlight, a 'phone book of the web' DNS card that returns the IP, globe, server, HTML doc, the page drawing in with a 'ta-da!') and ends on a full pull-back that fills the frame well. Labels and highlights are rich and on-brief. Main problems: there is no title, the IP card and some labels are clipped at the frame edges during pans, and the labels in the final wide shot are very small.
- hand-drawn-1: All five steps sit on one canvas: a handwritten title, a laptop drawn line by line, the URL typed in, arrows that draw on, and a final pull-back to the whole diagram, with a restrained blue/orange accent palette. Problems: the camera often leaves things half out of frame (the title clipped at the top edge around 13-17 s, the server and its label cut at the right edge for about 6 s from 21.5 s), and most labels are very small, so the final overview is hard to read.
- hand-drawn-1: Covers every step on one canvas: a handwritten title, a laptop that draws itself on and types the URL, a globe for DNS, a server, GET and HTML packets, the page drawing in, and a pull-back to the whole diagram at the end. But the camera often frames things badly: the title is cut off by the top edge from about 13 to 17 s, the server and the '3. request' label sit half off the right edge from 21 to 27 s, and the final wide shot leaves the diagram small with a lot of empty paper.
- logo-sting-2: Clean build: crossing flow lines converge into the logo, a strong radial burst at 3s, then a tidy lockup with a slight drift. But the first frame is nearly empty and 0.5-1.5s barely changes (the lines sit almost still), so the opening is not energetic, and the tagline is very small.
- logo-sting-2: Clean, elegant build: flowing curves sweep through a center ring that forms the logo box, a strong radial hit at 3s, a kinetic wordmark reveal and a second shockwave on the logo. The first frame is nearly empty, so the open is not energetic, and the tagline is undersized and the end hold is fairly still.
- logo-sting-1: Moving from frame one: a stroke sweeps and bends while streaks fly past, the strokes wrap into the logo's rounded square, then a bright burst hit at 3s and a blur-in wordmark. The hit and lockup look much like A's, and the tagline is still too small to read well at video size.
- logo-sting-1: Energetic from frame one: strokes draw on, converge into the mark and burst at 3s with streaks, and the wordmark wipes in with the tagline. The build around 1.5-2.5s looks scribbly and tangled rather than designed, the tagline is very small, and the last second is close to a static end card.
- promo-1: More real motion design: a live click counter, a 3D-tilted screenshot that glides in next to the 'Your apps, on autopilot' headline, a camera that travels along a glowing path from benefit to benefit, and a Deploy-to-Live micro-interaction. The main problem is polish: at 8.5 s a black strip shows at the right edge beside the cut-off screenshot, text gets cropped mid-pan ('apps, utopilot', 'eps'), and 10.5 s is a near-empty frame.
- promo-1: More cinematic: a live click counter beside the kinetic type, the screenshot tilted in 3D next to a 'Your apps, on autopilot' headline, a glowing line that travels between the benefits, a Deploy-to-Live button beat, and a sparkle on the end card. Problems: a black strip shows at the right edge of the screenshot shot at 8.5 s, benefit text gets cut by the frame during the pans, and the end card holds mostly still for about 2 s.
- promo-2: Clean, complete story (Copy/Paste/Repeat, task-chip swarm, Meet Flowline, scrolling site, three numbered benefits on a connecting path, recap, end card) with no real mistakes. But the middle feels like a website demo: the screenshot sits flat and small in a box while it scrolls, the benefits play as centered one-per-scene cards, and the last 2 s hold an almost still end card.
- promo-2: Covers every required part in a clean ~18 s arc (Copy/Paste/Repeat kinetic type, busywork chips, screenshot, three numbered benefits joined by a line, logo end card). But the screenshot section is a flat, centered card that just scrolls (reads like a website demo), the busywork and end-card holds are near-static for 1.5-2 s, and the Repeat ghost echo plus the benefit text sliding off the left edge look a bit unpolished.
- ui-demo-1: Very readable: the camera zooms tight on the button, the per-person 'checking... free' panel and the three big slots, and the event lands with a confetti burst before a clean pull-back. But the bottom captions often cover UI (the 'Smart scheduling' panel title at 4.5s, 'checking...' at 5.0s, the first slot at 7.0s), there is no intro beat, and the booked shot sits nearly frozen from 12 to 13.5s.
- ui-demo-1: Zooms in tight and stays phone-readable: big button with a click ripple, a per-person 'checking... / free' panel that fills in live, three large slot cards, a highlighted pick, and a confetti landing in the week view, then a pull-back and a blurred end card. The step captions often sit on top of content (over the panel title at 4.5 s, Dev's row at 5 s, the first slot at 7 s, the Hiring panel at 12 s), and the opening wide shot and the booked shot both hold fairly static.
- ui-demo-2: Complete story with a kinetic title intro, a camera that pushes from the week view to the button, panel and slot, an event dragged into place, then a pull-back and an end card. But the suggestion panel stays fairly small and hard to read on a phone, the half-faded panel overlaps the day headers around 5.5s, and the booked shot and end card each hold almost still for about 2 s.
- ui-demo-2: Covers every step with a kinetic title intro, push-ins on the button and panel, a skeleton-loading panel, and an event card that visibly flies into its calendar slot before the camera pulls back to an end card. The suggestion panel and captions stay fairly small even when zoomed, so it is only borderline readable on a phone; the 5.5 s frame is a messy cross-fade where the panel's ghost text collides with the button and caption, and the booked shot holds nearly still for about 2 s.
- vertical-short-2: Energetic kinetic type with real motion moves (3D-tilted code card, film strip scrolling, scramble-decode on the brand name, giant </> push-in, blur transitions) and a punchy 'HTML IN. VIDEO OUT.' end lockup. It drops 'You can' from the opening line, and some transitions leave ghosted or overlapping text (doubled 'IN' at 7.5s, blurry 'VIDEO OUT' at 11.5s, near-empty frame at 7.0s).
- vertical-short-2: Energetic kinetic type with good graphic variety (REC viewfinder, tilted code card, scrolling filmstrip, decode-scramble on the brand name) and a clean HTML IN / VIDEO OUT payoff. Problems: the karaoke caption strip disappears after 7 s, the 7.5 s frame has a large ghosted duplicate 'IN' overlapping the headline, and most layouts sit in the top half leaving the lower half empty.
- vertical-short-1: Clean, well-ordered build: it keeps the full 'You can make this whole video' line, has a clear HTML-in, arrow, play-button, VIDEO-OUT diagram, moving frame cards with a counter, and a strong logo and CLI end card. The code editor text is too small to read, the HTML-in and end-card holds are fairly static, and a few transition frames are nearly empty (7.0s, 10.0s).
- vertical-short-1: Cohesive and polished: consistent type scale, a clear HTML IN -> play -> VIDEO OUT diagram that builds on screen, and a proper logo end card with the CLI command. Problems: the caption strip also drops out after 7 s, the code in the editor card is too small to read, and compositions are top-heavy with a lot of dead space below.
- year-recap-1: Bolder and livelier: the floating ambient shapes keep frames moving, the members scene tells the 96-to-214 growth story, a circle wipe leads into the end card, and the year flips from 2026 to 2027 with confetti. Some layouts are still a template of big number plus graphic, the members count holds still at 96 for about a second, and the brief 'See you in 2026' on the end card can read as a typo.
- year-recap-1: Lively and celebratory: drifting ambient shapes, numbered medals, a circle-wipe into the outro and a nice 'See you in 2026' to 2027 roll-over make it feel more like motion design. The member count sits frozen at 96 for about 1.5 s before counting, and several scenes still read as static stat cards with empty space.
- year-recap-2: Covers every stat with its own colorful scene, count-ups and simple shape illustrations (medals, route line, dot grid, sun and pin, bar chart), with wipe transitions between scenes. Each scene uses the same layout, number top-left and graphic right, with large empty areas (the km scene especially), and the 'See you in 2027' ending barely changes for about 3.5 s, so it reads more like animated slides.
- year-recap-2: Covers every stat with bold color-blocked scenes, counting numbers, a route line, a filling member grid and a Lisbon pin, joined by wipe transitions. Layouts crowd the top-left and leave big empty areas, and the ending holds almost still for about 2.5 s with confetti speckling the 2027.
