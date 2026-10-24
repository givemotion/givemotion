# motionwright with React (JSX)

A composition can be a React component in a `.jsx` (or `.tsx`) file. The engine is the same as for HTML:
everything in SKILL.md (clips, sequences, transitions, `data-enter`, `data-camera`, `data-morph`, `mw.timeline`,
audio, check, snapshot, render) works, because React just renders normal HTML elements with those attributes.
Run every command on the `.jsx` file: `npx motionwright check video.jsx`, `snapshot video.jsx`, `render video.jsx -o out.mp4`.

```jsx
import { Sequence, Scene, Clip, useTime, interpolate, useTimeline } from 'motionwright/react';

export const config = { width: 1920, height: 1080, fps: 30 };   // optional: duration, background

function Stat({ value, label, i }) {
  const t = useTime();                                     // seconds since this clip started
  const v = interpolate(t, [0.3 + i * 0.15, 1.8], [0, value], { easing: 'out-expo' });
  return <div className="stat" data-enter="rise 0.7" style={{ '--i': i }}><b>{Math.round(v)}</b><span>{label}</span></div>;
}

export default function Video({ data }) {                  // data = --data / --props JSON
  const title = useTimeline((tl) => tl.from('.word', { y: 120, opacity: 0, stagger: 0.06, ease: 'expo.out' }));
  return (
    <>
      <style>{`body{background:#0b0d12;color:#fff;font-family:Inter,system-ui} .scene{display:grid;place-items:center}`}</style>
      <audio src="music.mp3" data-volume="0.5" data-fade-out="1.5" />
      <Sequence transition="push-left 0.7">
        <Scene duration={3} camera="push 1.08">
          <h1 ref={title}>{'Ship faster'.split(' ').map((w) => <span key={w} className="word" style={{ display: 'inline-block' }}>{w}&nbsp;</span>)}</h1>
        </Scene>
        <Scene duration={4}>
          {data.stats.map((s, i) => <Stat key={s.label} {...s} i={i} />)}
        </Scene>
      </Sequence>
    </>
  );
}
```

## API (`import … from 'motionwright/react'`)

| | |
|---|---|
| `<Sequence transition="fade 0.6" gap={0.2} cuts={[0, 2.13, 4.27]}>` | Children play one after another (same as `data-sequence`); `cuts` = when each child starts. |
| `<Scene duration={3} start? transition? camera? enter? exit?>` | Full-frame clip (`class="scene"`). Props map to the `data-*` attributes. |
| `<Clip start={1} duration={2} as="span">` | Any element that exists only for that time, relative to its parent clip. Also `loop` `freeze` `speed`. |
| `useTime()` | Seconds since the nearest Clip/Scene started (re-renders every frame). `useFrame()`, `useGlobalTime()`. |
| `useTimeline((tl, el) => …)` | Returns a ref. Builds a seekable `mw.timeline` scoped to that element, once. |
| `useOnLayout((t) => …)` | Returns a ref. Runs after layout each frame (measure/follow elements). |
| `useAudio('music.mp3')` or `useAudio('#music')` | Audio analysis: `.level(t)`, `.bands(t, n)`, `.beat(t)`, `.beats`, `.downbeats`, `.bpm`. Add an `<audio>` element for the sound itself. Run `npx motionwright audio music.mp3` to see the beats first. |
| `useVideoConfig()`, `useData()` | Size/fps/duration; the `--data` JSON. |
| `interpolate`, `spring`, `noise`, `easing`, `clamp`, `lerp`, `random`, `rng`, `shape`, `path`, `color` | Same as `mw.*` (easing names: `out-expo`, `in-out-cubic`, `spring`, `power2.out`, `back.out(1.7)`…). `random('seed')` → the same number in [0,1) every time. |

## Rules

- Any `data-*` attribute from SKILL.md works in JSX: `<h1 data-split="words" data-enter="mask-up" data-stagger="0.06">`.
- Keep elements mounted and control when they show with `<Clip start duration>`; don't mount/unmount based on time.
- `ref` works on `<Scene>` and `<Clip>` (e.g. `<Scene ref={useTimeline(...)}>`). `mw.camera(...)` and `mw.path.travel(...)` from SKILL.md work too: call them in a `useLayoutEffect` once.
- Computing styles from `useTime()` is fine (it is pure). Prefer CSS animations, `data-enter` and `useTimeline` for most motion: they are cheaper than re-rendering every frame.
- Put CSS in a `<style>` element or a `style` prop. Import other `.jsx` files and npm packages normally; files are bundled for you.
- Paths to images, video and audio are relative to the `.jsx` file.
