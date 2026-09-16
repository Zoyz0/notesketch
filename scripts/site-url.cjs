// Keep localhost SEO placeholders, but use the stable production domain on Vercel.
function resolveSiteUrl(configuredUrl, env = process.env) {
  const explicit = env.NOTESKETCH_SITE_URL;
  const configured = new URL(configuredUrl);
  const placeholder = configured.hostname.endsWith('.example');
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const site = new URL(explicit || (!placeholder ? configuredUrl : '') ||
    (vercelHost ? `https://${vercelHost}` : configuredUrl));
  if (!['https:', 'http:'].includes(site.protocol) || site.search || site.hash || site.username || site.password) {
    throw new Error('NOTESKETCH_SITE_URL must be the public HTTP(S) homepage URL without a query or fragment.');
  }
  site.pathname = site.pathname.replace(/\/?$/, '/');
  return site;
}

module.exports = { resolveSiteUrl };
