import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS dependency injection relies on emitDecoratorMetadata, which esbuild
  // (vitest's default transformer) does not support. unplugin-swc emits the
  // design:paramtypes metadata so constructor injection resolves correctly.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['src/**/tests/*-integration.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run integration specs serially: they share one Postgres test DB and
    // each spec truncates tables in beforeEach, so parallel files would race.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      RELEASE_GIT_SHA: process.env['RELEASE_GIT_SHA'] ?? '0000000000000000000000000000000000000000',
      DATABASE_URL: process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'] ?? '',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      APP_ENCRYPTION_KEY: process.env['APP_ENCRYPTION_KEY'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      JWT_SECRET: process.env['JWT_SECRET'] ?? 'integration-test-jwt-secret',
      APP_PLATFORM_CURRENCY: process.env['APP_PLATFORM_CURRENCY'] ?? 'CNY',
      // Keep payment confirmation disabled by default so the UPSTREAM_DISABLED
      // case is exercised. The "confirm enabled" case is skipped (see spec).
      PAYMENT_CONFIRMATION_ENABLED: process.env['PAYMENT_CONFIRMATION_ENABLED'] ?? 'false',
    },
  },
});
