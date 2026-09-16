# Deploy Notesketch to Vercel

This is a static Vite app. No server, database, API keys, or paid integrations are required for the studio. `vercel.json` sets the framework to Vite, installs with `npm ci`, builds with `npm run build`, and serves `dist/`.

## Deploy from this folder

Run in a terminal in the project folder:

```sh
npx vercel --prod
```

Sign in when prompted, create or select a project (for example `notesketch`), and keep the root directory as `.`. Do not use `dist` as the project root: Vercel builds it for you.

Alternatively, push the source to a Git repository and import it in Vercel. Select this folder as the Root Directory and leave the build settings supplied by `vercel.json` unchanged. `node_modules`, `dist`, private environment files, and local scratch files are excluded from uploads/source control.

## Domain and SEO

The public site URL in `site.config.json` is `https://notesketch.vercel.app/`. The build uses this stable production URL for canonical links, social image URLs, structured data, and the sitemap. Local and preview builds use the same canonical domain; preview pages get `noindex,follow` metadata.

To override the configured domain, set `NOTESKETCH_SITE_URL` in Vercel's environment settings (for the current site, `https://notesketch.vercel.app/`) and redeploy. Alternatively, change `site.config.json`. When adding/changing a domain, redeploy so the generated SEO files are updated. If the JSON URL is ever changed back to a reserved `.example` placeholder, Vercel system environment variables provide automatic production-domain detection instead.

Preview builds get `noindex,follow` metadata on both pages and continue pointing to the production canonical domain. Production builds are indexable; deployment protection must allow public access for search crawlers. Complete the Search Console steps in [SEO-SETUP.md](./SEO-SETUP.md) after publishing.

## Verify

```sh
npm run test:deploy
npm run build
npm run test:browser
```

The browser checks require Microsoft Edge on Windows (or `STUDIO_BROWSER` pointing to a compatible Chromium executable); they are not part of the Vercel build.

After deployment check `/`, `/about.html`, `/robots.txt`, `/sitemap.xml`, and `/social-card.png`. The studio also needs its stock images, manifest, `sw.js`, and `remux.js`, which the build copies into `dist`. There is deliberately no SPA catch-all rewrite: the guide remains a real HTML page and missing URLs return 404. HTTPS on the public deployment allows Web Audio, recording, and service-worker APIs where supported by the browser.

Official reference: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).
