# Round r7-hand: results

Engine: refs/heads/main @ 76ddbe95b9. Runs set up 2026-10-24T12:16:37.105Z. 3 judge sheets. Scores 1-10, means over judges.

## Per video

| brief | video | group | brief | motion | craft | errors | overall | avg rank | #1 | length | render |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hand-drawn | hand-drawn-2 | r7-hand | 9.0 | 8.0 | 8.0 | 7.7 | 8.0 | 1.7 of 5 | 1 | 30 s | 29.18 s |
| hand-drawn | hand-drawn-3 | r7-hand | 8.7 | 7.7 | 7.7 | 7.7 | 7.7 | 1.3 of 5 | 2 | 31 s | 27.05 s |
| hand-drawn | hand-drawn-1 | r7-hand | 8.0 | 7.0 | 7.0 | 6.7 | 7.0 | 3.7 of 5 | 0 | 31 s | 25.85 s |
| hand-drawn | baseline-1 | baseline | 8.0 | 7.3 | 6.3 | 6.7 | 6.7 | 4.0 of 5 | 0 | 31 s | – |
| hand-drawn | baseline-2 | baseline | 7.0 | 7.3 | 7.0 | 7.0 | 6.7 | 4.3 of 5 | 0 | 32 s | – |

## Per group

| group | videos | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|---|
| r7-hand | 3 | 8.6 | 7.6 | 7.6 | 7.3 | 7.6 | 2.2 | 3 |
| baseline | 2 | 7.5 | 7.3 | 6.7 | 6.8 | 6.7 | 4.2 | 0 |

## Friction logs

10 engine, 10 docs, 4 agent entries.

- hand-drawn-1 [engine] Labels must be positioned by hand, separately from the shapes they describe
- hand-drawn-1 [engine] mw.connect label overlaps the target box; check is silent
- hand-drawn-1 [engine] Can't mark an engine-generated connect label as crop-ok
- hand-drawn-1 [docs] Arrow attaches oddly to a `<g>` whose bbox is larger than the visual target
- hand-drawn-1 [docs] Curve sign for right-to-left arrows
- hand-drawn-1 [engine] Sketch circle mark on a one-character span touches the next word
- hand-drawn-1 [docs] Motion strip blank cells
- hand-drawn-1 [agent] Misread a contact-sheet thumbnail as an off-center camera
- hand-drawn-1 [agent] First frame blank
- hand-drawn-2 [engine] mw.connect label is serif, not handwritten
- hand-drawn-2 [engine] mw.connect label is placed on top of other shapes
- hand-drawn-2 [engine] check misses lines crossing text
- hand-drawn-2 [docs] No way to know where an auto-routed arrow goes
- hand-drawn-2 [docs] text-offscreen for neighbouring labels in a camera world
- hand-drawn-2 [engine] camera follow sits off-centre on a moving element
- hand-drawn-2 [docs] sketch-mark circle overlaps neighbouring words
- hand-drawn-2 [agent] grep exit code made a command look failed
- hand-drawn-2 [docs] small: changing one CSS value re-renders everything
- hand-drawn-3 [engine] mw.connect label is not hand-drawn style
- hand-drawn-3 [engine] No warning when a label collides with drawn strokes
- hand-drawn-3 [docs] Several text-offscreen warnings for labels cut by neighbouring parts of the world
- hand-drawn-3 [docs] Unclear whether data-camera and mw.camera combine
- hand-drawn-3 [docs] Unclear whether write / sketch marks work on SVG text
- hand-drawn-3 [agent] Empty first frame

## Judges' notes

