import { execFileSync } from 'node:child_process';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@ipeasy/db';
import { encryptAesGcm } from '../apps/api/src/common/crypto/aes-gcm';

const DATABASE_URL = process.env['DATABASE_URL_TEST'] ?? process.env['DATABASE_URL'];
const ADMIN_EMAIL = 'admin.e2e@example.com';
const ADMIN_PASSWORD = 'Admin123!';
const CUSTOMER_EMAIL = 'customer.e2e@example.com';
const CUSTOMER_PASSWORD = 'Customer123!';
const E2E_ENCRYPTION_KEY = process.env['APP_ENCRYPTION_KEY'] ?? '0'.repeat(64);

const SITE_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';
const PRICE_TEMPLATE_ID = '66666666-6666-6666-6666-666666666666';
const PROVIDER_ACCOUNT_IDS = {
  pr: '55555555-5555-5555-5555-555555555555',
  ipipd: '55555555-5555-5555-5555-555555555556',
  proxy985: '55555555-5555-5555-5555-555555555557',
};
const RESOURCE_IDS = {
  usNy: '77777777-7777-7777-7777-777777777771',
  usLa: '77777777-7777-7777-7777-777777777772',
  jpTokyo: '77777777-7777-7777-7777-777777777773',
  sg: '77777777-7777-7777-7777-777777777774',
  hk: '77777777-7777-7777-7777-777777777775',
};
const ORDER_ID = '88888888-8888-8888-8888-888888888881';
const PAYMENT_ORDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const PROXY_ID = '99999999-9999-9999-9999-999999999991';
const API_KEY_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const TICKET_ID = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const MIRROR_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
const FULFILLMENT_JOB_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';

const ALL_TABLES = [
  'ticket_messages',
  'notifications',
  'upstream_order_mirrors',
  'fulfillment_jobs',
  'proxy_instances',
  'orders',
  'price_overrides',
  'user_resource_price_overrides',
  'user_price_bindings',
  'price_rules',
  'price_templates',
  'inventory_snapshots',
  'resource_mappings',
  'platform_resources',
  'provider_accounts',
  'upstream_request_logs',
  'upstream_api_accounts',
  'payment_orders',
  'ledger_entries',
  'wallets',
  'tickets',
  'api_keys',
  'audit_logs',
  'sessions',
  'admin_users',
  'users',
  'tenants',
  'sites',
] as const;

