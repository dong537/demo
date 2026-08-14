/**
 * Integration test helpers.
 *
 * These run against a REAL PostgreSQL test database (no prisma mocking).
 * Connection comes from DATABASE_URL (injected by vitest.integration.config.ts
 * from DATABASE_URL_TEST).
 *
 * createTestApp() replicates the production bootstrap in src/main.ts:
 *   - global prefix 'api' (excluding health/ready and 985-compatible res_static)
 *   - EnvelopeInterceptor (wraps responses in { code, msg, data, requestId })
 *   - AppExceptionFilter (maps AppError -> { code: <ErrorCode>, msg, data, requestId })
 * Without this replication, routes 404 and error bodies have no `code` field.
 */
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Test } from '@nestjs/testing';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import supertest from 'supertest';
import { prisma } from '@ipeasy/db';
import { AppModule } from '../app.module';
import { EnvelopeInterceptor } from '../common/interceptors/envelope.interceptor';
import { AppExceptionFilter } from '../common/errors/exception-filter';
import { ConfigService } from '../common/config/config.service';
import type { EnvConfig } from '../common/config/env.schema';
import { configureGlobalPrefix } from '../common/http/res-static-compat';
import { encryptAesGcm } from '../common/crypto/aes-gcm';

export type TestRequest = ReturnType<typeof supertest>;

export async function createTestApp(options?: {
  config?: Partial<EnvConfig>;
  beforeInit?: (app: NestFastifyApplication) => void;
}): Promise<NestFastifyApplication> {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options?.config) {
    builder.overrideProvider(ConfigService).useValue({
      get<T extends keyof EnvConfig>(key: T): EnvConfig[T] {
        return (options.config?.[key] ?? process.env[key] ?? defaultTestConfig[key]) as EnvConfig[T];
      },
    });
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  configureGlobalPrefix(app);
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter());
  options?.beforeInit?.(app);

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

// All tables, truncated together with CASCADE so FK ordering does not matter.
const ALL_TABLES = [
  'dedicated_line_migration_recommendation_nodes',
  'dedicated_line_migration_recommendations',
  'control_node_health_observations',
  'dedicated_line_smoke_observations',
  'dedicated_line_migration_nodes',
  'dedicated_line_migrations',
  'dedicated_line_domains',
  'line_placement_policy_nodes',
  'outbox_events',
  'external_jobs',
  'stock_reservations',
  'dedicated_line_inventory_snapshots',
  'delivery_route_targets',
  'delivery_route_domains',
  'delivery_routes',
  'delivery_route_imports',
  'dedicated_line_exit_assignments',
  'dedicated_line_projections',
  'dedicated_line_placement_nodes',
  'dedicated_line_placements',
  'dedicated_lines',
  'dedicated_line_orders',
  'line_placement_policies',
  'inbound_profiles',
  'control_nodes',
  'node_groups',
  'exit_health_observations',
  'residential_exits',
  'user_sku_price_overrides',
  'sku_price_overrides',
  'sku_price_rules',
  'service_skus',
  'ledger_entries',
  'wallets',
  'payment_orders',
  'proxy_instances',
  'upstream_order_mirrors',
  'fulfillment_jobs',
  'orders',
  'notifications',
  'ticket_messages',
  'tickets',
  'user_resource_price_overrides',
  'user_price_bindings',
  'price_overrides',
  'price_rules',
  'price_templates',
  'resource_mappings',
  'inventory_snapshots',
  'platform_resources',
  'provider_accounts',
  'upstream_request_logs',
  'upstream_api_accounts',
  'federated_upstream_scans',
  'federated_upstream_connections',
  'system_settings',
  'site_announcements',
  'audit_logs',
  'sessions',
  'api_keys',
  'admin_users',
  'users',
  'tenants',
  'sites',
];

