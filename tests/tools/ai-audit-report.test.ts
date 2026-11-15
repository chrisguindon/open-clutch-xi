/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// Opt-in report: AI_AUDIT=1 npx vitest run tests/tools/ai-audit-report.test.ts
import { it } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { runAudit } from '../../src/dev/aiAudit';

it.skipIf(!process.env.AI_AUDIT)(
  'AI decision audit report',
  () => {
    mkdirSync('test-results', { recursive: true });
    const out = process.env.AI_AUDIT_OUT || 'test-results/ai-audit.log';
    const log = (t: string) => appendFileSync(out, t + '\n');
    const seeds = Array.from({ length: Number(process.env.AI_AUDIT_N || 8) }, (_, i) => 100 + i);
    for (const format of ['5v5', '11v11'] as const) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const r = runAudit({ seeds, format, difficulty, seconds: 240 });
        log(
          `${format} ${difficulty}: kicks ${r.kicks} passCompletion ${r.passCompletion} goals ${r.goals} shots ${r.shots} per100 ${JSON.stringify(r.per100)}`,
        );
        if (process.env.AI_AUDIT_EX) log(JSON.stringify(r.examples, null, 1));
      }
    }
  },
  600000,
);
