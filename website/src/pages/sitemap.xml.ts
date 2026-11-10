// One page, with a video sitemap entry for every test clip so search engines can index the videos.
import { SITE, showcases } from '../data/tests';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const videos = showcases
    .map(
      (s) => `
    <video:video>
      <video:thumbnail_loc>${SITE}${s.video.poster}</video:thumbnail_loc>
      <video:title>${esc(s.title)}</video:title>
      <video:description>${esc(`${s.kind}. ${s.summary} Tested ${s.date}, givemotion ${s.givemotion.label}.`)}</video:description>
      <video:content_loc>${SITE}${s.video.src}</video:content_loc>
      <video:duration>${s.video.seconds}</video:duration>
      <video:publication_date>${s.date}T12:00:00+00:00</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>`,
    )
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${SITE}/</loc>
    <lastmod>${today}</lastmod>${videos}
  </url>
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
