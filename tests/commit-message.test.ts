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
// @ts-expect-error: plain ES module script without type declarations
import { aiAttribution, checkMessage } from '../scripts/check-commit-message.mjs';

const msg = (body: string) => `fix(ai): stop clearances towards our own goal\n\n${body}`;

describe('commit messages: automatic AI attribution is rejected', () => {
  it.each([
    ['Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'],
    ['Co-authored-by: GitHub Copilot <copilot@github.com>'],
    ['Co-authored-by: Someone <noreply@anthropic.com>'],
    ['🤖 Generated with [Claude Code](https://claude.com/claude-code)'],
    ['Generated with ChatGPT'],
    ['https://claude.ai/code/session_01AbCdEf'],
    ['Claude-Session: https://claude.ai/code/session_01AbCdEf'],
  ])('rejects %s', (trailer) => {
    expect(aiAttribution(msg(trailer)).length).toBeGreaterThan(0);
    expect(checkMessage(msg(trailer)).some((p: string) => p.includes('AI-vendor'))).toBe(true);
  });

  it.each([
    ['Co-authored-by: Jane Doe <jane@example.org>'],
    ['We drafted these tests with Claude and reviewed every line by hand.'],
    ['Copyright (c) 2024 Some Author. Licensed under the MIT licence.'],
    ['See https://claude.com/claude-code for the tool we use (docs only).'],
  ])('allows %s', (body) => {
    expect(checkMessage(msg(body))).toEqual([]);
  });

  it('still enforces the Conventional Commit header', () => {
    expect(checkMessage('Fixed stuff')).not.toEqual([]);
    expect(checkMessage('chore: establish initial Open Clutch XI project baseline')).toEqual([]);
  });
});
