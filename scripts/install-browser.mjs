/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Installs the browser the browser checks use: Chrome for Testing, at the exact build that this
// puppeteer-core version is made for, into .cache/browsers/ (ignored by Git). Nothing is installed
// system-wide, and every environment gets the same browser.  npm run browsers:install
// On a minimal Linux system Chrome may also need shared libraries: see docs/development/testing.md.
import { install, detectBrowserPlatform } from '@puppeteer/browsers';
import { PINNED_BROWSER, pinnedChromePath } from './lib/chrome.mjs';

const existing = pinnedChromePath();
if (existing) {
  console.log(`✓ Chrome for Testing ${PINNED_BROWSER.buildId} is already installed: ${existing}`);
  process.exit(0);
}
const platform = detectBrowserPlatform();
if (!platform) {
  console.error('✗ This platform has no Chrome for Testing build. Install Chrome or Chromium and set CHROME_PATH.');
  process.exit(2);
}
console.log(`Downloading Chrome for Testing ${PINNED_BROWSER.buildId} (${platform}) into .cache/browsers/ …`);
const installed = await install({ ...PINNED_BROWSER, platform });
console.log(`✓ Installed: ${installed.executablePath}`);
