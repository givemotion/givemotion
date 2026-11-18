## Bigger videos: plan once, build scenes in parallel (if your tool has sub-agents)

A suggestion, not a rule: if the user asks for another way of working, do that.

**When it pays:** the video splits into 3+ separate scenes joined by transitions, each one a section you could build on its own. **When it doesn't:** 1-2 scenes, or one continuous world with a camera, where every beat grows out of the last: do that yourself in one file. Every sub-agent re-reads the docs, so on small work it costs more than it saves.

When it pays, and you can start sub-agents (and choose their model):
1. **Plan yourself, with your strongest model.** Steps 0-1 of the loop: direction, shot list, one style frame. Write the shared pieces first: `brand.css` (palette as CSS variables, fonts, type classes, the layout grid) and `plan.md` (each scene's start and length, what is on screen, the easing). **Anything that lives in more than one scene** (a product, a logo, a frame, a background) you build in `video.html` yourself; scenes add only what is theirs. **You own the hand-overs:** the transitions live in `video.html`, and `plan.md` says what is on screen at each cut, with exact positions.
2. **Build in parallel with a cheaper, faster model.** Start one sub-agent per scene in one go, each writing `scenes/<name>.html` (one `<section class="scene">`, assembled with `<gm-include ... scope>`, `references/data-templates.md`). Tell each: read SKILL.md, `brand.css` and `plan.md`; build only its scene; colours only from the variables, sizes only from the type classes; something on screen for its whole length (no empty start or end); `check` it and `still` its key moments until clean; reply in a few lines.
3. **Check yourself.** Assemble, `check`, `snapshot --transitions`, `review`: do the scenes read as one video (same sizes, colours, motion speed, nothing jumping at a cut, no empty frames)? Fix the seams yourself, then render.
