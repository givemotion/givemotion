# Round r6-hand: results

Engine: refs/heads/main @ 9af167e832. Runs set up 2026-10-24T11:30:18.470Z. 3 judge sheets. Scores 1-10, means over judges.

## Per video

| brief | video | group | brief | motion | craft | errors | overall | avg rank | #1 | length | render |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hand-drawn | baseline-hand-drawn-2 | baseline | 8.7 | 8.7 | 8.3 | 7.3 | 8.3 | 1.3 of 7 | 2 | 32 s | – |
| hand-drawn | baseline-hand-drawn-1 | baseline | 9.0 | 8.0 | 8.0 | 7.0 | 8.0 | 2.0 of 7 | 1 | 31 s | – |
| hand-drawn | other-hand-drawn-2 | other | 8.7 | 7.3 | 7.3 | 6.7 | 7.3 | 3.3 of 7 | 0 | 33.333 s | – |
| hand-drawn | hand-drawn-2 | r6-hand | 8.0 | 7.7 | 7.3 | 6.0 | 7.0 | 3.7 of 7 | 0 | 31 s | 32.66 s |
| hand-drawn | hand-drawn-3 | r6-hand | 8.0 | 6.3 | 7.0 | 6.3 | 6.3 | 4.7 of 7 | 0 | 32 s | 43.33 s |
| hand-drawn | hand-drawn-1 | r6-hand | 7.7 | 6.3 | 7.0 | 4.0 | 5.3 | 6.3 of 7 | 0 | 31 s | 38.57 s |
| hand-drawn | other-hand-drawn-1 | other | 7.3 | 5.7 | 5.3 | 4.3 | 5.0 | 6.7 of 7 | 0 | 34 s | – |

## Per group

| group | videos | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|---|
| baseline | 2 | 8.8 | 8.3 | 8.2 | 7.2 | 8.2 | 1.7 | 3 |
| other | 2 | 8.0 | 6.5 | 6.3 | 5.5 | 6.2 | 5.0 | 0 |
| r6-hand | 3 | 7.9 | 6.8 | 7.1 | 5.4 | 6.2 | 4.9 | 0 |

## Friction logs

11 engine, 6 docs, 4 agent entries.

- hand-drawn-1 [engine] Undrawn sketched shapes leave a dot on the canvas
- hand-drawn-1 [engine] gm.connect label shows at the frame's top-left when an end is not displayed yet
- hand-drawn-1 [engine] tiny-text warning during a camera move
- hand-drawn-1 [docs] Centering a label with a nested absolute span broke `write`
- hand-drawn-1 [engine] Wide fit shot pulled in empty space
- hand-drawn-1 [agent] Title shot too short
- hand-drawn-2 [engine] Shapes waiting for `data-enter="draw …"` show stray dots before they draw
- hand-drawn-2 [engine] Element references taken at script time to sketched shapes are stale
- hand-drawn-2 [docs] Regex shift of my own coordinates double-shifted `cy`/`ry` (agent)
- hand-drawn-2 [agent] My regex also rewrote the LED svg's viewBox
- hand-drawn-2 [engine] `fit: 'all'` frames the world box, not the drawing
- hand-drawn-2 [docs] Connect label cut at the frame edge is not flagged
- hand-drawn-2 [engine] Moving element covering a settled label is not reported
- hand-drawn-2 [docs] Laptop/server/globe drawn by hand from primitives
- hand-drawn-3 [engine] Undrawn sketched strokes show dots before they draw on
- hand-drawn-3 [engine] Highlight rect behind HTML text has to be placed by hand
- hand-drawn-3 [engine] `stroke="none"` sketched rect still gets an outline
- hand-drawn-3 [docs] Default snapshot moments miss the action in a one-scene camera video
- hand-drawn-3 [agent] Misread a drawing-in-progress frame as a camera bug
- hand-drawn-3 [agent] Labels collided with arrows
- hand-drawn-3 [docs] Overview size guidance helped, but the world still ends small

## Judges' notes

