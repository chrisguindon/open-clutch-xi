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
 * Who is drawn on the pitch: women's teams, men's teams, or mixed squads (a setting).
 *
 * This is **presentation only**. The simulation (src/sim/) never sees it: every player, whatever body
 * they are drawn with, has exactly the same speed, strength, stamina, skill and AI. Appearance is also
 * never derived from nationality — the body pattern depends only on the setting and the squad position,
 * and skin tones come from each team's shared, diverse palette.
 *
 * Pure functions without Three.js, so tests can check them directly.
 */
import type { BodyType } from './assets';

/** The team-composition setting. */
export type SquadMix = 'mixed' | 'women' | 'men';

/** Button labels for the Teams setting. */
export const SQUAD_LABELS: Record<SquadMix, string> = { mixed: 'Mixed', women: 'Women', men: 'Men' };

/**
 * The body a player is drawn with. Mixed squads alternate down the squad list, offset between the two
 * teams, so both teams (and both goalkeepers' sides) are mixed in every format: 3v3, 5v5 and 11v11.
 * @param index - the player's position in their squad list (0 = goalkeeper)
 */
export function bodyFor(mix: SquadMix, team: 0 | 1, index: number): BodyType {
  if (mix === 'women') return 'f';
  if (mix === 'men') return 'm';
  return (index + team) % 2 === 0 ? 'm' : 'f';
}

/** The CC0 hairstyles available (null = none). */
export type HairStyle = 'Hair_Buzzed' | 'Hair_BuzzedFemale' | 'Hair_SimpleParted' | 'Hair_Long' | 'Hair_Buns' | null;

/**
 * Hairstyle pools per body, picked from deterministically per player. Both pools have short, medium,
 * long and tied-back hair (anyone can have any length); only the mix differs. The short buzz cut comes
 * in two versions modelled for each head shape. `null` is an intentional shaved head. Beards are only
 * offered on the 'm' body, because the beard mesh was modelled for its face.
 */
export const HAIR_POOLS: Record<BodyType, readonly HairStyle[]> = {
  m: ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Buzzed', 'Hair_SimpleParted', null, 'Hair_Buns', 'Hair_Long'],
  f: ['Hair_Long', 'Hair_Buns', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Buns', 'Hair_Long'],
};
