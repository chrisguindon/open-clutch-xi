/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

export type KitPatternName = 'solid' | 'stripes' | 'hoops' | 'halves' | 'sash' | 'sleeves' | 'checks';

export interface AwayKit {
  primary: string;
  secondary: string;
  shorts: string;
  socks: string;
  pattern: KitPatternName;
  trim: string;
}

/** A team's identity: colours, kits and appearance palette. The national teams are defined in nations.ts. */
export interface TeamIdentity {
  id: string;
  name: string;
  short: string;
  primary: string;
  secondary: string;
  shorts: string;
  socks: string;
  keeper: string;
  skinTones: string[];
  /** Shirt design (see render/characters/kitMaterial.ts). */
  pattern: KitPatternName;
  trim: string;
  boots: string;
  /** National teams: ISO 3166 code (flag-icons naming), region, flag image and change kit. */
  iso?: string;
  region?: string;
  flag?: string;
  away?: AwayKit;
}

const FIRST = [
  'Leo',
  'Mateo',
  'Kai',
  'Jonas',
  'Rafa',
  'Theo',
  'Nico',
  'Ola',
  'Sami',
  'Iker',
  'Tomas',
  'Yuto',
  'Emil',
  'Dario',
  'Malik',
  'Finn',
  'Andre',
  'Ravi',
  'Luca',
  'Ezra',
  'Omar',
  'Bruno',
];
const LAST = [
  'Varga',
  'Okafor',
  'Lindqvist',
  'Moreau',
  'Silva',
  'Brandt',
  'Kowal',
  'Haddad',
  'Tanaka',
  'Duarte',
  'Novak',
  'Mensah',
  'Ferro',
  'Castell',
  'Ivers',
  'Rahman',
  'Quinn',
  'Adeyemi',
  'Sato',
  'Barros',
  'Holm',
  'Petrov',
];

export function playerName(teamIdx: number, i: number): string {
  const a = FIRST[(teamIdx * 7 + i * 3) % FIRST.length];
  const b = LAST[(teamIdx * 5 + i * 7 + 3) % LAST.length];
  return `${a[0]}. ${b}`;
}