export default async function globalSetup(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST or DATABASE_URL is required for Playwright E2E.');
  }

  process.env['DATABASE_URL'] = DATABASE_URL;
  const migrateCommand = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const migrateArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', '--filter', '@ipeasy/db', 'migrate:deploy']
    : ['--filter', '@ipeasy/db', 'migrate:deploy'];
  execFileSync(migrateCommand, migrateArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  await cleanDatabase();

  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  const customerPasswordHash = await bcrypt.hash(CUSTOMER_PASSWORD, 4);
  const now = new Date();

  const site = await prisma.sites.create({
    data: {
      id: SITE_ID,
      code: 'E2E',
      name: 'E2E Site',
      domain: 'localhost',
      status: 'ACTIVE',
      brandConfig: {
        name: 'IPEasy E2E',
        siteName: 'IPEasy E2E',
        primaryColor: '#0040ff',
        footerText: 'E2E seed site',
        publicCountries: [
          {
            countryCode: 'US',
            countryName: '美国',
            availableQuantity: 2,
            cities: [
              { cityCode: 'US-NY', cityName: '纽约' },
              { cityCode: 'US-LA', cityName: '洛杉矶' },
            ],
          },
          {
            countryCode: 'JP',
            countryName: '日本',
            availableQuantity: 1,
            cities: [
              { cityCode: 'JP-TYO', cityName: '东京' },
            ],
          },
          {
            countryCode: 'SG',
            countryName: '新加坡',
            availableQuantity: 1,
            cities: [{ cityCode: 'SG-SIN', cityName: '新加坡' }],
          },
        ],
      },
    },
  });

  const tenant = await prisma.tenants.create({
    data: {
      id: TENANT_ID,
      siteId: site.id,
      code: 'E2E_TENANT',
      name: 'E2E Tenant',
      status: 'ACTIVE',
    },
  });

  await prisma.admin_users.create({
    data: {
      id: ADMIN_ID,
      siteId: site.id,
      tenantId: null,
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
      role: 'PLATFORM_ADMIN',
      status: 'ACTIVE',
    },
  });

  const customer = await prisma.users.create({
    data: {
      id: CUSTOMER_ID,
      siteId: site.id,
      tenantId: tenant.id,
      email: CUSTOMER_EMAIL,
      passwordHash: customerPasswordHash,
      status: 'ACTIVE',
      kycStatus: 'NONE',
      riskStatus: 'NORMAL',
    },
  });

  await prisma.wallets.create({
    data: {
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      available: '321.45',
      frozen: '0',
      currency: 'CNY',
    },
  });

  await prisma.provider_accounts.createMany({
    data: [
      {
        id: PROVIDER_ACCOUNT_IDS.pr,
        siteId: site.id,
        tenantId: null,
        providerCode: 'PR',
        status: 'ACTIVE',
        credentialEncrypted: 'seed',
        baseUrl: 'https://proxy-seller.com/personal/api/v1',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: ['SG', 'TH', 'PL', 'BR', 'TR', 'IL', 'NL', 'IN', 'CA', 'AT', 'RO', 'LV', 'UA'],
      },
      {
        id: PROVIDER_ACCOUNT_IDS.ipipd,
        siteId: site.id,
        tenantId: null,
        providerCode: 'IPIPD',
        status: 'ACTIVE',
        credentialEncrypted: 'seed',
        baseUrl: 'https://api.ipipd.cn',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: ['GB', 'FR', 'DE', 'IT', 'ES', 'JP', 'HK', 'VN', 'KR', 'AE', 'ZA'],
      },
      {
        id: PROVIDER_ACCOUNT_IDS.proxy985,
        siteId: site.id,
        tenantId: null,
        providerCode: 'NINE_EIGHT_FIVE',
        status: 'ACTIVE',
        credentialEncrypted: 'seed',
        baseUrl: 'https://open-api.985proxy.com',
        timeoutMs: 15000,
        inventorySyncEnabled: true,
        enabledCountryCodes: ['TW', 'PH', 'MY', 'AU', 'ID'],
      },
    ],
  });

  await prisma.price_templates.create({
    data: {
      id: PRICE_TEMPLATE_ID,
      siteId: site.id,
      tenantId: tenant.id,
      name: 'E2E 默认价格模板',
      description: 'E2E seed template',
      isDefault: true,
    },
  });

  await prisma.platform_resources.createMany({
    data: [
      {
        id: RESOURCE_IDS.usNy,
        siteId: site.id,
        parentId: null,
        type: 'COUNTRY',
        code: 'US:NYC',
        name: '美国-纽约-推荐',
        displayName: '美国纽约推荐',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        sortOrder: 1,
        upstreamCost: '7',
        upstreamCostCurrency: 'CNY',
        isVisible: true,
        isSaleable: true,
      },
      {
        id: RESOURCE_IDS.usLa,
        siteId: site.id,
        parentId: null,
        type: 'COUNTRY',
        code: 'US:LA',
        name: '美国-洛杉矶-普通',
        displayName: '美国洛杉矶普通',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        sortOrder: 2,
        upstreamCost: '14',
        upstreamCostCurrency: 'CNY',
        isVisible: true,
        isSaleable: true,
      },
      {
        id: RESOURCE_IDS.jpTokyo,
        siteId: site.id,
        parentId: null,
        type: 'COUNTRY',
        code: 'JP:TYO',
        name: '日本-东京',
        displayName: '日本东京',
        providerCode: 'IPIPD',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        sortOrder: 3,
        upstreamCost: '18',
        upstreamCostCurrency: 'CNY',
        isVisible: true,
        isSaleable: true,
      },
      {
        id: RESOURCE_IDS.sg,
        siteId: site.id,
        parentId: null,
        type: 'COUNTRY',
        code: 'SG:SIN',
        name: '新加坡',
        displayName: '新加坡',
        providerCode: 'PR',
        ipType: 'NATIVE',
        protocol: 'BOTH',
        status: 'ACTIVE',
        sortOrder: 4,
        upstreamCost: '21',
        upstreamCostCurrency: 'CNY',
        isVisible: true,
        isSaleable: true,
      },
      {
        id: RESOURCE_IDS.hk,
        siteId: site.id,
        parentId: null,
        type: 'COUNTRY',
        code: 'HK:HKG',
        name: '中国香港',
        displayName: '中国香港',
        providerCode: 'NINE_EIGHT_FIVE',
        ipType: 'NATIVE',
        protocol: 'SOCKS5',
        status: 'ACTIVE',
        sortOrder: 5,
        upstreamCost: '28',
        upstreamCostCurrency: 'CNY',
        isVisible: true,
        isSaleable: true,
      },
    ],
  });

  await prisma.resource_mappings.createMany({
    data: [
      { siteId: site.id, resourceId: RESOURCE_IDS.usNy, providerCode: 'IPIPD', providerResourceId: 'ipipd-us-nyc', weight: 100 },
      { siteId: site.id, resourceId: RESOURCE_IDS.usLa, providerCode: 'IPIPD', providerResourceId: 'ipipd-us-la', weight: 100 },
      { siteId: site.id, resourceId: RESOURCE_IDS.jpTokyo, providerCode: 'IPIPD', providerResourceId: 'ipipd-jp-tokyo', weight: 100 },
      { siteId: site.id, resourceId: RESOURCE_IDS.sg, providerCode: 'PR', providerResourceId: 'pr-sg', weight: 100 },
      { siteId: site.id, resourceId: RESOURCE_IDS.hk, providerCode: 'NINE_EIGHT_FIVE', providerResourceId: '985-hk', weight: 100 },
    ],
  });

  await prisma.inventory_snapshots.createMany({
    data: [
      { siteId: site.id, resourceId: RESOURCE_IDS.usNy, providerCode: 'IPIPD', stock: 93, capturedAt: now, freshnessTtlSeconds: 300, isStale: false },
      { siteId: site.id, resourceId: RESOURCE_IDS.usLa, providerCode: 'IPIPD', stock: 180, capturedAt: now, freshnessTtlSeconds: 300, isStale: false },
      { siteId: site.id, resourceId: RESOURCE_IDS.jpTokyo, providerCode: 'IPIPD', stock: 56, capturedAt: now, freshnessTtlSeconds: 300, isStale: false },
      { siteId: site.id, resourceId: RESOURCE_IDS.sg, providerCode: 'PR', stock: 88, capturedAt: now, freshnessTtlSeconds: 300, isStale: false },
      { siteId: site.id, resourceId: RESOURCE_IDS.hk, providerCode: 'NINE_EIGHT_FIVE', stock: 72, capturedAt: now, freshnessTtlSeconds: 300, isStale: false },
    ],
  });

  await prisma.price_rules.createMany({
    data: [
      { siteId: site.id, templateId: PRICE_TEMPLATE_ID, resourceId: RESOURCE_IDS.usNy, durationDays: 30, unitPrice: '28', currency: 'CNY', minQty: 1 },
      { siteId: site.id, templateId: PRICE_TEMPLATE_ID, resourceId: RESOURCE_IDS.usLa, durationDays: 30, unitPrice: '35', currency: 'CNY', minQty: 1 },
      { siteId: site.id, templateId: PRICE_TEMPLATE_ID, resourceId: RESOURCE_IDS.jpTokyo, durationDays: 30, unitPrice: '42', currency: 'CNY', minQty: 1 },
      { siteId: site.id, templateId: PRICE_TEMPLATE_ID, resourceId: RESOURCE_IDS.sg, durationDays: 30, unitPrice: '28', currency: 'CNY', minQty: 1 },
      { siteId: site.id, templateId: PRICE_TEMPLATE_ID, resourceId: RESOURCE_IDS.hk, durationDays: 30, unitPrice: '28', currency: 'CNY', minQty: 1 },
    ],
  });

  await prisma.price_overrides.createMany({
    data: [
      { siteId: site.id, resourceId: RESOURCE_IDS.sg, durationDays: 30, unitPrice: '28', currency: 'CNY' },
      { siteId: site.id, resourceId: RESOURCE_IDS.hk, durationDays: 30, unitPrice: '28', currency: 'CNY' },
    ],
  });

  await prisma.user_price_bindings.create({
    data: {
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      templateId: PRICE_TEMPLATE_ID,
    },
  });

  await prisma.user_resource_price_overrides.createMany({
    data: [
      { siteId: site.id, tenantId: tenant.id, userId: customer.id, resourceId: RESOURCE_IDS.usNy, durationDays: 30, unitPrice: '28', currency: 'CNY' },
      { siteId: site.id, tenantId: tenant.id, userId: customer.id, resourceId: RESOURCE_IDS.sg, durationDays: 30, unitPrice: '28', currency: 'CNY' },
    ],
  });

  const order = await prisma.orders.create({
    data: {
      id: ORDER_ID,
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      type: 'STATIC_PROXY_BUY',
      status: 'COMPLETED',
      resourceId: RESOURCE_IDS.usNy,
      quantity: 1,
      durationDays: 30,
      unitPrice: '28',
      totalPrice: '28',
      currency: 'CNY',
      quoteSnapshot: { resourceId: RESOURCE_IDS.usNy, durationDays: 30, quantity: 1, currency: 'CNY' },
      paymentOrderId: PAYMENT_ORDER_ID,
      idempotencyKey: 'seed-order',
    },
  });

  await prisma.payment_orders.create({
    data: {
      id: PAYMENT_ORDER_ID,
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      amount: '100',
      currency: 'CNY',
      channel: 'MANUAL',
      status: 'PENDING',
      idempotencyKey: 'seed-payment',
    },
  });

  const fulfillmentJob = await prisma.fulfillment_jobs.create({
    data: {
      id: FULFILLMENT_JOB_ID,
      siteId: site.id,
      orderId: order.id,
      providerCode: 'IPIPD',
      status: 'COMPLETED',
      attempts: 1,
      maxAttempts: 3,
      startedAt: now,
      completedAt: now,
    },
  });

  const mirror = await prisma.upstream_order_mirrors.create({
    data: {
      id: MIRROR_ID,
      siteId: site.id,
      orderId: order.id,
      fulfillmentJobId: fulfillmentJob.id,
      providerCode: 'IPIPD',
      upstreamOrderId: 'UP-ORDER-1',
      status: 'COMPLETED',
      rawResponse: { ok: true },
    },
  });

  await prisma.proxy_instances.create({
    data: {
      id: PROXY_ID,
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      orderId: order.id,
      upstreamOrderMirrorId: mirror.id,
      providerCode: 'IPIPD',
      ip: '203.0.113.10',
      port: 8000,
      username: 'user',
      password: encryptAesGcm('pass', E2E_ENCRYPTION_KEY),
      protocol: 'SOCKS5',
      countryCode: 'US',
      regionCode: 'US-NY',
      ipType: 'NATIVE',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      businessType: 'residential',
      userNote: 'E2E proxy',
    },
  });

  await prisma.api_keys.create({
    data: {
      id: API_KEY_ID,
      siteId: site.id,
      tenantId: tenant.id,
      ownerId: customer.id,
      ownerType: 'USER',
      name: 'E2E Key',
      keyHash: 'hash-e2e-key',
      keyPrefix: 'e2e1',
      scopes: ['proxy:read'],
      ipWhitelist: ['127.0.0.1'],
      status: 'ACTIVE',
      lastUsedAt: now,
    },
  });

  await prisma.tickets.create({
    data: {
      id: TICKET_ID,
      siteId: site.id,
      tenantId: tenant.id,
      userId: customer.id,
      subject: 'E2E Ticket',
      status: 'OPEN',
    },
  });

  await prisma.ticket_messages.create({
    data: {
      ticketId: TICKET_ID,
      siteId: site.id,
      tenantId: tenant.id,
      authorType: 'USER',
      authorId: customer.id,
      body: 'Need help with E2E order.',
    },
  });

  await prisma.upstream_request_logs.createMany({
    data: [
      {
        siteId: site.id,
        providerCode: 'IPIPD',
        upstreamAccountId: PROVIDER_ACCOUNT_IDS.ipipd,
        operation: 'inventory_sync',
        requestId: 'req-e2e-1',
        durationMs: 120,
        status: 'SUCCESS',
        requestSummary: { path: '/api/resources/sync-inventory' },
        responseSummary: { ok: true },
      },
      {
        siteId: site.id,
        providerCode: 'PR',
        upstreamAccountId: PROVIDER_ACCOUNT_IDS.pr,
        operation: 'health_check',
        requestId: 'req-e2e-2',
        durationMs: 150,
        status: 'SUCCESS',
        requestSummary: { path: '/personal/api/v1/reference/list/resident' },
        responseSummary: { ok: true },
      },
    ],
  });

  await prisma.audit_logs.createMany({
    data: [
      {
        siteId: site.id,
        tenantId: tenant.id,
        actorType: 'SYSTEM',
        actorId: 'system',
        targetType: 'orders',
        targetId: order.id,
        action: 'ORDER_CREATED',
        reason: 'seed',
        requestId: 'audit-seed-1',
      },
      {
        siteId: site.id,
        tenantId: tenant.id,
        actorType: 'ADMIN_USER',
        actorId: ADMIN_ID,
        targetType: 'providers',
        targetId: PROVIDER_ACCOUNT_IDS.pr,
        action: 'PROVIDER_SYNCED',
        reason: 'seed',
        requestId: 'audit-seed-2',
      },
    ],
  });

  await prisma.$disconnect();
}

async function cleanDatabase(): Promise<void> {
  const list = ALL_TABLES.map((table) => `"${table}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const e2eUsers = {
  admin: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  customer: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD },
};
