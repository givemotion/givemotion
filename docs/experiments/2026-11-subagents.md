# Plan with the strong model, build with cheap sub-agents? (2026-11-18)

**Question.** Research on test-time compute says a cheaper model looping against a checker can match a stronger
model when a machine can check the result, while work that needs taste is worth deeper thinking. Applied to
givemotion: should the skill tell the agent to plan the video itself (strongest model), hand each scene to a parallel
sub-agent on a cheaper, faster model (a render checks the code), then check the whole thing itself? The hope was
faster and cheaper videos at the same quality.

**Answer, for short videos (12-16 s, 3-4 scenes): no.** When the agent split the work, it cost 25-85% more, was
not faster, and blind judges preferred the single-agent video in 14 of 16 votes (4 comparisons × 4 judges). When the
guidance only *offered* the pattern, Opus read it and still built every video in one file, at the same cost as
without it. The skill now says: build it yourself, and use a sub-agent as the critic (which it already did).

One run per arm per brief, small briefs. Read the numbers as a clear direction, not a benchmark. Long videos (many
scenes, a minute or more) were not tested and may behave differently.

## How it was run

- **Makers.** Fresh headless Claude Code sessions, Opus 5.5 at effort high, each in its own folder with givemotion
  0.1.6 (packed from `main` at `a2b0298`), the skill pack, the fonts and the brief. Same prompt as the random-brief
  rounds, plus sub-agents allowed (the Agent tool, which can set a sub-agent's model). No web.
  Kit: `data/2026-11-subagents/harness/`.
- **Briefs** (written for this test, deliberately small): `x` Tidepool app teaser (12 s, 3 flowing beats), `y` Night
  Trains data story (14 s, 4 beats), `z` four sleep habits (16 s, 4 separate scenes with transitions), `w` Lumen desk
  lamp product film (16 s, 4 scenes, the same lamp in every scene).
- **Arms.**
  - A: the skill as it was.
  - B: the skill plus a "Bigger videos: plan once, build scenes in parallel (if your tool has sub-agents)" section,
    phrased as a suggestion, only for 3+ scenes, no model names, user instructions win
    (`data/2026-11-subagents/guidance/arm-B.md`; round 1 had an earlier wording).
  - F: arm B's skill, and the prompt asks for the pattern (as a user who wants it would).
  - G: like F, with guidance rewritten from F's judged faults: the main agent builds everything that spans scenes
    and every transition, scenes use only the shared colour variables and type classes, no empty frames at a cut,
    `snapshot --transitions` before rendering (`guidance/arm-G.md`).
- **Judges.** Four fresh Opus 5.5 sessions (effort medium) per comparison, two videos unlabeled as A and B, each
  video first for two judges. Each judge saw two contact sheets (40 frames), five 1-second motion strips and four
  key frames (`harness/pack.sh`, the same pack as the random-brief rounds), scored brief, spec, motion, craft,
  errors and overall 1-10, and named a winner. Judging cost $9.15 for 16 judges.
- **Cost** is the session's own `total_cost_usd` (main agent plus sub-agents). **Wall time** is start to finish on a
  4-core cloud machine with no GPU. Rounds 1-2 ran four makers at once, rounds 3-4 two, so F and G had *less*
  contention than A and B, and were still not faster.

## Results

Process numbers (one run each):

| brief | arm | cost | minutes | sub-agents |
|---|---|---|---|---|
| x Tidepool | A | $3.52 | 16.1 | critic |
| x Tidepool | B | $3.24 | 17.7 | critic |
| y Night Trains | A | $3.52 | 16.6 | critic |
| y Night Trains | B | $3.95 | 19.4 | critic |
| z sleep | A | $2.34 | 12.0 | critic |
| z sleep | B | $2.97 | 17.2 | critic |
| z sleep | F | $3.79 (Opus $2.94 + cheaper $0.85) | 14.9 | 4 scene builders + critic |
| z sleep | G | $3.32 (Opus $2.76 + cheaper $0.56) | 11.8 | 4 scene builders + critic |
| w lamp | A | $3.12 | 19.6 | critic |
| w lamp | B | $2.80 | 16.9 | critic |
| w lamp | F | $4.12 (Opus $3.53 + cheaper $0.59) | 21.1 | 4 scene builders + critic |
| w lamp | G | $5.44 (Opus $4.52 + cheaper $0.93) | 21.6 | 4 scene builders + critic |

Blind judging, overall score (mean of 4) and votes:

| comparison | single agent (A) | parallel builders | votes for A |
|---|---|---|---|
| z sleep, A vs F | **8.0** | 7.0 | 4 of 4 |
| w lamp, A vs F | **7.75** | 7.25 | 3 of 4 |
| z sleep, A vs G | **7.75** | 7.0 | 3 of 4 |
| w lamp, A vs G | **8.0** | 6.5 | 4 of 4 |

All twelve videos had the right size, frame rate and length.

## What happened

1. **Offered, the pattern was declined.** Arm B's four makers read the new section and built one file each, like A.
   Their reports call the piece "one continuous scene". The briefs asked for scenes that flow or share an object (the
   same lamp, the same icon disc), and on 12-16 s of video the agent judged one world to be the better build. Cost
   moved within run-to-run noise (B against A: -8%, +12%, +27%, -10%).
2. **Used, it cost more.** The cheaper builders were cheap ($0.56-0.93 for four scenes), but the Opus main agent did
   not get cheaper: $2.76-4.52, the price of a whole single-agent video. Almost all of a session's cost is the main
   agent re-reading its context on every turn (about 40 turns × about 110k tokens of docs and code), and planning,
   briefing builders, assembling and fixing seams took as many turns as building the video itself.
3. **Used, it looked worse at the seams.** The judges named the same faults each time: the lamp jumping from left to
   right and flipping between scenes (both F and G), empty stretches with no copy at the cuts, an off-palette blue,
   icons clipped mid-transition, smaller "template-like" layouts, weaker key-word choices. Arm G's guidance (the main
   agent owns shared elements and transitions) did not fix the lamp: the main agent still let scene 1 stage it
   differently. Consistency is taste, and splitting the work moved taste into the cheaper builders.
