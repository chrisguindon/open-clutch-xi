/*
 * Copyright (c) 2026 Christopher Guindon
 *
 * This program and the accompanying materials are made available
 * under the terms of the Eclipse Public License 2.0,
 * which is available at https://www.eclipse.org/legal/epl-2.0/.
 *
 * SPDX-License-Identifier: EPL-2.0
 */

// ESLint flat config. Run from the repository root with `npm run lint`.
// Rules are deliberately few: they catch real bugs and keep the code readable for learners,
// without style debates (formatting is Prettier's job).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.cache/**',
      'tools/**',
      'public/**',
      'screenshots/**',
      'test-results/**',
      'asset-src/**',
      'benchmark/**',
      '.local/**',
      'release/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Narrow, documented escapes are allowed (tests and dev tools poke at internals).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    // Type-aware rules, limited to the two that catch real bugs in a game full of async loading (assets,
    // audio, fonts): a promise nobody awaits or catches fails silently, and an async function passed
    // where a plain callback is expected (an event listener) loses its errors. Both had zero violations
    // when enabled. Broader type-checked presets were evaluated and rejected: mostly style noise, and slower
    // (see docs/development/CODING_STANDARDS.md#tooling).
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: new URL('../..', import.meta.url).pathname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tools/**/*.mjs', '*.config.*'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['tests/**/*.ts', 'src/dev/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