export async function cleanDatabase(): Promise<void> {
  const list = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let siteSeq = 0;

export async function seedSite(): Promise<string> {
  siteSeq += 1;
  const suffix = `${Date.now()}_${siteSeq}`;
  const site = await prisma.sites.create({
    data: {
      code: `site_${suffix}`,
      name: `Test Site ${suffix}`,
      domain: `test-${Date.now()}-${siteSeq}.example.com`,
      status: 'ACTIVE',
    },
  });
  return site.id;
}

let tenantSeq = 0;

export async function seedTenant(siteId: string): Promise<string> {
  tenantSeq += 1;
  const tenant = await prisma.tenants.create({
    data: {
      siteId,
      code: `tenant_${tenantSeq}_${Date.now()}`,
      name: `Test Tenant ${tenantSeq}`,
      status: 'ACTIVE',
    },
  });
  return tenant.id;
}

export async function seedUser(
  siteId: string,
  tenantId: string,
  opts: { email: string; password: string; currency?: string },
): Promise<{ userId: string; walletId: string }> {
  const passwordHash = await bcrypt.hash(opts.password, 4);
  const user = await prisma.users.create({
    data: {
      siteId,
      tenantId,
      email: opts.email,
      passwordHash,
      status: 'ACTIVE',
      kycStatus: 'NONE',
      riskStatus: 'NORMAL',
    },
  });
  const wallet = await prisma.wallets.create({
    data: {
      siteId,
      tenantId,
      userId: user.id,
      available: '0',
      frozen: '0',
      currency: opts.currency ?? 'CNY',
    },
  });
  return { userId: user.id, walletId: wallet.id };
}

export async function seedAdminUser(
  siteId: string,
  tenantId: string | null,
  role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'OPERATOR',
  opts: { email: string; password: string },
): Promise<string> {
  const passwordHash = await bcrypt.hash(opts.password, 4);
  const admin = await prisma.admin_users.create({
    data: {
      siteId,
      tenantId,
      email: opts.email,
      passwordHash,
      role,
      status: 'ACTIVE',
    },
  });
  return admin.id;
}

export async function seedSession(opts: {
  ownerType: 'USER' | 'ADMIN_USER';
  ownerId: string;
  siteId: string;
  tenantId: string | null;
  expiresAt?: Date;
  revokedAt?: Date | null;
}): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString('hex');
  const session = await prisma.sessions.create({
    data: {
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      siteId: opts.siteId,
      tenantId: opts.tenantId,
      token: sha256(token),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: opts.revokedAt,
    },
  });
  return { token, sessionId: session.id };
}

export async function seedApiKey(opts: {
  siteId: string;
  tenantId: string;
  ownerId: string;
  ownerType: 'USER' | 'TENANT_ADMIN';
  name?: string;
  scopes: string[];
  ipWhitelist?: string[];
  status?: 'ACTIVE' | 'REVOKED';
}): Promise<{ plainKey: string; apiKeyId: string }> {
  const plainKey = randomBytes(32).toString('hex');
  const apiKey = await prisma.api_keys.create({
    data: {
      siteId: opts.siteId,
      tenantId: opts.tenantId,
      ownerId: opts.ownerId,
      ownerType: opts.ownerType,
      name: opts.name ?? `API Key ${Date.now()}`,
      keyHash: sha256(plainKey),
      keyPrefix: plainKey.slice(0, 8),
      scopes: opts.scopes,
      ipWhitelist: opts.ipWhitelist ?? [],
      status: opts.status ?? 'ACTIVE',
    },
  });
  return { plainKey, apiKeyId: apiKey.id };
}

/**
 * Seeds a fully-linked proxy_instances row (resource -> order -> fulfillment job
 * -> upstream mirror -> proxy). Password is stored AES-256-GCM encrypted, like
 * production delivery, so ownership/decryption paths are exercised end to end.
 */
