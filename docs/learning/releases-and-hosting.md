# Learning guide: releases and hosting

**You'll learn:** how a web game goes from source code to a website without the two getting tangled, and why releases are pinned and checksummed. **Prerequisites:** none. **Read alongside:** `scripts/package-web.mjs`, `scripts/lib/tar.mjs`, `src/siteMeta.ts`, `hosting/headers.json`, and the [releasing](../development/releasing.md) and [hosting](../development/hosting.md) pages.

## Two lifecycles

A project and a website that runs it change at different speeds, for different reasons:

```
open-source game                         a site that hosts it
────────────────                         ────────────────────
commits, pull requests   ─ never ─▶      (nothing happens)
release v0.1.0 (tag + archive) ──────▶   pins v0.1.0, checks it, publishes
development towards v0.2.0               still v0.1.0
release v0.2.0           ─ never ─▶      (nothing happens, until…)
                                         the site's owner pins v0.2.0
```

Keeping them apart has practical benefits: contributors never need a hosting account, an unfinished change can't reach players, every live version is a known, tested release, and going back means pinning the previous one. This project therefore contains no hosting-platform configuration at all (`npm run check:repo` rejects it).

## A release artefact

`npm run release:package` turns a build into `open-clutch-xi-v<version>-web.tar.gz`: the site itself, the licence and notices, the recommended headers, and `release-manifest.json`, which lists a SHA-256 hash for every file.

A **hash** is a short fingerprint of a file's bytes: change one byte and it changes completely. A host that writes down the hash of the archive it approved (for example `"sha256": "7cd8…"`) can refuse anything else, whether the cause is a corrupted download, a tampered mirror or a mistaken upload.

## Reproducible builds

Hashes are much more useful when anyone can rebuild the same bytes from the same source. Two things normally get in the way:
- **Timestamps:** archives record when each file was added. `createTar` writes the same time (the last commit's) for every entry.
- **Order and ownership:** file systems list files in any order and record your user name. `createTar` sorts entries and writes owner 0, mode 644.

Gzip adds no timestamp when Node's `zlib` writes it. `npm run release:check` packages twice from fresh builds and compares the bytes.

Reading archives is a classic security hole: an entry named `../../.bashrc` would write outside the target folder ("zip slip"). `readTar` rejects absolute paths, `..` segments, links and bad header checksums.

## Customising without rebuilding

A site wants its own title, URL and link previews, but rebuilding the game would mean a different, unverified artefact. So the page keeps those tags between two markers (`<!-- site-meta -->` … `<!-- /site-meta -->`, see `src/siteMeta.ts`). A host replaces just that block in the checked files. Everything else stays byte-for-byte the release. Values are HTML-escaped, and URLs are checked.

## Security headers travel with the release

A Content-Security-Policy tells the browser which sources a page may load. Ours allows only the site's own origin, plus WebAssembly compilation for the model decoder. Different hosts configure headers in different formats, so the project publishes the policy as data (`hosting/headers.json`). `npm run check:prod` serves a build with exactly those headers in a real browser and fails on any violation.

## Try it

1. Run `npm run release:package` twice and compare `release/SHA256SUMS`. Then change one character in `src/brand.ts`'s description and package again: which hashes change?
2. Extract the web archive and serve `site/` with any static server (`npx serve` works). Look at the response headers: what's missing compared with `hosting/headers.json`?
3. Write a test that `readTar` rejects an entry of type `2` (a symbolic link).
