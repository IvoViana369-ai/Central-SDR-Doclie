// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Regras de fronteira (docs/ARCHITECTURE.md §5.3):
 * 1. packages/core não importa framework, UI, adaptadores nem SDKs de terceiros.
 * 2. Um módulo do core só acessa outro módulo pelo seu index.ts público.
 * 3. Chamadas a serviços externos existem somente em packages/integrations.
 */
const externalSdks = [
  'next',
  'next/*',
  'react',
  'react-dom',
  'better-auth',
  'better-auth/*',
  'pg-boss',
  'nodemailer',
  '@anthropic-ai/*',
  '@sentry/*',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/src/generated/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@docline/integrations',
              message: 'O core usa portas (src/ports), nunca adaptadores.',
            },
          ],
          patterns: [
            {
              group: externalSdks,
              message: 'O core não depende de framework/SDK externo (ARCHITECTURE §5.3).',
            },
            {
              regex: '^\\.\\./\\.\\./[^/]+/(domain|application|infra|contracts)(/|$)',
              message: 'Acesse outro módulo apenas pelo seu index.ts público.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/worker/src/**/*.ts', 'packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom'],
              message: 'Sem UI fora do apps/web.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: ['**/scripts/**/*.ts', '**/seed/**/*.ts', 'apps/web/e2e/**/*.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
