# givemotion.org

The project's landing page: one static page, built with [Astro](https://astro.build) (MIT). It is not part of the
npm package. Everything on it is in the HTML at build time; the only client JavaScript is a ~1 KB click-to-play and
copy-button script.

```bash
cd website
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/, deploy it to any static host
```

## Where things are

| | |
|---|---|
| `src/data/tests.ts` | Every test on the page: date, givemotion version, other tools' versions, scores, report link. Add new rounds here. |
| `src/data/faq.ts` | The FAQ (also the FAQPage JSON-LD and llms.txt). Each answer starts with a one-sentence direct answer. |
| `src/pages/index.astro` | The page, its meta tags and JSON-LD (SoftwareApplication, FAQPage, a VideoObject per clip). |
| `src/pages/sitemap.xml.ts`, `llms.txt.ts` | Generated at build from the same data, so they never drift from the page. |
| `public/robots.txt` | Allows every crawler, AI answer engines named explicitly. |
| `scripts/build-media.mjs` | `npm run media`: turns `docs/media/*.gif` into MP4 + WebP posters (the site never ships a GIF). Needs ffmpeg and cwebp. |

## Videos and speed

Each video is a WebP poster (4-60 KB, lazy-loaded) with a play button. The MP4 is requested only when someone presses
play, so the first load is about 210 KB with no video bytes.

**Round 7 and 8 videos:** copy the MP4s into `public/videos/round-7/` and `public/videos/round-8/`, named like the
links in `docs/experiments/videos/` (`N-givemotion.mp4`, `N2-givemotion.mp4`, one file per set and tool), run `npm run media` for posters,
and rebuild. Each score in the round tables then links to its video. Files that are missing are skipped.

## Rules for the content

Comparisons follow CONTRIBUTING.md's fair-comparison policy: every claim dated and versioned with its source, losses
shown as clearly as wins, plain names, no other tool's logo, and the not-affiliated line in the footer.
