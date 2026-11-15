/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { BRAND } from './src/brand.ts';

// The source repository URL comes from package.json (set once with scripts/set-repo-url.mjs). Until it is
// set, the About screen simply doesn't show a source link.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string; repository?: { url?: string } };
const repoUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');

// Fills the %BRAND_*% placeholders in index.html from src/brand.ts, so the page title and link-preview
// metadata follow the one brand definition. Values are HTML-escaped (they end up in attributes).
const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BRAND_TOKENS: Record<string, string> = {
  BRAND_NAME: BRAND.name,
  BRAND_DESCRIPTION: BRAND.description,
  BRAND_WEBSITE: BRAND.website,
  BRAND_MAINTAINER: BRAND.maintainer,
};
const brandHtml = {
  name: 'brand-html',
  transformIndexHtml: (html: string) =>
    html.replace(/%(BRAND_[A-Z_]+)%/g, (m: string, key: string) => {
      if (!(key in BRAND_TOKENS)) throw new Error(`index.html uses unknown placeholder ${m}`);
      return escapeAttr(BRAND_TOKENS[key]);
    }),
};

export default defineConfig({
  base: './',
  plugins: [brandHtml],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __REPO_URL__: JSON.stringify(repoUrl.includes('/OWNER/') ? '' : repoUrl) },
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  build: {
    target: 'es2022',
    // Hashed bundles go to /static (cached immutably); /assets holds the game's own models, audio,
    // textures and flags (stable names, revalidated) — see netlify.toml.
    assetsDir: 'static',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as never);
