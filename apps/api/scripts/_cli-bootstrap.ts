// Side-effecting module: must be imported FIRST in every CLI script (before
// any import that transitively pulls in src/common/config/env.schema, which
// validates process.env at import time).
//
// DATABASE_URL and APP_ENCRYPTION_KEY are operator-supplied secrets and are
// intentionally NOT defaulted. Everything else gets a safe dev default so the
// minimal Nest context can boot for offline/ops tasks.
import 'reflect-metadata';

const DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'cli-script-placeholder-secret',
  APP_PLATFORM_CURRENCY: 'CNY',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}

const REQUIRED = ['DATABASE_URL', 'APP_ENCRYPTION_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Provide them inline, e.g. DATABASE_URL=... APP_ENCRYPTION_KEY=... pnpm --filter @ipeasy/api <script>');
  process.exit(2);
}
