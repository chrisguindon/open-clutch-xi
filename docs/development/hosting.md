# Hosting Open Clutch XI

**Audience:** anyone who wants to put the game on a website. The project doesn't choose a hosting platform, and nothing in it needs a hosting account: contributors build, test and run everything locally.

Open Clutch XI is a **static web app**. There's no backend, no accounts, no API keys and no third-party requests: every file comes from the site's own origin. Any static host works, from a plain web server to a static-hosting service, including in a subdirectory (asset paths are relative).

## What to serve

Either build it yourself:

```bash
npm ci
npm run build              # → dist/
SITE_URL=https://games.example.org/ npm run build   # optional: absolute link-preview URLs for your site
```

or use a release's web archive, `open-clutch-xi-v<version>-web.tar.gz` (see [releasing](releasing.md)). Serve the folder `site/` from the archive, or `dist/` from a build, as the web root. Check the archive first:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

The archive also carries `LICENSE`, `NOTICE.md` (keep the notices available; the game links to `NOTICE.txt`), `release-manifest.json` (version, source commit and a SHA-256 for every file) and `hosting/headers.json`.

## Headers

`hosting/headers.json` lists the HTTP headers the game should be served with, path by path, with the reason for each. Translate them into your server's or host's configuration format. In summary:

| Paths | Headers |
|---|---|
| everything | `Content-Security-Policy` (own origin only; `'wasm-unsafe-eval'` for the WebAssembly model decoder), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, a `Permissions-Policy` granting no camera, microphone or location |
| `/static/*` | hashed bundles: `Cache-Control: public, max-age=31536000, immutable` |
| `/assets/*` | models, audio, textures, flags: cache a day, then revalidate |
| `/index.html` | always revalidate |
| `.glb`, `.webp`, `.mp3`, flag `.svg` | correct `Content-Type` (`model/gltf-binary`, `image/webp`, `audio/mpeg`, `image/svg+xml`) |

**Single-page fallback:** unknown paths should serve `/index.html` with status 200. Real files always take precedence.

The policy is checked in CI (`tests/hosting.test.ts`), and `npm run check:prod` serves a build with exactly these headers in a headless browser, failing on any CSP violation, failed request or console error. To check a build assembled elsewhere: `PROD_DIR=path/to/site node scripts/prod-check.mjs`.

## Your site's title, description and link previews

The page's metadata lives in one marked block in `index.html`:

```html
<!-- site-meta -->
<title>…</title> <meta name="description" …> <meta property="og:…"> <meta name="twitter:…"> …
<!-- /site-meta -->
```

Released builds fill it with the game's defaults and **no absolute URLs**: a canonical link to someone else's site would be wrong for yours. To describe your site, either:
- build with `SITE_URL` set (adds the canonical link, `og:url` and an absolute `og:image`), or
- replace the whole block in the built `index.html` with your own tags (escape the values). This needs no rebuild, so you can keep using the released, checksummed files. The markers are a stable contract between releases; `src/siteMeta.ts` shows exactly what goes inside.

You can also add or replace site-level files next to `index.html`, such as your own `social-card.jpg` (1200×630).

Don't change gameplay code to customise a site. Saved games, settings and records are stored in the browser per origin, under keys that never depend on the brand or the site, so moving to a new domain starts players afresh on that domain, while upgrading the game on the same domain keeps their data (see [persistence](../architecture/persistence.md)).

## Your own extras: `site-config.json`

A site can add a few touches of its own, again without rebuilding, by placing `site-config.json` next to `index.html`:

```json
{
  "boardPanels": [{ "text": "example", "accentText": ".org", "bg": "#0b1530", "fg": "#f1f5f9", "accent": "#60a5fa" }],
  "creatorPortrait": { "src": "assets/site/portrait.jpg", "alt": "The site's creator", "note": "The portrait is not covered by the open-source licence." }
}
```

- `boardPanels`: up to three extra panels on the stadium's advertising boards (up to 24 characters each, colours as `#rrggbb`). `accentText` is drawn in the accent colour with an underline.
- `creatorPortrait`: an image under `assets/` (jpg, png or webp) shown on the About screen instead of the creator's initials, with its alt text and an optional note (for example its licence).

The file is optional and untrusted: the game validates it strictly (`src/game/siteConfig.ts`) and ignores anything malformed, or a missing file that comes back as the page itself. Serve it as `application/json`. It can't change gameplay, rules or saved data. Only show panels and images you have the right to use.

## Checklist after publishing

- The menu loads and flags show in **Teams & options**.
- A match starts with 3D players (not grey mannequins).
- The browser console shows no CSP errors.
- About shows the version you meant to deploy.
- Response headers match `hosting/headers.json` (for example `curl -sI https://your.site/ | grep -i content-security`).
