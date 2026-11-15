/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Finds the browser for the browser checks, in this order:
//   1. CHROME_PATH, if set;
//   2. the project's own pinned Chrome for Testing in .cache/browsers/ (`npm run browsers:install`),
//      the same build in every environment, matching the puppeteer-core version in package-lock.json;
//   3. an installed Chrome, Chromium or Edge (Linux, macOS, Windows).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, computeExecutablePath } from '@puppeteer/browsers';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';

const root = new URL('../..', import.meta.url).pathname;

/** The pinned browser: Chrome for Testing at the build this puppeteer-core version is made for. */
export const PINNED_BROWSER = { browser: Browser.CHROME, buildId: PUPPETEER_REVISIONS.chrome, cacheDir: join(root, '.cache', 'browsers') };

/** Path of the pinned browser if it has been installed, else null. */
export function pinnedChromePath() {
  try {
    const p = computeExecutablePath(PINNED_BROWSER);
    return existsSync(p) ? p : null;
  } catch {
    return null; // unsupported platform
  }
}

/** The browser to use, or null if none is available (see the order above). */
export function locateChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const pinned = pinnedChromePath();
  if (pinned) return pinned;
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ...pf.flatMap((d) => [join(d, 'Google/Chrome/Application/chrome.exe'), join(d, 'Microsoft/Edge/Application/msedge.exe')]),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** How to get a browser, for error messages. */
export const NO_BROWSER_HELP =
  'No Chrome/Chromium found for the browser checks. Run `npm run browsers:install` (downloads the pinned Chrome for Testing into .cache/browsers/, no system changes), or set CHROME_PATH to an installed Chrome or Chromium.';

/** The browser to use; exits with a clear message if there is none. */
export function findChrome() {
  const found = locateChrome();
  if (!found) {
    console.error(process.env.CHROME_PATH ? `CHROME_PATH does not exist: ${process.env.CHROME_PATH}` : NO_BROWSER_HELP);
    process.exit(2);
  }
  return found;
}
