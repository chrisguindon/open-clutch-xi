/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Finds a Chrome / Chromium / Edge executable for the browser checks on Linux, macOS and Windows.
// Set CHROME_PATH to override.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error('No Chrome/Chromium found. Install one or set CHROME_PATH to its executable.');
    process.exit(2);
  }
  return found;
}
