/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * When to show the controlled player's name over the pitch.
 *
 * On a big screen a small name above your player is handy and costs little. On a phone it doesn't
 * work: with the camera far enough out to show the play, a player is about 12 px wide and 25 px tall,
 * while the name box is around 100 px wide. It sat right where the players further up the pitch are,
 * and it repeated what the HUD's player card already says. So on small or touch screens the name only
 * appears briefly, when the controlled player changes (a switch, or kick-off), and then fades away:
 * the ring at the player's feet marks who you control, and the player card names them.
 *
 * Decided from the game's actual layout (touch controls on screen, or a small window), never from the
 * browser's user agent. Pure functions, so the rules are unit-tested (tests/player-label.test.ts).
 */

/** 'always': keep the name over the controlled player. 'brief': show it only after a change of player. */
export type PlayerLabelMode = 'always' | 'brief';

/** How long a brief name stays up after the controlled player changes, in seconds. */
export const BRIEF_LABEL_SECONDS = 1.6;
/** The last part of that time, in seconds, during which the name fades out (unless motion is reduced). */
export const BRIEF_LABEL_FADE = 0.4;
/**
 * A window whose shorter side is below this many CSS pixels counts as small, even with a mouse (a
 * phone-sized browser window, or a small laptop window snapped to a corner).
 */
export const SMALL_SCREEN_SHORT_SIDE = 500;

/** The label mode for the current layout. */
export function playerLabelMode(layout: { touchControls: boolean; width: number; height: number }): PlayerLabelMode {
  return layout.touchControls || Math.min(layout.width, layout.height) < SMALL_SCREEN_SHORT_SIDE ? 'brief' : 'always';
}

/**
 * The game time when a brief name cue began. During the pre-match intro the initial cue waits until
 * the gameplay camera takes over; later player changes start a fresh cue immediately.
 */
export function playerLabelCueTime(previousName: string | null, currentName: string | null, changedAt: number, now: number, introActive: boolean): number {
  if (!currentName || introActive) return changedAt;
  return currentName !== previousName || changedAt === -Infinity ? now : changedAt;
}

/**
 * The name's opacity, from 0 (hidden) to 1, given the mode and how long ago the controlled player
 * changed. With reduced motion a brief name simply disappears at the end instead of fading.
 */
export function playerLabelOpacity(mode: PlayerLabelMode, secondsSinceChange: number, reduceMotion = false): number {
  if (mode === 'always') return 1;
  if (secondsSinceChange < 0 || secondsSinceChange >= BRIEF_LABEL_SECONDS) return 0;
  const fadeStart = BRIEF_LABEL_SECONDS - BRIEF_LABEL_FADE;
  if (reduceMotion || secondsSinceChange <= fadeStart) return 1;
  return 1 - (secondsSinceChange - fadeStart) / BRIEF_LABEL_FADE;
}
