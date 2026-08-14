import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  RELEASE_GIT_SHA: z.string().default(process.env['RAILWAY_GIT_COMMIT_SHA'] ?? ''),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key'),
  JWT_SECRET: z.string().min(16),
  APP_PLATFORM_CURRENCY: z.string().length(3),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(120),
  API_RATE_LIMIT_ORDER_MAX_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(10),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  OPENAPI_EXPOSURE_ENABLED: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z.string().default(''),
  LEGACY_API_V1_ENABLED: z.enum(['true', 'false']).default('false'),
  LEGACY_API_SITE_ID: z.string().default(''),
  ALLOW_PLACEHOLDER_APIKEYS: z.enum(['true', 'false']).default('false'),
  ALLOW_LOCAL_DEV_APIKEY: z.enum(['true', 'false']).default('false'),
  PAYMENT_CONFIRMATION_ENABLED: z.enum(['true', 'false']).default('false'),
  PROVIDER_FULFILLMENT_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST: z.string().default(''),
  PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST: z.string().default(''),
  DEDICATED_LINE_ORDER_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST: z.string().default(''),
  DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST: z.string().default(''),
  DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  DEDICATED_LINE_HEALTH_EXECUTION_ENABLED: z.enum(['true', 'false']).default('false'),
  BARK_ALERTS_ENABLED: z.enum(['true', 'false']).default('false'),
  BARK_SERVER_URL: z.string().url().default('https://api.day.app'),
  BARK_DEVICE_KEYS: z.string().default(''),
  BARK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  PROVIDER_INVENTORY_SYNC_ENABLED: z.enum(['true', 'false']).default('true'),
  DATABASE_INVENTORY_FRESHNESS_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  WORKER_FULFILLMENT_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  WORKER_FULFILLMENT_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_DEDICATED_LINE_ORDER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  WORKER_DEDICATED_LINE_ORDER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  CONTROL_NODE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  WORKER_DEDICATED_LINE_PROJECTION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_DEDICATED_LINE_MIGRATION_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  WORKER_DEDICATED_LINE_MIGRATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_BARK_OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(5_000),
  WORKER_BARK_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_INVENTORY_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
  PROXY_CHECK_TARGET_URL: z.string().url().default('http://api.ipify.org/?format=json'),
  PROXY_CHECK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL: z.string().url().default('http://127.0.0.1:18080/health'),
  DEDICATED_LINE_MIGRATION_SMOKE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
});

export type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Environment validation failed:', result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const env: EnvConfig = parseEnv();
