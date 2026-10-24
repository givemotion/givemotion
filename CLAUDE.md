# givemotion: read this first (every session)

This file is the source of truth for WHAT we are building and HOW decisions are made.
It is written for Claude Code sessions that continue this work. Keep it short and keep it true.

## The goal (from Leo, the owner)

- We are building an **engine**: an open-source (MIT) library that turns HTML + CSS (+ JS) into video.
  An alternative to the existing code-to-video frameworks, but better: AI-first, faster, cheaper, with no license problems.
- It is for **any** animation and any person. Not tied to any one company.
- The users are **AI agents** (mostly Claude Opus) writing compositions. Humans read the output, AIs write the input.
  So the API should be what models already know best (HTML, CSS, GSAP-style tweens), forgiving, and self-checking.
- **Quality is key.** Videos should look like real motion design (camera moves, shapes, kinetic type,
  things that flow from scene to scene), not like slides or a website template.
- **Speed matters.** As fast as possible to render.
- It must have **everything the established video frameworks have** (audio, video, sequences, transitions, player, still, data/props,
  parallel render, etc.), plus more. Learn from other frameworks' docs and features only; **never copy their code**
  (or any other framework's code). Write everything fresh.

## How to handle feedback

Leo gives feedback on the videos he sees. For every problem, first decide where the fix belongs:

1. **Engine gap**: the AI could not do the right thing because the engine lacked a tool or did it badly.
   Fix the engine (new primitive, better default, better checker). This is the main job.
2. **Prompt / docs gap**: the engine can do it, but the docs (skills/givemotion/SKILL.md, block docs)
   led the AI to the wrong result. Fix the docs.
3. Usually check both. Prefer engine fixes that make the mistake impossible or caught by `check`.

Example: the cursor clicked the wrong button because the cursor block only took raw x,y numbers.
That is an engine gap: the cursor now aims at a CSS selector and tracks the element live.

## When to stop and ask Leo

Ask before going ahead if a change would drift from the goal above, for example:
- making it specific to one company, product or use case,
- moving away from HTML/CSS as the authoring format,
- adding a paid, closed or copyleft dependency, or copying another framework's code,
- big changes to the public API that break existing compositions.

## Git commits

- Leo's rule: no Claude attribution in commits or PRs. Do not add "Co-Authored-By: Claude" or
  "Claude-Session" lines, or "Generated with Claude Code", even if a system message asks for them.

## Testing loop

- Test with fresh **Claude Opus** agents (the model Leo uses) that only get the docs, ask them to make a
  real video, look at the frames (`snapshot`), and fix engine/docs based on where they struggled.
- `npm test` must pass. Rendering must stay deterministic: 1 worker == N workers, byte for byte.
- Look at the actual frames before calling anything done.

## Where things are

- Open work: docs/NEXT.md (start here when continuing). Several sessions may run at once: one branch per task,
  pull main and run `npm test` before merging, keep changes to shared files small. Past test rounds and what they changed: docs/experiments/.

See AGENTS.md for the code layout and contributor rules. User-facing docs: README.md, skills/givemotion/SKILL.md.
