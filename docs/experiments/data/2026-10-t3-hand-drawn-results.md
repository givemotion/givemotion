# Round r5-hand: results

Engine: refs/heads/main @ a54e9b675e. Runs set up 2026-10-24T11:00:28.989Z. 3 judge sheets. Scores 1-10, means over judges.

## Per video

| brief | video | group | brief | motion | craft | errors | overall | avg rank | #1 | length | render |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hand-drawn | baseline-hand-drawn-2 | baseline | 8.3 | 8.0 | 8.0 | 7.0 | 8.0 | 1.0 of 6 | 3 | 32 s | – |
| hand-drawn | other-hand-drawn-2 | other | 9.0 | 7.7 | 7.3 | 6.3 | 7.3 | 2.7 of 6 | 0 | 33.333 s | 66.35 s |
| hand-drawn | baseline-hand-drawn-1 | baseline | 8.3 | 7.3 | 6.7 | 6.3 | 7.0 | 3.3 of 6 | 0 | 31 s | – |
| hand-drawn | hand-drawn-2 | r5-hand | 8.3 | 7.0 | 6.7 | 6.7 | 7.0 | 4.3 of 6 | 0 | 33 s | 47.41 s |
| hand-drawn | hand-drawn-1 | r5-hand | 7.7 | 7.3 | 7.0 | 6.7 | 6.7 | 3.7 of 6 | 0 | 32 s | 33.28 s |
| hand-drawn | other-hand-drawn-1 | other | 7.3 | 6.3 | 5.7 | 5.0 | 5.3 | 6.0 of 6 | 0 | 34 s | 66.96 s |

## Per group

| group | videos | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|---|
| baseline | 2 | 8.3 | 7.7 | 7.3 | 6.7 | 7.5 | 2.2 | 3 |
| other | 2 | 8.2 | 7.0 | 6.5 | 5.7 | 6.3 | 4.3 | 0 |
| r5-hand | 2 | 8.0 | 7.2 | 6.8 | 6.7 | 6.8 | 4.0 | 0 |

## Friction logs

15 engine, 8 docs, 5 agent entries.

- hand-drawn-1 [engine] Solid sketch fill is visible before its draw-on
- hand-drawn-1 [engine] `fit: '#world'` does nothing
- hand-drawn-1 [docs] Sketch draw runs the passes one after another
- hand-drawn-1 [engine] Hand-drawn arrows that a packet can travel along
- hand-drawn-1 [docs] mw.connect curve sign and path access unclear
- hand-drawn-1 [docs] Which clock do `mw.path.travel` stops use?
- hand-drawn-1 [docs] Typing caret stays forever
- hand-drawn-1 [engine] check flags a label during a camera pan
- hand-drawn-1 [agent] First camera plan was too wide
- hand-drawn-1 [engine] Render speed
- hand-drawn-2 [engine] Solid sketch fills ignore the draw delay
- hand-drawn-2 [engine] low-contrast false positive on a half-cropped badge
- hand-drawn-2 [engine] Small camera float creates new edge warnings
- hand-drawn-2 [docs] mw.connect start/end points and curve direction are not explained
- hand-drawn-2 [agent] Labels placed by guess collided with arrows
- hand-drawn-2 [engine] Re-render reuses nothing and gets slower
- hand-drawn-2 [docs] Anchors for camera/arrows on SVG shapes
- other-hand-drawn-1 [engine] Google font fails to load at render time
- other-hand-drawn-1 [engine] No sketch / draw-on primitive for multi-subpath paths
- other-hand-drawn-1 [engine] No camera / big-canvas primitive
- other-hand-drawn-1 [agent] Layout collisions on the first pass
- other-hand-drawn-1 [agent] Cursor position estimated by char width
- other-hand-drawn-1 [docs] Pulling frames for review is slow
- other-hand-drawn-2 [engine] Google Fonts loader times out in render
- other-hand-drawn-2 [engine] No sketch / hand-drawn primitives
- other-hand-drawn-2 [engine] No camera over a big canvas
- other-hand-drawn-2 [agent] Labels overlapping arrows
- other-hand-drawn-2 [docs] Text write-on with anchor middle/end

## Judges' notes

