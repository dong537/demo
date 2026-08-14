import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['dist/**'],
    coverage: {
      provider: 'v8',
      exclude: ['**/dist/**', '**/*.d.ts'],
    },
  },
});
