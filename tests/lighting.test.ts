/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */
import { describe, expect, it } from 'vitest';
import { SKY_CAP } from '../src/render/environment';
import { BLOOM_THRESHOLD } from '../src/render/renderer';

describe('daylight glare guards', () => {
  // Regression: the daytime sky (and the haze it draws at and below the horizon) reached ~6× white, so it
  // saturated to white wherever the camera saw past the stands, and bloomed.
  it('the visible sky can never get bright enough to bloom', () => {
    for (const cap of Object.values(SKY_CAP)) expect(cap).toBeLessThan(BLOOM_THRESHOLD);
  });
  it('only HDR highlights (brighter than white) bloom, never ordinary lit surfaces', () => {
    expect(BLOOM_THRESHOLD).toBeGreaterThan(1);
  });
});
