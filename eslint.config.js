import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Custom rule activated by PR 5 (migration 0012). Flags reads of columns
// that 0012 dropped from ProjectRow / ServiceRow shapes.
const noDroppedColumnsRule = require('./eslint-rules/no-dropped-columns.cjs');

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'dist/',
      'node_modules/',
      'test/',
      'coverage/',
      '*.config.*',
      'web/dist/',
      'web/node_modules/',
      // Web files are linted via `web/eslint.config.js` because their
      // React plugins (react-hooks, react-refresh) are only installed
      // under web/node_modules. Root-level eslint (incl. lint-staged
      // running from the repo root) skips them entirely; pre-commit
      // delegates web linting to a `cd web && eslint --fix` wrapper.
      'web/src/',
    ],
  },
  // Root src/ - TypeScript strict mode
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      eslintConfigPrettier,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'openlander-internal': {
        rules: {
          'no-dropped-columns': noDroppedColumnsRule,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'openlander-internal/no-dropped-columns': 'warn',
      // Deprecated fields on ProjectRow/ServiceRow are intentional 1.0 back-compat
      // shims (0012 Phase G). The custom no-dropped-columns rule is the enforcement
      // gate; no-deprecated would produce noise on every transitional read site.
      '@typescript-eslint/no-deprecated': 'warn',
    },
  },
);
