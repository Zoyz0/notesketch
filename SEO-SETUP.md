# Notesketch search setup

The app and guide include descriptive titles, unique descriptions, accessible labels, crawlable HTML, social previews, and JSON-LD describing the real app and creator. The build generates canonical URLs, `robots.txt`, and `sitemap.xml` for both pages.

`https://notesketch.example/` is a reserved placeholder, not a live website. Localhost cannot be indexed as a public site.

## Before publishing

1. On Vercel, the build automatically uses the project's production domain when `site.config.json` still has the placeholder. See [DEPLOYMENT.md](./DEPLOYMENT.md). On other hosts, set `siteUrl` in `site.config.json` to the public HTTPS homepage URL, including a trailing slash. Alternatively, set `NOTESKETCH_SITE_URL` in the deployment environment or a local `.env` file. An environment value overrides the JSON configuration. Do not add the placeholder environment value to Vercel.
2. Run `npm run build` and publish the contents of `dist/` to that URL. Serve `index.html`, `about.html`, `robots.txt`, `sitemap.xml`, and image assets publicly, without login or bot blocking. Preserve real 404 responses for nonexistent pages.
3. Redirect alternate domains and HTTP to your chosen HTTPS domain. If using a subdirectory, include it in `siteUrl`; Vite uses the same path as its build base. Put `robots.txt` at the origin root as well, because crawlers request it there.
4. Verify the domain in [Google Search Console](https://search.google.com/search-console), submit `sitemap.xml`, and inspect the homepage and guide with URL Inspection. Request indexing after the pages are live. Bing Webmaster Tools can also accept the sitemap.
5. Check the published HTML for the correct canonical and social image URLs. Confirm the sitemap lists the real domain and that the social image responds with HTTP 200. Review structured data with Google's [Rich Results Test](https://search.google.com/test/rich-results) and the [Schema Markup Validator](https://validator.schema.org/).

Search engines decide whether and when to index pages. Metadata and a sitemap improve discovery; they do not guarantee rankings or immediate search results. There are no invented ratings or reviews in the structured data.

## Checks

Run `npm run build`, then `npm run test:browser` to check the studio and SEO output in Edge. Set `STUDIO_BROWSER` to another Chromium executable if needed. The tests use an isolated browser profile.

The share illustration is editable in `social-card.svg`. Regenerate its PNG with `node scripts/browser-check.cjs --render-social`, then rebuild. A real 1200 × 630 PNG is used for social previews; the SVG is not relied on by social crawlers.

Reference: [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [sitemap guidelines](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), and [requesting a recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).
