// `givemotion bundle`: a standalone copy of a composition that plays in any browser
// (no server, no Node), plus <gm-player> to embed it in web pages.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInput } from './render.js';
import { expandIncludes, applyData, readRuntime, scriptJSON } from './server.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function refsIn(html) {
  const out = new Set();
  const attr = /\b(?:src|href|poster|data-src|file|data|logo|image|lib)\s*=\s*"([^"]+)"/gi;
  const css = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  const str = /["'`](\.{0,2}\/?[\w./-]+\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|m4a|mp3|wav|ogg|json|srt|vtt|woff2?|ttf|otf|glb|gltf|js|css))["'`]/gi;
  for (const re of [attr, css, str]) for (const m of html.matchAll(re)) out.add(m[1]);
  return [...out].filter((u) => !/^(?:[a-z]+:|\/\/|#|data:|\{\{)/i.test(u));
}

export function bundle(input, opts = {}) {
  const { file, root } = resolveInput(input);
  const dir = dirname(file);
  const outDir = resolve(opts.output || join(dir, 'bundle'));
  let html = readFileSync(file, 'utf8');
  html = expandIncludes(html, dir, root);
  html = applyData(html, opts.data ?? null);
  // Find files the page uses, including files those files use (css, json)
  const files = new Set();
  const queue = refsIn(html).map((u) => resolve(dir, decodeURIComponent(u.split(/[?#]/)[0])));
  while (queue.length) {
    const f = queue.pop();
    if (files.has(f) || !existsSync(f) || !statSync(f).isFile()) continue;
    files.add(f);
    if (/\.(css|js|json|html)$/i.test(f) && statSync(f).size < 2e6) for (const u of refsIn(readFileSync(f, 'utf8'))) queue.push(resolve(dirname(f), decodeURIComponent(u.split(/[?#]/)[0])));
  }
  // Keep relative paths working: lay files out under their common parent folder
  let base = dir;
  for (const f of files) while (!(f + sep).startsWith(base + sep) && dirname(base) !== base) base = dirname(base);
  const rt = readRuntime();
  const config = { mode: 'preview', data: opts.data ?? null, bundled: true };
  // built-in fonts: inlined when the page uses them (a bundle has no givemotion server)
  const css = rt.css.replace(/url\(\/__gm\/fonts\/([\w.-]+)\)/g, (m, name) => {
    const f = join(HERE, 'runtime', 'fonts', name);
    return /caveat/i.test(html) && existsSync(f) ? `url(data:font/woff2;base64,${readFileSync(f).toString('base64')})` : 'url(about:blank)';
  });
  const tags = `<style data-gm-preset>${css}</style><script>window.__GM_CONFIG=${scriptJSON(config)};</script><script>${rt.js.replace(/<\/script/gi, '<\\/script')}</script>`;
  const head = /<head\b[^>]*>/i.exec(html);
  html = head ? html.slice(0, head.index + head[0].length) + tags + html.slice(head.index + head[0].length) : tags + html;
  const pageRel = relative(base, file).split(sep).join('/').replace(/\.html?$/i, '') + '.html';
  mkdirSync(join(outDir, dirname(pageRel)), { recursive: true });
  writeFileSync(join(outDir, pageRel), html);
  let copied = 0;
  for (const f of files) {
    const rel = relative(base, f);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    mkdirSync(join(outDir, dirname(rel)), { recursive: true });
    copyFileSync(f, join(outDir, rel));
    copied++;
  }
  copyFileSync(join(HERE, 'player', 'gm-player.js'), join(outDir, 'gm-player.js'));
  writeFileSync(join(outDir, 'player.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Player</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10}gm-player{width:min(960px,94vw);border-radius:12px;box-shadow:0 20px 60px #0008}</style>
<script src="gm-player.js"></script>
<gm-player src="${pageRel}" controls></gm-player>
`);
  return { outDir, page: join(outDir, pageRel), player: join(outDir, 'player.html'), files: copied };
}
