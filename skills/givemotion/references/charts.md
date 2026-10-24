# Charts and numbers

Purpose: live line charts (`gm.chart.line`) a camera can follow, the chart blocks, and counters. For the story structure of a data video, also read `references/genres/data-story.md`.

Contents
- Live line chart
- Pinned callouts and live text
- Chart JS API and styling
- Layout advice
- Blocks and counters

## Live line chart

`gm.chart.line` draws a data line over time. Its head is a real element (`chart.head`) a camera can follow, and anything inside the chart can be pinned to a data point or ride the head. Don't hand-write chart math in `onFrame`.

```html
<div id="world" style="position:absolute;left:0;top:0;width:4000px;height:1300px">
  <div id="growth" style="position:absolute;left:100px;top:140px;width:3700px;height:1060px;--chart-line:#38e1c7">
    <div class="rider" data-point="head right 36"><span data-chart-text="label"></span> <b data-chart-text="value"></b></div>
    <div class="callout" data-point="Mar top-left 60">Outage</div>   <!-- appears when the line reaches Mar -->
    <div class="callout" data-point="Aug top-left 40">Viral video</div>
  </div>
</div>
<script>
const chart = gm.chart.line('#growth', {
  values: gm.data.values, labels: gm.data.months,   // arrays or comma strings
  delay: 0.6, duration: 9.4,                         // drawing time (holds included), spread over any number of points
  holds: { Mar: 1.3, Aug: 1.3 },                     // pause there; points are an index (0 = first), a label, 'last' or 'max'
  colors: { Mar: '#ff4d6d', Aug: '#ffcf3f' },        // the segment into Mar is red, and the head while it is on it
  rescale: true,                                     // the y axis grows with the highest value so far: an early dip stays visible
  axis: 'head 460',                                  // tick labels 460 px right of the head ('left' default, 'right', 'none')
  overview: true,                                    // when the line is done, the chart narrows to the frame width
});
const mar = chart.timeOf('Mar'), end = chart.timeOf('last');   // when the line gets there (seconds in the chart's clip)
gm.camera('#world')
  .shot(0, { follow: chart.head, zoom: 1.1, offset: [260, 0] })       // head left of center, room ahead
  .shot(mar - 0.4, { follow: chart.head, zoom: 1.35, duration: 0.6 })  // push in on the dip
  .shot(mar + 1.2, { follow: chart.head, zoom: 1.1, offset: [260, 0], duration: 0.8 })
  .shot(end + 0.2, { fit: '#growth', duration: 1.4 })                  // the whole year, labels still full size
  .shake(mar, { amount: 12 });
</script>
```

## Pinned callouts and live text

- `data-point="<point> <side> <gap>"` pins any element inside the chart to a point, or to `head` (it rides the tip). Sides: `top` `bottom` `left` `right` `center`, and the corners `top-left` … `bottom-right` (diagonally away from the point); the gap is px from the dot. A pinned callout enters (`pop` unless it has its own `data-enter`) when the line reaches its point; its `data-enter` delay counts from that moment.
- `data-chart-text="value"` shows the value at the head (`prefix`, `suffix`, `decimals` or `format: v => …` options), `"label"` the current label, `"change"` the change from the previous point (`+42%`). Outside the chart: `data-chart-text="#growth value"`. Drive every number from the chart so a counter never disagrees with the line (judges caught "MAR 2,217" shown after the line left March).

## Chart JS API and styling

- JS: `chart.valueAt(t)`, `chart.progress(t)` (fractional point index), `chart.timeOf(point)` (plan camera shots, bursts and tweens from it), `chart.pointAt(point)` (`{x, y, value, label, time}` in the chart's own px), `chart.dots[i]`, `chart.head`.
- Timing by hand like a path travel: `stops: [[0.5, 0], [3, 'Mar'], [4.2, 'Mar'], [9, 'last']]`; `ease` (default `in-out-sine`) shapes each run between holds.
- Style with CSS: `--chart-line` (line color), `.gm-chart-head`, `.gm-chart-dot`, `.gm-chart-label` (`[data-reached]` once the line passed it), `.gm-chart-tick`, `.gm-chart-line`, `.gm-chart-area`. `var(--chart-color)` is the color of the segment the head is on (use it on a rider). Options: `dots: false`, `area: false`, `smooth: false`, `min`, `max`, `padding: [top, right, bottom, left]`.
- `check` codes: `chart-no-element`, `chart-no-values` (fewer than 2 numbers), `chart-no-size` (the element has no width/height), `chart-bad-point` (a point name is not an index, label, `last` or `max`).

## Layout advice

- Make the chart 2-3 frames wide inside a camera world so the camera can follow at zoom ~1.1, put the rider on one side of the head (`right`) and the callouts on the other (`top-left`), and keep callouts off the line.
- A small dip on a linear axis that ends at a big number is invisible: use `rescale: true`, or push the camera in on it.
- Axis labels and units are secondary text: ≥ 32 px on screen. In the final overview, check they are still readable (`fit: '#growth'` with `overview: true` on the chart keeps labels full size); a fit-all of a very wide chart squashes it into a thin strip with tiny labels.
- Callouts near the bottom edge get cut while the camera moves: place them above the line, or give the shot more `padding`.
- One highlight color per event (red for a drop, gold for a jump), the same color on the segment, the callout and a burst at that moment.

## Blocks and counters

- Without a camera, use the `line-chart` block: the same options as attributes (`holds="Mar:1.2"`, `colors="Mar:#ff4d6d"`, `rescale="true"`, `axis`, `dots`, `endlabel`, `overview`, callouts as inner HTML with `data-point`); `gm.chart.get('#id')` gives its chart (follow it with `follow: '#growth .gm-chart-head'`).
- `bar-chart` block: `values`, `labels`, `title`, `prefix`, `suffix`, `max`, `color`, `highlight` (index), `height`. Bars grow one after another and count up. For a bar race or custom bars, use SVG/HTML bars with `grow-y` or a timeline `fromTo` of `scaleY` with `stagger`.
- `stat` block: one big number that counts up with a label and a `delta` badge.
- Counters anywhere: `data-count="0 1250"` (`data-count-duration`, `-delay`, `-prefix`, `-suffix`, `-decimals`, `-ease`, `-group="false"`), or a timeline `textContent` tween. Data comes from `gm.data` / `{{data.values}}` (`references/data-templates.md`); an array becomes a comma list, which is what the chart blocks take.