- baseline-hand-drawn-2: The most dynamic camera, with close framing that keeps the handwriting large and readable. Nice details too: highlighter on the IP, a GET tag on the arrow, a 'done!' check and a circled closing note. Main problem: odd stray stroke fragments during one move (around 14.5s), more accent colors than asked, and the globe doubles as DNS.
- baseline-hand-drawn-2: The best camera work: tight, readable close-ups of each step (typing, DNS globe with a highlighted IP, GET to the server, HTML back, the page drawing in with a 'done!' check), then a smooth pull-back to a clean, balanced full diagram with an '~100 ms' callout. Only minor edge cropping of the title while panning.
- baseline-hand-drawn-2: The camera stays close and follows each step with readable labels, a clear blue/orange/yellow-highlight palette, a satisfying 'done' check and a clean final overview. A few transit frames are almost empty (8-8.5s, 14.5s), and the overview text is very small.
- baseline-hand-drawn-1: Covers every step with clear numbered labels and a full cast of sketched objects (laptop, DNS circle, globe, server, browser window). The camera moves smoothly across one canvas and ends on a coherent full pull-back. Main problem: the final overview is crowded and its labels get very small, and the handwritten title sweeps off and back a little awkwardly.
- baseline-hand-drawn-1: Charming hand-drawn style (DNS circle with a red scribble, 'enter' note, envelope, 'Hello, web!' page with a sign-up button) and a rich final diagram. The title is cut off at the top through 9-13.5 s, there are a few abrupt camera jumps (around 16.5-17 s), and the page is drawn as a separate window.
- baseline-hand-drawn-1: Lively, hand-drawn feel (accent ring round the DNS circle, 'enter' scribbles, 'Hello, web!' page) with a camera that keeps travelling along the flow and a full pull-back at the end. The title is often cropped at the top during pans, and the overview labels are very small.
- other-hand-drawn-2: The richest content: a DNS database with a 'phone book' note, an internet globe, a server, a travelling envelope and HTML document, and a full pull-back with a timing note. Main problem: much of the middle plays in wide shots where labels are too small to read, which flattens the camera work.
- other-hand-drawn-2: A rich, well-paced canvas: the URL is typed, the DNS cylinder has a phone-book note, an envelope travels to the server, the HTML comes back and the page draws, then a clean pull-back with an '~100 ms' callout. Small issues: the title and labels are cut at the frame edge during several pans (12-14.5 s, 20-25 s).
- other-hand-drawn-2: Rich diagram (DNS cylinder, phone-book note, internet globe, an envelope travelling to the server, '~100ms' callout) with real camera travel and a full pull-back. The wide stretches make the labels tiny, and the title is cropped at the left edge during several holds.
- hand-drawn-2: Bold, readable close-ups and good flow: arrows draw on, the HTML file travels along the arc, and the page is drawn back in the laptop. Main problem: during the server and HTML section the server and '3.' labels sit cut off at the right edge, and the bottom label is clipped at 22s.
- hand-drawn-2: Nice sketchy details (DNS 'internet's phone book' card, circled IP, orange HTML arc, a check mark) and decent travel between parts. Some frames are sparse (13.5-15.5 s show little more than a globe), arrows and labels are cut at the frame edges around 18.5-22 s, and the final overview is small.
- hand-drawn-2: Bold, large drawings and confident camera moves; the big orange return arc carrying the HTML file reads well. Some frames are nearly empty mid-move (13.5-15.5s), and the final overview is a bit scattered with tiny labels.
- hand-drawn-3: Clean, consistent sketch style and a solid final overview with a circled '<100ms' scribble. Main problem: from about 9s to 18s it stays on a wide, almost static view where the text is tiny, so it feels less like a moving camera. The globe is used as DNS, so there is no separate internet.
- hand-drawn-3: A clean, complete diagram with good accents and a tidy final overview with a circled '~100 ms' note. The camera sits wide and almost still from about 9 to 18.5 s, so the middle reads as small, static diagram-building rather than moving between close-ups.
- hand-drawn-3: All five steps are drawn on one canvas, the browser page gets a nice zoom-in and the end pulls back to the whole diagram. But from 9-18s it sits in a near-static wide shot where the globe, server and labels are tiny and hard to read, and there is a lot of empty paper.
- hand-drawn-1: Good sketch look and a nice 'phone book of the web' close-up. Main problem: at 21-21.5s the camera snaps far out to a tiny diagram that is close to an empty frame, which reads as a glitch. The browser for step 5 is also drawn off to the side rather than flowing from the diagram.
- hand-drawn-1: Strong close-ups (hatched globe for DNS, phone-book card with a highlighted IP) and a clear final overview. A broken camera move at 21.0-21.5 s zooms out to a tiny, nearly empty frame, and the browser page is redrawn as a separate window instead of on the laptop.
- hand-drawn-1: Good sketch style and a large, readable DNS phone-book close-up. A clear glitch at 21-21.5s, where the camera zooms far out to a tiny diagram on an almost empty frame, breaks the flow, and the wide shots have tiny text.
- other-hand-drawn-1: Complete content with a nice return to the laptop for step 5 and a closing '<100ms' note. Main problem: there is a blank canvas for about a second after the title, the labels are tiny in the wide shots, and step labels and the server are cut by the frame edge for several seconds (22-26s).
- other-hand-drawn-1: Covers every step with a laptop, DNS table, globe, server and request/response arcs, and ends on a full pull-back. But there are near-empty frames around 3.0-3.5 s, the long middle stretch (16-26 s) is framed so loosely that the title and side elements keep getting cut by the frame edge, and the final diagram is cramped with tiny, hard-to-read labels.
- other-hand-drawn-1: Every step is there, with a decent close-up of the browser drawing the page near the end. Most of the video is a faint, far-away wide shot with tiny, hard-to-read elements and lots of empty space, and there are blank frames at 3-3.5s.
