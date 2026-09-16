const { defineConfig, loadEnv } = require('vite');
const fs = require('node:fs');
const path = require('node:path');
const { resolveSiteUrl } = require('./scripts/site-url.cjs');

module.exports = defineConfig(({ mode }) => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config.json'), 'utf8'));
  const env = loadEnv(mode, __dirname, 'NOTESKETCH_');
  const site = resolveSiteUrl(config.siteUrl, { ...env, ...process.env });
  const isPreview = process.env.VERCEL_ENV === 'preview';
  const siteUrl = site.href, imageUrl = new URL('social-card.png', site).href;
  const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const creator = { '@type': 'Person', '@id': siteUrl + '#creator', name: 'Dimas Mahardhika Wibowo' };
  const website = { '@type': 'WebSite', '@id': siteUrl + '#website', name: 'Notesketch', alternateName: 'Notesketch Music Studio', url: siteUrl, inLanguage: 'en', creator };
  return {
  base: site.pathname,
  build: { rollupOptions: { input: { studio: path.join(__dirname, 'index.html'), guide: path.join(__dirname, 'about.html') } } },
  plugins: [{
    name: 'studio-runtime-assets',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (isPreview) html = html.replace(/(<meta name="robots" content=")[^"]*(")/, '$1noindex,follow$2');
        const isGuide = path.basename(context.filename) === 'about.html';
        const pageUrl = isGuide ? new URL('about.html', site).href : siteUrl;
        html = html.replace(/(<link rel="manifest" href=")[^"]+("[^>]*>)/, '$1./manifest.webmanifest$2');
        html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")/g, '$1' + escape(imageUrl) + '$2');
        let entities;
        if (isGuide) {
          entities = [{ '@type': 'WebPage', '@id': pageUrl + '#page', url: pageUrl,
            name: 'Notesketch Guide — Draw Melodies & Create Music Loops', isPartOf: { '@id': website['@id'] },
            about: { '@id': siteUrl + '#app' }, inLanguage: 'en', author: creator }, website];
        } else {
          const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
          const app = JSON.parse(match[1]);
          delete app['@context'];
          Object.assign(app, { '@id': siteUrl + '#app', url: siteUrl, image: imageUrl,
            author: creator, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            mainEntityOfPage: siteUrl });
          entities = [app, website];
          html = html.replace(match[0], '');
        }
        const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': entities }).replace(/</g, '\\u003c');
        return html.replace('</head>', `<link rel="canonical" href="${escape(pageUrl)}">\n<meta property="og:url" content="${escape(pageUrl)}">\n<script type="application/ld+json">${schema}</script>\n</head>`);
      }
    },
    generateBundle() {
      const files = ['remux.js', 'sw.js', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png',
        'social-card.svg',
        ...Array.from({ length: 9 }, (_, i) => `stock/${i}.jpg`)];
      if (fs.existsSync(path.join(__dirname, 'social-card.png'))) files.push('social-card.png');
      for (const fileName of files) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(path.join(__dirname, fileName)) });
      }
      const robots = fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf8').trimEnd();
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots + '\n\nSitemap: ' + new URL('sitemap.xml', site).href + '\n' });
      const pages = [['', 'index.html'], ['about.html', 'about.html']];
      const urls = pages.map(([url, file]) => `<url><loc>${escape(new URL(url, site).href)}</loc><lastmod>${fs.statSync(path.join(__dirname, file)).mtime.toISOString()}</lastmod></url>`).join('\n');
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n' });
      if (site.hostname.endsWith('.example')) this.warn('SEO uses a placeholder domain. Set site.config.json siteUrl or NOTESKETCH_SITE_URL to the public URL before deploying.');
    }
  }]
  };
});
