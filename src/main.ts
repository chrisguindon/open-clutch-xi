/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Entry point: loads the font and styles, then hands the two page elements (#stage for the 3D view,
// #ui for menus and the HUD) to Game, which owns everything else. Kept tiny on purpose: start reading
// at src/game/game.ts.

import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import './ui/styles.css';
import { Game } from './game/game';

const stage = document.getElementById('stage');
const ui = document.getElementById('ui');
if (!stage || !ui) throw new Error('Missing #stage or #ui');

const game = new Game(stage, ui);
void game.init();
