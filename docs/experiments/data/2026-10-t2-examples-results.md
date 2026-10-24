# Round t2-examples: results

Engine: refs/heads/main @ 4a45b682f1. Runs set up 2026-10-24T10:29:00.914Z. 9 judge sheets. Scores 1-10, means over judges.

## Per video

| brief | video | group | brief | motion | craft | errors | overall | avg rank | #1 | length | render |
|---|---|---|---|---|---|---|---|---|---|---|---|
| code-explainer | new-code-explainer | new | 8.3 | 7.7 | 7.3 | 6.7 | 7.7 | 1.0 of 2 | 3 | 16 s | 22.21 s |
| code-explainer | old-code-explainer | old | 5.0 | 4.0 | 5.3 | 5.7 | 4.0 | 2.0 of 2 | 0 | 14.5 s | 14.29 s |
| data-story | new-data-story | new | 8.7 | 8.0 | 7.7 | 7.3 | 8.0 | 1.0 of 2 | 3 | 15.4 s | 21.11 s |
| data-story | old-data-story | old | 5.3 | 3.7 | 5.0 | 5.3 | 4.0 | 2.0 of 2 | 0 | 15.1 s | 15.39 s |
| vertical-short | new-vertical-short | new | 8.7 | 8.0 | 8.0 | 7.0 | 8.0 | 1.0 of 2 | 3 | 11 s | 20.43 s |
| vertical-short | old-vertical-short | old | 4.0 | 3.0 | 4.0 | 3.3 | 3.0 | 2.0 of 2 | 0 | 11 s | 13.38 s |

## Per group

| group | videos | brief | motion | craft | errors | overall | avg rank | #1 picks |
|---|---|---|---|---|---|---|---|---|
| new | 3 | 8.6 | 7.9 | 7.7 | 7.0 | 7.9 | 1.0 | 9 |
| old | 3 | 4.8 | 3.6 | 4.8 | 4.8 | 3.7 | 2.0 | 0 |

## Friction logs

0 engine, 0 docs, 0 agent entries.


## Judges' notes

