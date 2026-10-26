// Compile a .jsx/.tsx composition into a page the engine can render. esbuild + React are
// optional dependencies, loaded only when a JSX file is used.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
let esbuildP = null;

export async function compileJsx(file) {
  if (!esbuildP) esbuildP = import('esbuild').catch(() => null);
  const esbuild = await esbuildP;
  if (!esbuild) return { error: 'JSX compositions need esbuild, react and react-dom. Install them next to your project: npm i esbuild react react-dom' };
  const entry = `import * as M from ${JSON.stringify(file)}; import { mount } from ${JSON.stringify(join(HERE, 'react', 'mount.jsx'))}; mount(M);`;
  const res = await esbuild.build({
    stdin: { contents: entry, resolveDir: dirname(file), loader: 'jsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120',
    jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.svg': 'text', '.json': 'json', '.css': 'css' },
    alias: { 'givemotion/react': join(HERE, 'react', 'index.jsx') },
    nodePaths: [join(PKG, 'node_modules'), join(dirname(file), 'node_modules')].filter((p) => existsSync(p)),
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: false, sourcemap: 'inline', logLevel: 'silent',
  }).catch((e) => ({ error: e }));
  if (res.error) {
    const msgs = (res.error.errors || []).map((m) => `${m.location ? `${m.location.file}:${m.location.line}:${m.location.column} ` : ''}${m.text}`).join('\n');
    return { error: msgs || String(res.error.message || res.error) };
  }
  return { js: res.outputFiles[0].text };
}

/** The HTML page for a JSX composition. */
export async function jsxPage(file) {
  const r = await compileJsx(file);
  const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
  if (r.error) {
    const msg = JSON.stringify('JSX compile error:\n' + r.error).replace(/</g, '\\u003c');
    return `<!doctype html><html data-duration="1"><head><meta charset="utf-8"></head><body><pre style="color:#f55;font:20px monospace;white-space:pre-wrap;padding:30px">${r.error.replace(/</g, '&lt;')}</pre><script>window.gm && gm.__report('error','jsx-compile',${msg},null,'Fix the code at the line shown.');</script></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root" style="display:contents"></div><script>${esc(r.js)}</script></body></html>`;
}