4. **The research rule still holds, applied the other way.** "Loop the cheap model when a machine can check it" assumes
   the checker decides quality. Here `check` and a render catch broken frames, but not whether four scenes look like one
   film. That needs judgment over the whole video, so the work stays with one strong agent.

## What changed

- `skills/givemotion/references/review.md`, new section "Sub-agents: the critic, not scene builders": build the whole
  video yourself in one file, even with several scenes, with the numbers above and why; the sub-agent that pays is the
  critic; if the user asks for parallel scene builders, the short recipe from arm G (shared `brand.css` and shot list
  first, the main agent builds everything that spans scenes and every transition, one scoped `scenes/<name>.html` per
  builder, `snapshot --transitions` on every cut).
- `skills/givemotion/SKILL.md`, step 3 of the loop: one sentence pointing there ("Build scenes yourself, not via
  sub-agents"). SKILL.md has a 15,000-byte budget (a unit test), so the detail lives in the reference.
- Confirmation round with the final text (arm H, normal prompt): see below.

## Confirmation round (final skill text)

{H}

## Not tested, worth testing

- Long videos (60 s+, 8+ separate scenes), where one agent's context fills up and scenes really are independent.
- A cheaper main agent (lower effort or a smaller model) for the whole job, against Opus high: the earlier effort
  showcase (`2026-11-efforts-showcase.md`) suggests quality drops with effort, but it was one run per level.
- The critic on a cheaper model ($0.14-0.37 of a run on Opus now).

## Raw data

`data/2026-11-subagents/`: the briefs, the guidance texts of arms B and G, the harness (`setup.sh`, `run-maker.sh`,
`judge.sh`, `pack.sh`, stats and scoring scripts), every maker's process numbers (`makers.txt`) and each comparison's
judge key and scores with the judges' notes (`judging/`). Transcripts and videos are kept locally.