- new-code-explainer: Strong arc: typed code, a real camera push into the sleep/back-off line with a label, then an animated retry timeline (tries failing, delays growing, final 200 OK) and an annotated summary, so it explains instead of just showing. Problems: the code is tiny for most of the video, the zoom crops code at the frame edges, and the '6 lines' claim doesn't match the roughly nine lines on screen (the counter even passes through '3 lines').
- new-code-explainer: Strong arc: title with a counting '6', typed code, a camera push into the back-off line with a label, then a live retry timeline (try 1-3 fail with 503, wait grows 250/500/1000 ms, try 4 succeeds) and an annotated recap; it actually explains the helper visually. Main problems: code is tiny and hard to read at full view, the zoom crops the code edges hard, and the '6 lines' claim sits over a visibly longer function (and the counter flashes '3 lines' at 13s).
- new-code-explainer: Real motion design: a kinetic title with a counting '6', the code typing in, a camera push onto the sleep/back-off line, an animated retry timeline (fails, growing waits, 200 OK), and a recap with annotations drawn in. Main problems: the code and recap labels are small in the wide shots, the zoom and transition frames crop the code at the edges, and there is a brief '3 lines' count-up flash.
- old-code-explainer: Clean dark look and a nice title reveal, and the back-off comment gets a callout. But most of the video is slow typing of small code with no zoom or camera move. The only visual is a checklist that ends in about two seconds of static frames, and the highlight ring sits on top of the comment text it points at.
- old-code-explainer: Clean dark styling and a tidy title, with the code typed on and one 'Exponential back-off' callout. But it is mostly slides: about 6 seconds of slow typing on a static, tiny code window with no zoom, a single highlight whose ring sits on top of the comment text, then a plain checklist that holds frozen for the last ~2.5 seconds.
- old-code-explainer: Clean dark look, and the code typing on screen works, with one yellow 'Exponential back-off' callout. But there is no zoom and no real visual for the retry idea, the code is tiny inside a wide empty frame, and the video ends on a sparse checklist that sits frozen for about 2.5 s (title also holds still for ~1.5 s).
- new-data-story: Strong data-story motion: a line chart drawn by a camera that follows the leading point while a counter ticks up, then pulls back to reveal the full year, a 3.9x callout, bars with an animated +153% arrow, and an NPS gauge with a particle burst. Main problems: axis labels and captions are tiny, the transition around 8.0s is an almost empty blurred frame, and the final gauge holds still for about 2 seconds.
- new-data-story: Real data-story motion: the camera follows the line chart as the user counter ticks up to 4,720, then pulls back to the full chart, a 3.9x callout lands, the bars get a +153% arc highlight, and a gauge sweeps to 72 with a particle burst, all joined by blur transitions. Weak spots are the tiny axis and label text, a near-empty transition frame at 8.0s, and short holds at 10.5-11.5s and 13.5-15s.
- new-data-story: Strong data story: the line chart draws with a camera that follows the leading point while the counter ticks up, then pulls back to show the whole year and lands a 3.9x callout, followed by quarterly bars with a +153% arrow and an NPS gauge with a particle burst. Main problems: the bar and gauge scenes sit nearly still for 1.5-2 s each, axis labels are tiny, and the 8.0 s transition frame is almost empty with a blurred fragment.
- old-data-story: Clean, readable layout with a decent area-chart draw-on and a 'best ever' tag on the NPS. Main problem: it plays like slides with long frozen stretches (title 1-2.5s, revenue bars 8-11.5s, NPS 12.5-15s), the data is thin (four weeks, two quarters) rather than a year of growth, and the flat bars and small captions feel unfinished.
- old-data-story: Clean dark palette with a line chart that draws on and an NPS counter, but it hardly tells a year-long story: W1-W4 weekly users peaking at 20, only two revenue bars, and the charts sit small in big empty frames. Long frozen stretches (title 1.5-2.5s, bars 8.5-11s, NPS 13-15s) make it feel like slides, and a leftover caption hangs at the top edge at 7.5s.
- old-data-story: Clean, coherent dark look and readable headline numbers, with an area chart that draws in and an NPS counter. But it plays like a slide deck: a 4-point chart, only two revenue bars frozen for about 3.5 s, an NPS scene that barely changes from 48 to 50 and then holds, tiny labels in big empty frames, and stray cut-off text at the top of the 7.5 s transition.
- new-vertical-short: Strong kinetic type that builds word by word, with a scene change on almost every line (REC frame, file icon burst, code editor, frame-counter filmstrip, HTML IN / VIDEO OUT, logo end card) and synced captions that stay in the safe zone. Main problems: a few transition frames are blurry or half-drawn (7.0s HTML IN / VIDEO OUT), the end card holds for about 1.5 s, and the top and bottom of the frame are mostly empty.
- new-vertical-short: Covers the whole script with big kinetic type built word by word, beat-cut scenes (file icon burst, typing code, scrolling frame strip with counter, HTML IN -> VIDEO OUT) and an end card, all kept in a safe central column. Main problems: the burst lines cross the 'ONE FILE.' headline at 2.5s, the big type often repeats the caption right under it, and the last ~1.5s is a mostly static logo card.
- new-vertical-short: Real kinetic type that builds line by line, plus a file icon with a burst, a typing editor, a scrolling frame strip with a counter, an 'HTML IN -> VIDEO OUT' beat and a clean end card, with clear scene changes and a consistent lime/purple palette. Small flaws: the burst rays cross the 'ONE FILE.' headline at 2.5 s, the 7.0 s transition frame smears into half-drawn text, and the frame strip is cut at both edges.
- old-vertical-short: Captions are synced and highlighted, and the typing code card is a nice touch. But there is almost no big kinetic type: the first 2 s are an empty gradient with a tiny caption, 'HTML in, video out' never appears, and the last 3+ s are a static clapper emoji with no text. It also has a placeholder '@yourchannel' handle and small captions, so it reads as mostly empty frames.
- old-vertical-short: Clean karaoke-style captions and a typing code card are the only real ideas; the first frame is empty and the 'BY HAND' flash is off-script. Big kinetic type is nearly absent, 'HTML in, video out' never appears, a static clapper emoji sits frozen for 4.5s (8-10.5s with no caption at all), and a placeholder '@yourchannel' handle sits in the top unsafe zone.
- old-vertical-short: Word-by-word captions with a highlight and a typing code card follow the voice-over, and the background color shifts per section. But the type is small and timid, not big kinetic type; the first frame is empty, an unexplained 'BY HAND' flashes once, 'HTML in, video out' never appears, and the last 2.5 s is a frozen clapper emoji on an empty gradient.
