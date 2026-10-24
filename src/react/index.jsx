// givemotion/react: write compositions as React components.
// The engine (clock, clips, transitions, timeline, camera, audio, render) is the same as for HTML;
// these helpers just connect React to it. Import from 'givemotion/react'.
import React, { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

const gm = () => window.gm;
let now = 0;
const subs = new Set();
const subscribe = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export function __setTime(t) { if (t === now) return; now = t; for (const f of subs) f(); }

const ClipContext = createContext(null);

/** Seconds since the start of the video. */
export function useGlobalTime() { return useSyncExternalStore(subscribe, () => now); }

/** Seconds since the start of the nearest <Clip>/<Scene> (like useCurrentFrame()/fps in other tools). */
export function useTime() {
  const g = useGlobalTime();
  const ref = useContext(ClipContext);
  const el = ref && ref.current;
  if (!el || !gm().__internal) return g;
  const c = gm().__internal.nearestClip(el);
  return c ? gm().__internal.mapT(el, g) - c.start : g;
}
/** Current frame number inside the nearest clip. */
export function useFrame() { return Math.round(useTime() * gm().fps); }
export function useVideoConfig() { const m = gm(); return { width: m.width, height: m.height, fps: m.fps, duration: m.duration }; }
export function useData() { return gm().data; }

function timeAttrs(p) {
  const a = {};
  if (p.start != null) a['data-start'] = String(p.start);
  if (p.duration != null) a['data-duration'] = String(p.duration);
  if (p.end != null) a['data-end'] = String(p.end);
  if (p.transition != null) a['data-transition'] = p.transition;
  if (p.enter != null) a['data-enter'] = p.enter;
  if (p.exit != null) a['data-exit'] = p.exit;
  if (p.camera != null) a['data-camera'] = p.camera;
  if (p.loop != null) a['data-loop'] = String(p.loop);
  if (p.freeze != null) a['data-freeze'] = String(p.freeze);
  if (p.speed != null) a['data-speed'] = String(p.speed);
  return a;
}
const OWN = ['start', 'duration', 'end', 'transition', 'enter', 'exit', 'camera', 'loop', 'freeze', 'speed', 'as', 'children', 'ref'];
const rest = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !OWN.includes(k)));

/** A part of the video that is shown from `start` for `duration` seconds (relative to its parent clip). */
export function Clip(props) {
  const ref = useRef(null);
  const Tag = props.as || 'div';
  const outer = props.ref;
  const setRef = (el) => { ref.current = el; if (typeof outer === 'function') outer(el); else if (outer) outer.current = el; };
  return <ClipContext.Provider value={ref}><Tag ref={setRef} {...timeAttrs(props)} {...rest(props)}>{props.children}</Tag></ClipContext.Provider>;
}
/** A full-frame scene (a Clip with class "scene"). */
export function Scene(props) {
  const cls = ['scene', props.className].filter(Boolean).join(' ');
  return <Clip {...props} className={cls} />;
}
/** Children play one after another. transition="fade 0.6" overlaps them; gap="0.2" adds space. */
export function Sequence({ transition, gap, cuts, children, as = 'div', ...p }) {
  const Tag = as;
  return <Tag data-sequence="" {...(transition ? { 'data-transition': transition } : {})} {...(gap != null ? { 'data-gap': String(gap) } : {})} {...(cuts ? { 'data-cuts': [].concat(cuts).join(' ') } : {})} {...p}>{children}</Tag>;
}
/**
 * Build a seekable GSAP-style timeline once, scoped to the returned ref's element.
 *   const ref = useTimeline((tl) => tl.from('.title', { y: 80, opacity: 0 }).to('.dot', { x: 400 }, '<'));
 *   return <div ref={ref}>…</div>
 */
export function useTimeline(build, opts) {
  const ref = useRef(null);
  useLayoutEffect(() => { const tl = gm().timeline(ref.current, opts); build(tl, ref.current); }, []);
  return ref;
}
/** Run code on every frame after layout (to measure or follow elements). */
export function useOnLayout(fn) {
  const ref = useRef(null);
  const f = useRef(fn); f.current = fn;
  useLayoutEffect(() => { gm().onLayout(ref.current, (t, info) => f.current(t, info)); }, []);
  return ref;
}
/** Loudness, bands and beats of an audio file: const music = useAudio('music.mp3') */
export function useAudio(src) { const r = useRef(null); if (!r.current) r.current = gm().audio(src); return r.current; }

// Math helpers (same as window.gm)
export const interpolate = (...a) => gm().interpolate(...a);
export const spring = (...a) => gm().spring(...a);
export const noise = (...a) => gm().noise(...a);
export const easing = (...a) => gm().easing(...a);
export const clamp = (...a) => gm().clamp(...a);
export const lerp = (...a) => gm().lerp(...a);
export const random = (...a) => gm().random(...a);
export const rng = (...a) => gm().rng(...a);
export const shape = new Proxy({}, { get: (_, k) => gm().shape[k] });
export const path = new Proxy({}, { get: (_, k) => gm().path[k] });
export const color = new Proxy({}, { get: (_, k) => gm().color[k] });
