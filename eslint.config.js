import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  // OpenTUI JSX intrinsic elements resolve to error type in ESLint's type checker
  // because @opentui/solid's jsx-runtime.d.ts uses a standalone JSX namespace
  // that ESLint's projectService doesn't fully resolve. These rules are disabled
  // only for TUI files where JSX is used.
  {
    files: ['src/tui/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'web/', 'test/', 'coverage/', '*.config.*'],
  },
);
