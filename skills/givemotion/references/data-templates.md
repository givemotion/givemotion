# Data, templates, blocks and the cursor

Purpose: one template for many videos (`--data`, `{{data.…}}`, `data-bind`), reusable parts (`<gm-include>`), the block library and how blocks layer, and the cursor block for UI demos.

Contents
- Data (one template, many videos)
- Reuse with gm-include
- Blocks: list, layering, params
- Cursor demos

## Data (one template, many videos)

- Pass `--data file.json` or `--props '{"title":"Q3 results"}'` to any command (render, check, snapshot, still, inspect, dev, bundle). With neither, a `data.json` next to the HTML is used, then `<script type="application/json" id="gm-data">{…}</script>` in the page (good for defaults).
- Use it anywhere in the HTML as `{{data.title}}`, `{{data.users[2]}}` or `{{data.stats.total}}`; an array becomes a comma list (`{{data.users}}` → `1200,1850,1700`, which is what the chart blocks take); `{{data.label|Monthly users}}` gives a default.
- In JS: `gm.data`, never `{{data.…}}` inside a `<script>` (values are HTML-escaped: `it's` arrives as `it&#39;s`). In attributes, quote the template: `title="{{data.name}}"`. Also `<h1 data-bind="title">`, `<img data-bind-src="logo">`, `data-bind-style-color="brand"`.
- Shared files: the page's project folder is served, and symbolic links inside it are followed, so several projects can link one `styles/` or `sounds/` folder in instead of copying it (a link to a hidden file or a key folder like `.ssh` is refused). `..` paths out of the project folder are not served.
- `check` warns when a `{{data.…}}` came out empty (`data-missing`). Test a template with a second data file that has other values and a different number of items (longer names, more months): layouts must not break.
- Scene length can follow the data: `{{data.…}}` works in attributes too (`data-duration="{{data.introLength|3}}"`), and a chart's `timeOf()` can drive the camera.

## Reuse with gm-include

`<gm-include src="parts/intro.html" title="Hi" data-start="2">optional inner HTML</gm-include>` inserts the file; `{{title}}` / `{{title|default}}` / `{{content}}` are replaced. `class`, `style`, `id` and `data-*` on `<gm-include>` go to a wrapper `div` around the block. Block parameters are any other attribute. A missing file is the error `include-not-found`; includes may live in a parent folder.

## Blocks: list, layering, params

- `npx givemotion blocks` lists them; `npx givemotion add lower-third captions` copies them into `./blocks/`. Each file's header shows its params and usage.
- Blocks: title-card, lower-third, captions, code-window, bar-chart, line-chart, stat, checklist, steps, browser-window, phone, cursor, callout, compare, quote, word-pop, logo-reveal, end-card, gradient-bg, grid-bg, lottie.
- Layering: `.scene` is its own layer. Background blocks (`gradient-bg`, `grid-bg`) always sit behind the scene's content. Full-frame blocks (`title-card`, `end-card`, `quote`, `logo-reveal`, `word-pop`, `captions`, `callout`, `cursor`) cover the scene themselves; other blocks are normal boxes you place with flex/grid.
- A background under a whole sequence: put the background element (or a `gradient-bg`) outside the `data-sequence`, before it, with no timing: elements without timing are always there.
- In tests, agents who built their own visuals scored higher than ones who assembled stock blocks. Use blocks for the parts that are fiddly to build (captions, code-window, cursor, lottie, backgrounds) and restyle them to the video's look.
- `browser-window` follows a brand palette: `dots="none"` (or one color, or three `"#e5484d,#f5a524,#30a46c"`), `bar` (top bar color), `field` (address field), `text` (address text), `url-size` (px at 1080p, default 24), `lock="off"`, plus `theme="light"`.
- `code-window`: every line is `.gm-line[data-line="N"]` (aim a camera at it or animate it with a timeline); wrap a part of the code in `⟦ ⟧` to mark it (it becomes `.gm-mark[data-mark="1"]`); `highlight`, `focus` (dims the other lines), `gutter`, `grow`, `typing`, `size`. Scaled down, its text gets small: zoom the camera in rather than shrinking the window.

## Cursor demos

The `cursor` block aims at real elements: `points="1700,980 #email #submit! .menu li:nth-child(3)!"` (selector or x,y; `!` = click) at `times="0.4 1.6 3"` (when it arrives at each point: seconds into its clip, or `times="video: 12.5 13.4"` / `"beats: 16 18"` / `"bars: 4 4.5"` for video times, which do not drift when a transition or `data-cut-align` moves the scene start).
- Add `show="auto"` so it fades in just before its first move and out after its last point (otherwise it sits there from the start of the scene).
- A selector aims a little below the middle of its element. When the middle is the wrong spot (a tag or icon there, or the hand would cover the text), say where: `#slot-thu@30%,55%` (30% across, 55% down its box) or `#row@40,50%` (40 px in from its left edge, at 1080p, zoomed with it); the `!` goes last (`#slot-thu@30%,55%!`). `aim="20%,50%"` sets it for every selector without its own `@`. It keeps tracking the element live, through camera zoom.
- `ring="#e5484d"` colors the click ripple (default: a dark ring with a light halo, readable on light and dark UIs; `ring="light"` = the white one).
- It follows elements while they move, presses them, and sets `data-gm-hover` / `data-gm-pressed` on them so you can style hover and press.
- With `gm.camera`, put it inside the world (x,y in world px; it zooms with the world, like a zoomed screen recording) or after the world in the scene (x,y in screen px; it keeps its size); either way selectors land on their element through any zoom, and no wrapper size is needed.
- `cursor-target` warns when a selector matches nothing.
