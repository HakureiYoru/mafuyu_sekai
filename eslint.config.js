import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'docs/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { window: 'readonly', document: 'readonly', console: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', localStorage: 'readonly', navigator: 'readonly', fetch: 'readonly', AudioContext: 'readonly', ResizeObserver: 'readonly', AbortController: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', process: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
);