- baseline-hand-drawn-2: The strongest drawing: bold hatched globe, highlighted IP, colour-coded request/response arrows, a big close-up of the page drawing itself, a 'done!' tick, and a tidy, readable final pull-back with a closing scribble. The globe stands in for DNS, so there is no separate internet globe, and some labels get cut by the frame edge during pans.
- baseline-hand-drawn-2: The cleanest of the set: blue hatched globe, yellow highlight on the IP, the page renders inside the laptop with a green 'done!' check, then a clear pull-back with a '~100 milliseconds' callout. The title is cut at the top of frame during the DNS section, and the overview labels are small.
- baseline-hand-drawn-2: The boldest, most readable ink. Close-ups like the laptop drawing its page with a 'done!' check feel like real motion design, and the camera travels with energy before the final pull-back. It uses more accent colors than the brief's one or two (blue, orange, yellow, green), DNS is again drawn as a globe, and some pan frames are heavily cropped (8-8.5 s, 14.5 s).
- other-hand-drawn-2: The richest storytelling: DNS drawn as a database with a 'phone book' note, a separate internet globe, a travelling envelope and document, the page popping in the laptop with burst lines, and a '~100 ms' closer. The final overview is dense with very small text, and several mid-pan frames crop labels and shapes awkwardly.
- other-hand-drawn-2: Nice explanatory touches (a DNS cylinder with a 'phone book of the internet' note, an envelope travelling to the server, a page that draws itself) and a full pull-back at the end. Most labels are very small, and the camera often leaves elements half off frame between steps.
- other-hand-drawn-2: Strong storytelling: the 'phone book of the internet' sticky note, the return trip to the laptop to draw the page, and a circled 'all of this in ~100 ms' payoff in the final overview. The title and some labels clip at the top edge during pans, and most text in the overview is tiny.
- baseline-hand-drawn-1: All five steps on one canvas with self-drawing arrows, a typed URL, a highlighted DNS answer and a pull-back at the end. The final overview is crowded: tiny labels, arrows crossing, and the rendered page sits in a separate window below instead of in the laptop, so the diagram reads as busy.
- baseline-hand-drawn-1: Rich content: a bold circled DNS node with a lookup table and highlighted IP, an internet globe, a server sending an HTML doc and a page that draws itself, all kept on the canvas for the final pull-back. The title and labels sit half cut off at the top edge for long stretches, and the final overview is crowded with very small text.
- baseline-hand-drawn-1: Covers all five steps on one canvas, with arrows and shapes that draw on, a red-ringed DNS circle, a separate browser window for the render step, and a clean final pull-back. Labels get small and thin in the mid shots and the final overview, and a few labels are cut at the frame edge during camera moves (around 8.5 s and 22.5 s).
- hand-drawn-2: A clean flow on one canvas: the camera follows the request out and back, and the page draws itself inside the laptop with a nice payoff. Strokes are thin and labels small, so mid-shots and the final overview read weakly, and the sketch feel is a bit too light and uniform.
- hand-drawn-2: Solid, complete flow: DNS circle and lookup box, internet globe, server, an HTML doc with a '200 OK' arrow and the page rendering in the laptop, then a full overview. Many mid shots cut step labels at the top edge, and the final layout is evenly spread out but small and plain, with little hierarchy.
- hand-drawn-2: Solid, readable sketch diagram with a believable laptop, DNS lookup, globe, server and HTML doc, and a full pull-back at the end. It feels generic next to the others: thin, low-contrast ink, a weak closing beat, labels clipped at the edges during moves (e.g. 24.5 s), and a static last two seconds.
- hand-drawn-1: A clear, well-paced camera journey (an envelope travels, the page builds in a close-up) ending in a clean overview with the circled '~100 ms' note, in restrained blue and orange accents. Shapes are rather plain (a bare server, the globe used as DNS), and labels briefly overlap near the globe around 16 s.
- hand-drawn-1: Covers all five steps on one canvas: the laptop's page draws itself, arrows are color-coded and the closing pull-back with an '~100 ms' scribble is tidy. DNS is shown only as a globe, which is a weak metaphor. Labels and the server get cut by the frame edge during camera moves, and the final overview text is tiny.
- hand-drawn-1: Clean, consistent style and a nice circled '100 ms' ending. DNS is drawn as a globe, so it reads as 'the internet' rather than a name lookup. Labels like '4. here's the HTML' are cut at the frame edge during several camera moves, and the server sits pressed against the right edge in the overview.
- other-hand-drawn-1: Covers every step, has nice big request/response arcs and draws the page in the laptop. The frame goes empty just after the title, much of the middle is shot so wide that labels are unreadable, and the final overview is the most cramped and hard to read.
- other-hand-drawn-1: Complete diagram with DNS table, internet globe, curved request and response arcs, an HTML doc and a clock callout, plus a good page-draw close-up. The ink is faint and the text tiny in the wide shots, frames around 3 s are nearly empty, and many mid shots crop labels at the top edge.
- other-hand-drawn-1: Good opening, with the URL typing, a circled 'Enter!' and a DNS table, and all the steps are present. From about 16 s to 26 s the camera stays far out, so the labels are tiny and unreadable, the server and its label are cut by the right edge, and the final overview is sparse with very small text.
