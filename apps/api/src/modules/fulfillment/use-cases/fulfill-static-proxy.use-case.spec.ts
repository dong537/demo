import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@ipeasy/db';
import Decimal from 'decimal.js';
import { ConfigService } from '../../../common/config/config.service';
import { ProviderAdapter, ProviderRuntimeConfig } from '../../providers/provider.types';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { WalletRepository } from '../../wallet/wallet.repository';
import { FulfillmentRepository } from '../fulfillment.repository';
import { ProxiesRepository } from '../../proxies/proxies.repository';
import { FulfillStaticProxyUseCase } from './fulfill-static-proxy.use-case';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    orders: {
      findUnique: vi.fn(),
    },
    platform_resources: {
      findUnique: vi.fn(),
    },
    resource_mappings: {
      findFirst: vi.fn(),
    },
    upstream_order_mirrors: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    proxy_instances: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

describe('FulfillStaticProxyUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(transactionClient() as never));
  });

  it('uses resource mapping providerResourceId when buying an upstream line resource', async () => {
    const adapter = adapterMock();
    const useCase = createUseCase(adapter);

    vi.mocked(prisma.orders.findUnique).mockResolvedValue(orderRecord());
    vi.mocked(prisma.platform_resources.findUnique).mockResolvedValue(resourceRecord());
    vi.mocked(prisma.resource_mappings.findFirst).mockResolvedValue({
      id: 'mapping-1',
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'provider-account-1',
      providerResourceId: 'line-us-ny-standard',
      weight: 100,
    });
    vi.mocked(prisma.upstream_order_mirrors.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.upstream_order_mirrors.create).mockResolvedValue(upstreamMirrorRecord());

    await expect(useCase.execute('job-1')).resolves.toMatchObject({
      status: 'COMPLETED',
      jobId: 'job-1',
      orderId: 'order-1',
    });

    expect(adapter.buyStaticProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        countryCode: 'US',
        regionCode: undefined,
        providerResourceId: 'line-us-ny-standard',
        businessType: 'line-us-ny-standard',
        quantity: 2,
        durationDays: 30,
        idempotencyKey: 'buy-key-1',
      }),
      runtimeConfig(),
    );
  });

  it('uses the native resource provider config even when an upstream API account exists', async () => {
    const adapter = adapterMock();
    const { useCase, registry } = createUseCaseHarness(adapter, {
      getConfigForUpstreamAccount: vi.fn().mockResolvedValue({
        ...runtimeConfig(),
        code: 'UPSTREAM_API',
        upstreamAccountId: 'legacy-upstream-account',
        baseUrl: 'https://legacy-upstream.example.com',
        credential: { apiKey: 'legacy-key' },
      } satisfies ProviderRuntimeConfig),
    });

    vi.mocked(prisma.orders.findUnique).mockResolvedValue(orderRecord());
    vi.mocked(prisma.platform_resources.findUnique).mockResolvedValue(resourceRecord());
    vi.mocked(prisma.resource_mappings.findFirst).mockResolvedValue({
      id: 'mapping-1',
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'provider-account-1',
      providerResourceId: 'line-us-ny-standard',
      weight: 100,
    });
    vi.mocked(prisma.upstream_order_mirrors.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.upstream_order_mirrors.create).mockResolvedValue(upstreamMirrorRecord());

    await expect(useCase.execute('job-1')).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(registry.getConfigForProviderAccount).toHaveBeenCalledWith('IPIPD', 'site-1', 'provider-account-1');
    expect(registry.getConfigForUpstreamAccount).not.toHaveBeenCalled();
    expect(adapter.buyStaticProxy).toHaveBeenCalledWith(expect.any(Object), runtimeConfig());
  });

  it('preserves the resolved protocol and country when querying an existing upstream order', async () => {
    const adapter = adapterMock();
    vi.mocked(adapter.queryOrder).mockResolvedValue({
      upstreamOrderId: 'upstream-order-1',
      status: 'COMPLETED',
      proxies: [
        proxyDelivery('up-proxy-1', '203.0.113.10'),
        proxyDelivery('up-proxy-2', '203.0.113.11'),
      ],
    });
    const useCase = createUseCase(adapter);

    vi.mocked(prisma.orders.findUnique).mockResolvedValue(orderRecord());
    vi.mocked(prisma.platform_resources.findUnique).mockResolvedValue({
      ...resourceRecord(),
      protocol: 'SOCKS5',
    });
    vi.mocked(prisma.resource_mappings.findFirst).mockResolvedValue({
      id: 'mapping-1',
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'IPIPD',
      upstreamAccountId: 'provider-account-1',
      providerResourceId: 'line-us-ny-standard',
      weight: 100,
    });
    vi.mocked(prisma.upstream_order_mirrors.findFirst).mockResolvedValue(upstreamMirrorRecord());

    await expect(useCase.execute('job-1')).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(adapter.queryOrder).toHaveBeenCalledWith(
      { upstreamOrderId: 'upstream-order-1', protocol: 'SOCKS5', countryCode: 'US' },
      runtimeConfig(),
    );
  });

  it('derives the Proxy-Seller region from the mapped geographic path when the resource is still country-level', async () => {
    const adapter = adapterMock();
    const useCase = createUseCase(adapter);

    vi.mocked(prisma.orders.findUnique).mockResolvedValue(orderRecord());
    vi.mocked(prisma.platform_resources.findUnique).mockResolvedValue({
      ...resourceRecord(),
      providerCode: 'PR',
      type: 'COUNTRY',
      code: 'CA',
      name: 'Canada',
      displayName: 'Canada',
    });
    vi.mocked(prisma.resource_mappings.findFirst).mockResolvedValue({
      id: 'mapping-1',
      siteId: 'site-1',
      resourceId: 'resource-1',
      providerCode: 'PR',
      upstreamAccountId: 'provider-account-1',
      providerResourceId: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
      weight: 100,
    });
    vi.mocked(prisma.upstream_order_mirrors.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.upstream_order_mirrors.create).mockResolvedValue(upstreamMirrorRecord());

    await expect(useCase.execute('job-1')).resolves.toMatchObject({
      status: 'COMPLETED',
      jobId: 'job-1',
      orderId: 'order-1',
    });

    expect(adapter.buyStaticProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        countryCode: 'CA',
        regionCode: 'Ontario:Woodstock:Comwave Telecom',
        providerResourceId: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
        businessType: 'CA:6928:Ontario:Woodstock:Comwave Telecom',
        quantity: 2,
        durationDays: 30,
        idempotencyKey: 'buy-key-1',
      }),
      runtimeConfig(),
    );
  });
});

