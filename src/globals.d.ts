/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/** Source repository URL, injected at build time from package.json (empty until it is set). */
declare const __REPO_URL__: string;

/** Game version from package.json (shown on the About screen). */
declare const __APP_VERSION__: string;
