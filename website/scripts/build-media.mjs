#!/usr/bin/env node
// Turns the README's GIFs (docs/media/*.gif) into small H.264 MP4s and WebP posters for the website,
// and the round-8 crops (docs/media/r8p-*.jpg) into WebP. GIFs are 5-10x larger than the same clip as MP4,
// so the site never ships a GIF. Run it after a GIF in docs/media changes: `npm run media`. Needs ffmpeg and cwebp.
//
// Round 7/8 test videos: put the MP4s in public/videos/round-7/ and public/videos/round-8/ (named like
// N-givemotion.mp4, as in docs/experiments/videos/). This script makes a poster for each one it finds.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const docsMedia = resolve(site, '../docs/media');
const out = join(site, 'public/media');
mkdirSync(out, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

// Where to take the poster from (seconds), so it shows the video, not a blank first frame.
const posterAt = {
  'tools-showcase': 6, 'kinetic-showcase': 6, 'models-showcase': 7, 'efforts-showcase': 6, 'random-briefs': 5,
  'data-story': 4.5, 'code-explainer': 4, 'vertical-short': 3.5,
  'lighthouse-opus': 12, 'lighthouse-sonnet': 12, 'lighthouse-haiku': 12, 'lighthouse-gemini': 12,
};

const kb = (f) => Math.round(statSync(f).size / 1024);
// This ffmpeg may lack libwebp, so a frame goes to PNG first and cwebp (libwebp's own tool) encodes it.
const tmp = join(site, 'node_modules/.media-tmp.png');
mkdirSync(dirname(tmp), { recursive: true });
const toWebp = (inputArgs, dest, quality, vf) => {
  ff([...inputArgs, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), tmp]);
  execFileSync('cwebp', ['-quiet', '-q', String(quality), tmp, '-o', dest]);
};

for (const file of readdirSync(docsMedia).filter((f) => f.endsWith('.gif'))) {
  const name = file.replace(/\.gif$/, '');
  const src = join(docsMedia, file);
  const mp4 = join(out, `${name}.mp4`);
  const webp = join(out, `${name}.webp`);
  // Even dimensions for yuv420p; faststart so playback begins before the file is fully downloaded.
  ff(['-i', src, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-an', mp4]);
  toWebp(['-ss', String(posterAt[name] ?? 2), '-i', src], webp, 80);
  console.log(`${name}: gif ${kb(src)} KB -> mp4 ${kb(mp4)} KB, poster ${kb(webp)} KB`);
}

for (const file of readdirSync(docsMedia).filter((f) => /^r8p-.*\.jpg$/.test(f))) {
  const webp = join(out, file.replace(/\.jpg$/, '.webp'));
  toWebp(['-i', join(docsMedia, file)], webp, 80);
  // A 1400 px wide copy for phones and laptops (srcset); the full-resolution one stays for big screens.
  const small = webp.replace(/\.webp$/, '-1400.webp');
  toWebp(['-i', join(docsMedia, file)], small, 80, 'scale=1400:-2');
  console.log(`${file} -> ${kb(webp)} KB, 1400w ${kb(small)} KB`);
}

for (const round of ['round-7', 'round-8']) {
  const dir = join(site, 'public/videos', round);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mp4'))) {
    const webp = join(dir, file.replace(/\.mp4$/, '.webp'));
    if (existsSync(webp)) continue;
    toWebp(['-ss', '4', '-i', join(dir, file)], webp, 75, 'scale=640:-2');
    console.log(`${round}/${file}: poster made`);
  }
}
