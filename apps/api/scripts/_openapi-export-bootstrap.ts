// Side-effecting module: import FIRST in export-openapi.ts.
// OpenAPI export is an offline schema task, so it should not require operator
// secrets or a reachable database just to evaluate env.schema.ts.
import 'reflect-metadata';

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
  REDIS_URL: 'redis://localhost:6379',
  APP_ENCRYPTION_KEY: 'synthetic-openapi-export-encryption-key',
  JWT_SECRET: 'synthetic-openapi-export-jwt-secret',
  APP_PLATFORM_CURRENCY: 'CNY',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