- hand-drawn-2: The strongest: bold, confident ink, bold camera moves (a big push into the laptop as the page draws: image, lines, button, circled 'the page'), and a balanced final overview that fills the frame with all five numbered steps and '200 OK + HTML' on the return arc. Small issues: the step-4 label sits tight against the right edge, and the title is cropped during the first move.
- hand-drawn-2: Good camera variety: it pushes in close on the typing, then pans across the DNS cylinder, globe and server. The two accent colors are disciplined, '200 OK + HTML' and a circled 'the page' add detail, and the final overview is readable. Right-edge labels ('server sends back HTML') sit tight against or are clipped by the frame, and the last ~3 s are a static hold.
- hand-drawn-2: Covers all five steps on one canvas: a DNS cylinder, a globe, a server rack and an HTML doc, with arrows that draw on and a camera that follows them, then a clean pull-back to an overview that fills the frame. The page drawing itself inside the zoomed laptop is the highlight. The overview labels are tiny, and labels get clipped at the frame edge during pans.
- hand-drawn-3: Clean and complete: every step draws itself on, the camera moves steadily across one canvas, the HTML goes back along an orange arc, the page renders inside the laptop, and it ends on a pull-back with an 'all in ~100 ms' note. The final overview sits high in the frame and leaves the bottom third empty, and labels get cut at the frame edge in several in-between frames (11-12 s, 16-18 s).
- hand-drawn-3: The strongest sketch look: hatched fills, a clear numbered step flow, an envelope that travels the arrows, the page drawing itself back on the laptop, and a tidy pullback with an 'all in ~100 ms!' scribble. The palette goes a bit past two accents (blue, green, orange, yellow), and the closing wide shot sits mostly still.
- hand-drawn-3: A strong flow from scene to scene: a GET envelope rides the request line, an HTML doc comes back on an orange arc, the page draws inside the zoomed laptop, and the final overview gets an 'all in ~100 ms!' punchline. It uses a few more accent colors than the brief asks for (blue, green, orange, yellow), and the edges are cramped during the pull-back.
- hand-drawn-1: Complete story with circled step numbers, a GET/HTML round trip between globe and server, and a separate 'Example Domain' page window that stays in the final diagram. The step-number circles overlap the start of their labels ('1 you', '5 the'), and the final overview is cramped and small in the middle of the frame.
- hand-drawn-1: A complete and well-ordered diagram with circled step numbers, a curved orange HTML return arrow, and a final pullback with a summary note. Several transition frames are near-empty or crop labels at the edge (21.5 s, 27.5 s), and the final layout is cramped toward the top-right.
- hand-drawn-1: Clear, well-paced story with numbered circle labels and an HTML tag travelling along the return arc, ending on a tidy overview. DNS is a plain box rather than a sketched shape, so it has less shape variety. The overview is dense, and the right-hand labels and the server are close to the frame edge.
- baseline-1: Nice idea to pull back to the whole map halfway through and then dive in again, and there are good scribble touches (the circled title, the 'enter' note). The final overview is crowded with tiny, hard-to-read labels, and many framings crop text and drawings at the edges (8.5 s, 17.5-22 s).
- baseline-1: Covers every step on one canvas: a laptop with typing, a DNS circle that resolves to a highlighted IP, a globe, a server, an HTML doc, then a pullback. The thin, light linework and tiny labels make the final overview cluttered and hard to read, and the page is drawn in a separate floating window rather than on the laptop.
- baseline-1: Lots of motion: the URL is typed with an 'enter' note, the DNS circle gets a red scribble, an envelope travels, and the page is drawn with a 'Hello, web!' card and a Sign up button. The final overview is sprawling and less tidy: the rendered page sits apart from the laptop and many labels are tiny and crowded.
- baseline-2: Good sketch feel with a pleasant page build and a 'done!' check, then a wide pull-back with a circled '~100 milliseconds' note. Using the globe for DNS leaves no internet node, which muddles the diagram; there are stray half-drawn corner marks (14.5 s, 25.5 s) and the final labels are very small.
- baseline-2: The camera moves smoothly, the page draw-on is nice (image, lines, a 'done!' check), and the ending is circled for emphasis. The globe is used as the DNS (there is no separate DNS or internet shape), some mid-pan frames are almost empty (around 8 s), and the final diagram is small and left-heavy.
- baseline-2: Smooth camera work, a detailed page drawing in the laptop, and a nice 'done!' check plus an 'all in ~100 ms' circled note at the end. DNS is drawn as a globe and there is no separate internet globe, which muddles the diagram; some frames mid-pan are nearly empty, and the server touches the right edge during the pull-back.
