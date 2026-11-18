## Bigger videos: plan once, build scenes in parallel (if your tool has sub-agents)

A suggestion, not a rule: if the user asks for another way of working, do that.

**When it pays:** the video splits into 3+ separate scenes joined by transitions, each one a section you could build on its own. **When it doesn't:** 1-2 scenes, or one continuous world with a camera, where every beat grows out of the last: do that yourself in one file. Every sub-agent re-reads the docs, so on small work it costs more than it saves.

When it pays, and you can start sub-agents (and choose their model):
1. **Plan yourself, with your strongest model.** Steps 0-1 of the loop: direction, shot list, one style frame. Taste can't be checked by a tool, so deep thinking pays here. Write the shared pieces first: `brand.css` (palette as CSS variables, fonts, type sizes, the layout grid) and `plan.md` (easing, each scene's length, what is on screen, and every hand-over: which element carries across, its exact position and size at the cut). Parallel scenes only match if they share these.
2. **Build in parallel with a cheaper, faster model.** Start one sub-agent per scene in one go, each writing `scenes/<name>.html` (one `<section class="scene">`, assembled with `<gm-include ... scope>`, `references/data-templates.md`). Tell each: read SKILL.md, `brand.css` and `plan.md`; build only its scene; `check` it and `still` its key moments until clean; reply in a few lines. Writing code is checkable work: the render tells it what is wrong.
3. **Check yourself.** Assemble the scenes in `video.html`, `check`, `review`, and look at the cuts: do the scenes read as one video (same type sizes, colours, motion speed, hand-overs that line up)? Fix the seams yourself, then render.
