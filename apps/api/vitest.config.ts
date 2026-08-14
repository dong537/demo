import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts', 'src/**/tests/*-integration.spec.ts', 'dist/**', 'generated/**'],
    coverage: {
      provider: 'v8',
      exclude: ['**/generated/**', '**/dist/**', '**/*.d.ts'],
      thresholds: { statements: 80, branches: 70 },
    },
  },
});