function createUseCase(adapter: ProviderAdapter): FulfillStaticProxyUseCase {
  return createUseCaseHarness(adapter).useCase;
}

type RegistryHarness = {
  getConfigForProviderAccount: ReturnType<typeof vi.fn>;
  getConfigForUpstreamAccount: ReturnType<typeof vi.fn>;
  getConfig: ReturnType<typeof vi.fn>;
  getAdapter: ReturnType<typeof vi.fn>;
};

function createUseCaseHarness(
  adapter: ProviderAdapter,
  registryOverrides: Partial<RegistryHarness> = {},
): { useCase: FulfillStaticProxyUseCase; registry: RegistryHarness } {
  const fulfillmentRepo = {
    claimRunnableJob: vi.fn().mockResolvedValue({
      id: 'job-1',
      siteId: 'site-1',
      orderId: 'order-1',
      providerCode: 'IPIPD',
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date('2026-06-14T00:00:00.000Z'),
      startedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: new Date('2026-06-14T00:00:00.000Z'),
      updatedAt: new Date('2026-06-14T00:00:00.000Z'),
    }),
    updateJobStatus: vi.fn(),
  } as unknown as FulfillmentRepository;
  const registry = {
    getConfigForProviderAccount: vi.fn().mockResolvedValue(runtimeConfig()),
    getConfigForUpstreamAccount: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(runtimeConfig()),
    getAdapter: vi.fn().mockReturnValue(adapter),
    ...registryOverrides,
  };
  const walletRepo = {} as WalletRepository;
  const proxiesRepo = {
    createMany: vi.fn().mockImplementation((tx, data) => tx.proxy_instances.createMany({ data })),
  } as unknown as ProxiesRepository;
  const config = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'APP_ENCRYPTION_KEY') return ENCRYPTION_KEY;
      if (key === 'PROVIDER_FULFILLMENT_EXECUTION_ENABLED') return 'true';
      if (key === 'PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST') return 'IPIPD';
      if (key === 'PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST') return '';
      return '';
    }),
  } as unknown as ConfigService;
  return {
    useCase: new FulfillStaticProxyUseCase(
      fulfillmentRepo,
      registry as unknown as ProviderRegistryService,
      walletRepo,
      proxiesRepo,
      config,
    ),
    registry,
  };
}

