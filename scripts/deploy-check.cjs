const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveSiteUrl } = require('./site-url.cjs');
const root = path.join(__dirname, '..');
const placeholder = 'https://notesketch.example/';

test('localhost preserves the placeholder', () => {
  assert.equal(resolveSiteUrl(placeholder, {}).href, placeholder);
});

test('Vercel uses the stable production domain, even in previews', () => {
  assert.equal(resolveSiteUrl(placeholder, {
    VERCEL_PROJECT_PRODUCTION_URL: 'notesketch.vercel.app',
    VERCEL_URL: 'notesketch-preview-123.vercel.app', VERCEL_ENV: 'preview'
  }).href, 'https://notesketch.vercel.app/');
});

test('Vercel deployment URL is a fallback', () => {
  assert.equal(resolveSiteUrl(placeholder, { VERCEL_URL: 'notesketch-123.vercel.app' }).href,
    'https://notesketch-123.vercel.app/');
});

test('explicit custom domain wins over JSON and Vercel', () => {
  assert.equal(resolveSiteUrl('https://other-domain.test/', {
    NOTESKETCH_SITE_URL: 'https://music.test', VERCEL_PROJECT_PRODUCTION_URL: 'notesketch.vercel.app'
  }).href, 'https://music.test/');
});

test('real JSON domain wins over automatic detection and supports a subdirectory', () => {
  assert.equal(resolveSiteUrl('https://music.test/studio', {
    VERCEL_PROJECT_PRODUCTION_URL: 'notesketch.vercel.app'
  }).href, 'https://music.test/studio/');
});

test('invalid canonical URLs fail the build configuration', () => {
  for (const value of ['ftp://music.test/', 'https://music.test/?q=1',
    'https://music.test/#section', 'https://user:password@music.test/', 'not-a-url']) {
    assert.throws(() => resolveSiteUrl(placeholder, { NOTESKETCH_SITE_URL: value }));
  }
});

test('Vercel serves the Vite output without a catch-all or HTML URL changes', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.framework, 'vite');
  assert.equal(config.installCommand, 'npm ci');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.rewrites, undefined);
  assert.notEqual(config.cleanUrls, true);
  const swHeaders = config.headers.find(rule => rule.source === '/sw.js').headers;
  assert.match(swHeaders.find(header => header.key === 'Cache-Control').value, /no-cache/);
});

for (const environment of ['production', 'preview']) {
  test(`${environment} SEO and runtime output use the production domain`, () => {
    const keys = ['NOTESKETCH_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_ENV'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      process.env.NOTESKETCH_SITE_URL = 'https://notesketch.vercel.app/';
      process.env.VERCEL_PROJECT_PRODUCTION_URL = 'notesketch.vercel.app';
      process.env.VERCEL_URL = 'notesketch-preview-123.vercel.app';
      process.env.VERCEL_ENV = environment;
      const config = require('../vite.config.js')({ mode: 'production' });
      assert.equal(config.base, '/');
      const plugin = config.plugins[0];
      for (const file of ['index.html', 'about.html']) {
        const html = plugin.transformIndexHtml.handler(fs.readFileSync(path.join(root, file), 'utf8'), {
          filename: path.join(root, file)
        });
        const page = file === 'index.html' ? '' : file;
        assert.ok(html.includes(`rel="canonical" href="https://notesketch.vercel.app/${page}"`));
        assert.ok(html.includes('content="https://notesketch.vercel.app/social-card.png"'));
        assert.ok(html.includes(`name="robots" content="${environment === 'preview' ? 'noindex,follow' : 'index, follow, max-image-preview:large'}"`));
        assert.ok(!html.includes('https://notesketch.example/'));
      }
      const files = new Map();
      plugin.generateBundle.call({ emitFile: asset => files.set(asset.fileName, asset.source),
        warn: message => assert.fail(message) });
      for (const name of ['sw.js', 'remux.js', 'manifest.webmanifest', 'favicon.svg',
        'icon-192.png', 'social-card.png', ...Array.from({ length: 9 }, (_, i) => `stock/${i}.jpg`)]) {
        assert.ok(files.get(name)?.length, `Missing asset: ${name}`);
      }
      assert.match(files.get('robots.txt'), /Sitemap: https:\/\/notesketch\.vercel\.app\/sitemap\.xml/);
      assert.match(files.get('sitemap.xml'), /<loc>https:\/\/notesketch\.vercel\.app\/<\/loc>/);
      assert.match(files.get('sitemap.xml'), /<loc>https:\/\/notesketch\.vercel\.app\/about\.html<\/loc>/);
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
}
