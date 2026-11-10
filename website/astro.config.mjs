import { defineConfig } from 'astro/config';

// One static page. Everything is in the HTML at build time; the only client JS is the small
// click-to-play script in src/components/VideoScript.astro.
export default defineConfig({
  site: 'https://givemotion.org',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'always' },
  compressHTML: true,
});