function adapterMock(): ProviderAdapter {
  return {
    code: 'IPIPD',
    healthCheck: vi.fn(),
    syncInventory: vi.fn(),
    buildBuyRequest: vi.fn(),
    queryOrder: vi.fn(),
    buyStaticProxy: vi.fn().mockResolvedValue({
      upstreamOrderId: 'upstream-order-1',
      status: 'COMPLETED',
      proxies: [
        proxyDelivery('up-proxy-1', '203.0.113.10'),
        proxyDelivery('up-proxy-2', '203.0.113.11'),
      ],
    }),
  };
}

function runtimeConfig(): ProviderRuntimeConfig {
  return {
    code: 'IPIPD',
    status: 'ACTIVE',
    siteId: 'site-1',
    upstreamAccountId: 'provider-account-1',
    baseUrl: 'https://api.ipipd.cn',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: ['US'],
    credential: { appId: 'app-1', appSecret: 'secret-1' },
  };
}

function orderRecord() {
  return {
    id: 'order-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    type: 'STATIC_PROXY_BUY' as const,
    status: 'PENDING' as const,
    resourceId: 'resource-1',
    quantity: 2,
    durationDays: 30,
    unitPrice: new Decimal('24'),
    totalPrice: new Decimal('48'),
    currency: 'CNY',
    quoteSnapshot: {},
    paymentOrderId: null,
    failReason: null,
    idempotencyKey: 'buy-key-1',
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

function resourceRecord() {
  return {
    id: 'resource-1',
    siteId: 'site-1',
    upstreamAccountId: 'provider-account-1',
    providerCode: 'IPIPD',
    type: 'REGION' as const,
    code: 'US:line-us-ny-standard',
    name: 'United States-New York Standard',
    ipType: 'NATIVE' as const,
    protocol: 'BOTH' as const,
    status: 'ACTIVE' as const,
    sortOrder: 0,
    parentId: null,
    displayName: null,
    isVisible: true,
    isSaleable: true,
    unsaleableReason: null,
    upstreamCost: new Decimal('14'),
    upstreamCostCurrency: 'CNY',
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

function upstreamMirrorRecord() {
  return {
    id: 'mirror-1',
    siteId: 'site-1',
    orderId: 'order-1',
    fulfillmentJobId: 'job-1',
    providerCode: 'IPIPD',
    upstreamAccountId: 'provider-account-1',
    upstreamOrderId: 'upstream-order-1',
    status: 'COMPLETED',
    rawResponse: { proxiesCount: 2 },
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

function proxyDelivery(upstreamProxyId: string, ip: string) {
  return {
    upstreamProxyId,
    ip,
    port: 8080,
    username: 'proxy-user',
    password: 'proxy-pass',
    protocol: 'HTTP' as const,
    expiresAt: new Date('2026-07-14T00:00:00.000Z'),
    countryCode: 'US',
  };
}

function transactionClient() {
  return {
    upstream_order_mirrors: {
      findFirst: vi.fn().mockResolvedValue(upstreamMirrorRecord()),
      update: vi.fn().mockResolvedValue(upstreamMirrorRecord()),
    },
    orders: {
      update: vi.fn().mockResolvedValue({}),
    },
    fulfillment_jobs: {
      update: vi.fn().mockResolvedValue({}),
    },
    proxy_instances: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
}