export async function seedProxy(opts: {
  siteId: string;
  tenantId: string;
  userId: string;
  encryptionKey: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
  protocol?: 'HTTP' | 'SOCKS5';
}): Promise<{ proxyId: string }> {
  const suffix = randomBytes(6).toString('hex');
  const resource = await prisma.platform_resources.create({
    data: {
      siteId: opts.siteId,
      type: 'ZONE',
      code: `res_${suffix}`,
      name: `Resource ${suffix}`,
      providerCode: 'IPIPD',
      ipType: 'NATIVE',
      protocol: 'HTTP',
      status: 'ACTIVE',
    },
  });
  const order = await prisma.orders.create({
    data: {
      siteId: opts.siteId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      type: 'STATIC_PROXY_BUY',
      status: 'COMPLETED',
      resourceId: resource.id,
      quantity: 1,
      durationDays: 30,
      unitPrice: '1',
      totalPrice: '1',
      currency: 'CNY',
      quoteSnapshot: {},
      idempotencyKey: `idem_${suffix}`,
    },
  });
  const job = await prisma.fulfillment_jobs.create({
    data: {
      siteId: opts.siteId,
      orderId: order.id,
      providerCode: 'IPIPD',
      status: 'COMPLETED',
    },
  });
  const mirror = await prisma.upstream_order_mirrors.create({
    data: {
      siteId: opts.siteId,
      orderId: order.id,
      fulfillmentJobId: job.id,
      providerCode: 'IPIPD',
      upstreamOrderId: `up_${suffix}`,
      status: 'COMPLETED',
    },
  });
  const proxy = await prisma.proxy_instances.create({
    data: {
      siteId: opts.siteId,
      tenantId: opts.tenantId,
      userId: opts.userId,
      orderId: order.id,
      upstreamOrderMirrorId: mirror.id,
      providerCode: 'IPIPD',
      ip: opts.ip ?? '203.0.113.10',
      port: opts.port ?? 8080,
      username: opts.username ?? 'proxy-user',
      password: encryptAesGcm(opts.password ?? 'proxy-pass', opts.encryptionKey),
      protocol: opts.protocol ?? 'HTTP',
      countryCode: 'US',
      ipType: 'NATIVE',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { proxyId: proxy.id };
}

/**
 * Logs in via POST /api/auth/login and returns the plaintext session token.
 * Throws if login did not succeed so tests fail loudly instead of using an
 * empty token.
 */
export async function loginAs(
  request: TestRequest,
  email: string,
  password: string,
  siteId: string,
): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password, siteId });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`loginAs failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const token = res.body?.data?.token as string | undefined;
  if (!token) {
    throw new Error(`loginAs returned no token: ${JSON.stringify(res.body)}`);
  }
  return token;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const defaultTestConfig: EnvConfig = {
  NODE_ENV: 'test',
  RELEASE_GIT_SHA: '0'.repeat(40),
  PORT: 3000,
  DATABASE_URL: process.env['DATABASE_URL'] ?? process.env['DATABASE_URL_TEST'] ?? '',
  REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  APP_ENCRYPTION_KEY: process.env['APP_ENCRYPTION_KEY'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  JWT_SECRET: process.env['JWT_SECRET'] ?? 'integration-test-jwt-secret',
  APP_PLATFORM_CURRENCY: process.env['APP_PLATFORM_CURRENCY'] ?? 'CNY',
  API_RATE_LIMIT_WINDOW_MS: Number(process.env['API_RATE_LIMIT_WINDOW_MS'] ?? 60_000),
  API_RATE_LIMIT_MAX_REQUESTS: Number(process.env['API_RATE_LIMIT_MAX_REQUESTS'] ?? 120),
  API_RATE_LIMIT_ORDER_MAX_REQUESTS: Number(process.env['API_RATE_LIMIT_ORDER_MAX_REQUESTS'] ?? 10),
  API_BODY_LIMIT_BYTES: Number(process.env['API_BODY_LIMIT_BYTES'] ?? 1_048_576),
  OPENAPI_EXPOSURE_ENABLED: process.env['OPENAPI_EXPOSURE_ENABLED'] === 'true' ? 'true' : 'false',
  CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? '',
  LEGACY_API_V1_ENABLED: process.env['LEGACY_API_V1_ENABLED'] === 'true' ? 'true' : 'false',
  LEGACY_API_SITE_ID: process.env['LEGACY_API_SITE_ID'] ?? '',
  ALLOW_PLACEHOLDER_APIKEYS: 'false',
  ALLOW_LOCAL_DEV_APIKEY: 'false',
  PAYMENT_CONFIRMATION_ENABLED: process.env['PAYMENT_CONFIRMATION_ENABLED'] === 'true' ? 'true' : 'false',
  PROVIDER_FULFILLMENT_EXECUTION_ENABLED: process.env['PROVIDER_FULFILLMENT_EXECUTION_ENABLED'] === 'true' ? 'true' : 'false',
  PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST: process.env['PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST'] ?? '',
  PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST: process.env['PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST'] ?? '',
  DEDICATED_LINE_ORDER_EXECUTION_ENABLED: process.env['DEDICATED_LINE_ORDER_EXECUTION_ENABLED'] === 'true' ? 'true' : 'false',
  DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST: process.env['DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST'] ?? '',
  DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST: process.env['DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST'] ?? '',
  DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED: process.env['DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED'] === 'true' ? 'true' : 'false',
  DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED: process.env['DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED'] === 'true' ? 'true' : 'false',
  DEDICATED_LINE_HEALTH_EXECUTION_ENABLED: process.env['DEDICATED_LINE_HEALTH_EXECUTION_ENABLED'] === 'true' ? 'true' : 'false',
  BARK_ALERTS_ENABLED: process.env['BARK_ALERTS_ENABLED'] === 'true' ? 'true' : 'false',
  BARK_SERVER_URL: process.env['BARK_SERVER_URL'] ?? 'https://api.day.app',
  BARK_DEVICE_KEYS: process.env['BARK_DEVICE_KEYS'] ?? '',
  BARK_REQUEST_TIMEOUT_MS: Number(process.env['BARK_REQUEST_TIMEOUT_MS'] ?? 8_000),
  PROVIDER_INVENTORY_SYNC_ENABLED: process.env['PROVIDER_INVENTORY_SYNC_ENABLED'] === 'true' ? 'true' : 'false',
  DATABASE_INVENTORY_FRESHNESS_MS: Number(process.env['DATABASE_INVENTORY_FRESHNESS_MS'] ?? 3_600_000),
  WORKER_FULFILLMENT_POLL_INTERVAL_MS: Number(process.env['WORKER_FULFILLMENT_POLL_INTERVAL_MS'] ?? 5_000),
  WORKER_FULFILLMENT_BATCH_SIZE: Number(process.env['WORKER_FULFILLMENT_BATCH_SIZE'] ?? 20),
  WORKER_DEDICATED_LINE_ORDER_POLL_INTERVAL_MS: Number(process.env['WORKER_DEDICATED_LINE_ORDER_POLL_INTERVAL_MS'] ?? 5_000),
  WORKER_DEDICATED_LINE_ORDER_BATCH_SIZE: Number(process.env['WORKER_DEDICATED_LINE_ORDER_BATCH_SIZE'] ?? 20),
  CONTROL_NODE_REQUEST_TIMEOUT_MS: Number(process.env['CONTROL_NODE_REQUEST_TIMEOUT_MS'] ?? 10_000),
  WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS: Number(process.env['WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS'] ?? 5_000),
  WORKER_DEDICATED_LINE_PROJECTION_BATCH_SIZE: Number(process.env['WORKER_DEDICATED_LINE_PROJECTION_BATCH_SIZE'] ?? 20),
  WORKER_DEDICATED_LINE_MIGRATION_POLL_INTERVAL_MS: Number(process.env['WORKER_DEDICATED_LINE_MIGRATION_POLL_INTERVAL_MS'] ?? 5_000),
  WORKER_DEDICATED_LINE_MIGRATION_BATCH_SIZE: Number(process.env['WORKER_DEDICATED_LINE_MIGRATION_BATCH_SIZE'] ?? 20),
  WORKER_BARK_OUTBOX_POLL_INTERVAL_MS: Number(process.env['WORKER_BARK_OUTBOX_POLL_INTERVAL_MS'] ?? 5_000),
  WORKER_BARK_OUTBOX_BATCH_SIZE: Number(process.env['WORKER_BARK_OUTBOX_BATCH_SIZE'] ?? 20),
  WORKER_INVENTORY_SYNC_INTERVAL_MS: Number(process.env['WORKER_INVENTORY_SYNC_INTERVAL_MS'] ?? 300_000),
  PROXY_CHECK_TARGET_URL: process.env['PROXY_CHECK_TARGET_URL'] ?? 'http://api.ipify.org/?format=json',
  PROXY_CHECK_TIMEOUT_MS: Number(process.env['PROXY_CHECK_TIMEOUT_MS'] ?? 8_000),
  DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL: process.env['DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL'] ?? 'http://127.0.0.1:18080/health',
  DEDICATED_LINE_MIGRATION_SMOKE_TIMEOUT_MS: Number(process.env['DEDICATED_LINE_MIGRATION_SMOKE_TIMEOUT_MS'] ?? 8_000),
};
