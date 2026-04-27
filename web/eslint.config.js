import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks 7.1 promoted multiple compiler-style rules
      // to error (set-state-in-effect, refs-as-pure, component-creation,
      // variable-declaration-order). They flag legitimate patterns
      // (fetch-on-mount, bridge effects, lazy component constructors) that
      // pre-date the rule. Demoted to warn so CI doesn't break on a plugin
      // upgrade; per-call eslint-disable encouraged when intentional.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      // react-refresh complains about non-component exports in component
      // files (utility functions, constants). Pre-existing pattern across
      // the codebase; demoted to warn.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
