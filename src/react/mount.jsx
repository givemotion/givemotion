// Entry used by the JSX compiler: renders the composition's default export into the page.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { __setTime } from './index.jsx';

export function mount(M) {
  const cfg = Object.assign({}, M.config || {});
  const html = document.documentElement;
  for (const k of ['width', 'height', 'fps', 'duration', 'background']) if (cfg[k] != null && !html.hasAttribute('data-' + k)) html.setAttribute('data-' + k, String(cfg[k]));
  const el = document.getElementById('root');
  const Comp = M.default;
  if (typeof Comp !== 'function') throw new Error('The .jsx file must `export default function Video() { … }`.');
  const root = createRoot(el);
  flushSync(() => root.render(<Comp data={window.gm.data} />));
  window.gm.onFrame((t) => { flushSync(() => __setTime(t)); });
}
