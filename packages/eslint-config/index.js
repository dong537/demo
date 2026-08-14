const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/**
 * Shared flat ESLint config for the IPEasy monorepo.
 *
 * @param {{ tsconfigRootDir: string, browser?: boolean }} opts
 *   tsconfigRootDir — the app root that holds its tsconfig.json (pass __dirname).
 *   browser — include browser globals (set true for the web app).
 */
module.exports = function createConfig({ tsconfigRootDir, browser = false }) {
  return [
    js.configs.recommended,
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: {
        '@typescript-eslint': tsPlugin,
      },
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
        globals: {
          console: 'readonly',
          process: 'readonly',
          Buffer: 'readonly',
          setTimeout: 'readonly',
          setInterval: 'readonly',
          clearTimeout: 'readonly',
          AbortController: 'readonly',
          fetch: 'readonly',
          Request: 'readonly',
          RequestInit: 'readonly',
          Response: 'readonly',
          URL: 'readonly',
          ...(browser
            ? {
                atob: 'readonly',
                document: 'readonly',
                window: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                URLSearchParams: 'readonly',
              }
            : {}),
        },
      },
      rules: {
        ...tsPlugin.configs.recommended.rules,
        'no-console': ['warn', { allow: ['error', 'info'] }],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
    {
      ignores: ['dist/**', 'generated/**', 'node_modules/**'],
    },
  ];
};
