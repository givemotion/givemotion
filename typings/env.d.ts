// Ambient types for type-checking givemotion's own source (`npm run typecheck`). Not part of the published package.

declare global {
  // The runtime works on any element of a composition, HTML or SVG, and keeps its per-element state on the
  // element itself in `__gm*` properties.
  interface Element {
    style: CSSStyleDeclaration;
    [state: `__gm${string}`]: any;
  }

  interface Window {
    /** The composition API (`gm.timeline`, `gm.camera`, ...), set up by src/runtime/runtime.js. */
    gm: any;
    givemotion: any;
    __GM_CONFIG: any;
    [state: `__gm${string}`]: any;
  }

  /** `window.gm` inside functions that render.js and check.js run in the page. */
  var gm: any;
}

export {};
