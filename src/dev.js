// `givemotion dev`: live preview studio.
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { resolveInput } from './render.js';
import { startServer } from './server.js';

export async function dev(input, { port, open, data } = {}) {
  const { root, rel } = resolveInput(input);
  let srv;
  for (const p of port ? [port] : [4400, 4401, 4402, 4403, 0]) {
    try { srv = await startServer({ root, studio: true, port: p, data: data ?? null }); break; } catch (e) { if (port) throw e; }
  }
  const url = `${srv.origin}/__gm/studio/?file=${encodeURIComponent('/' + rel.split('\\').join('/'))}`;
  console.log(`givemotion studio → ${url}`);
  console.log(`serving ${root} (live reload on save). Ctrl+C to stop.`);
  if (open) {
    const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
  }
  await new Promise(() => {});
}
