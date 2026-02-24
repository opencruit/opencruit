import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', '**/build/', '**/.svelte-kit/', '**/.turbo/', '**/coverage/']),
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/no-at-html-tags': 'warn',
    },
  },
  eslintConfigPrettier,
);
