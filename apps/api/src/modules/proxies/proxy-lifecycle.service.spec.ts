import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { ProviderAdapter, ProviderRuntimeConfig } from '../providers/provider.types';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ProxyInstance } from './proxies.repository';
import { ProxyLifecycleService } from './proxy-lifecycle.service';
import { ProxyAuditService } from './proxy-audit.service';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    proxy_instances: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    audit_logs: {
      create: vi.fn(),
    },
  },
}));

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProxyLifecycleService', () => {
  it('hides proxies that do not belong to the current user', async () => {
    const service = createService(adapterWithLifecycle());
    mockFindUnique(proxyInstance({ userId: 'user-2' }));

    await expect(service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'switchIp' }))
      .rejects
      .toMatchObject({
        code: ErrorCode.NOT_FOUND,
        reasonKey: 'proxy_not_found',
      } satisfies Partial<AppError>);
    expect(prisma.audit_logs.create).not.toHaveBeenCalled();
  });

  it('rejects lifecycle actions when the proxy has no upstream proxy id', async () => {
    const service = createService(adapterWithLifecycle());
    mockFindUnique({ ...proxyInstance(), upstreamProxyId: null });

    await expect(service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'switchIp' }))
      .rejects
      .toMatchObject({
        code: ErrorCode.UNSUPPORTED_CAPABILITY,
        reasonKey: 'upstream_proxy_id_missing',
      } satisfies Partial<AppError>);
    expect(auditData()).toMatchObject({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      actorType: 'USER',
      actorId: 'user-1',
      targetType: 'proxy_instances',
      targetId: 'proxy-1',
      action: 'proxy.switch_ip.failed',
      reason: 'upstream_proxy_id_missing',
      requestId: 'req-1',
      meta: expect.objectContaining({
        code: ErrorCode.UNSUPPORTED_CAPABILITY,
        reasonKey: 'upstream_proxy_id_missing',
        upstreamProxyId: null,
      }),
    });
  });

  it('rejects provider adapters that do not support the requested lifecycle action', async () => {
    const service = createService(adapterWithoutLifecycle());
    mockFindUnique(proxyInstance());

    await expect(service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'renew', durationDays: 30 }))
      .rejects
      .toMatchObject({
        code: ErrorCode.UNSUPPORTED_CAPABILITY,
        reasonKey: 'renew_not_supported',
      } satisfies Partial<AppError>);
    expect(auditData()).toMatchObject({
      action: 'proxy.renew.failed',
      reason: 'renew_not_supported',
      meta: expect.objectContaining({
        durationDays: 30,
        code: ErrorCode.UNSUPPORTED_CAPABILITY,
        reasonKey: 'renew_not_supported',
      }),
    });
  });

  it('records upstream lifecycle failures and keeps the upstream error visible', async () => {
    const adapter = {
      ...adapterWithoutLifecycle(),
      switchProxyIp: vi.fn().mockRejectedValue(new AppError(ErrorCode.UPSTREAM_ERROR, 'upstream_switch_failed', 502)),
    };
    const service = createService(adapter);
    mockFindUnique(proxyInstance());

    await expect(service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'switchIp' }))
      .rejects
      .toMatchObject({
        code: ErrorCode.UPSTREAM_ERROR,
        reasonKey: 'upstream_switch_failed',
      } satisfies Partial<AppError>);
    expect(auditData()).toMatchObject({
      action: 'proxy.switch_ip.failed',
      reason: 'upstream_switch_failed',
      meta: expect.objectContaining({
        code: ErrorCode.UPSTREAM_ERROR,
        reasonKey: 'upstream_switch_failed',
        httpStatus: 502,
      }),
    });
  });

  it('records renew success audit when the upstream returns no proxy payload', async () => {
    const adapter = {
      ...adapterWithoutLifecycle(),
      renewStaticProxy: vi.fn().mockResolvedValue({}),
    };
    const service = createService(adapter);
    const existing = proxyInstance();
    mockFindUnique(existing);

    const result = await service.execute({
      proxyId: 'proxy-1',
      ctx: authContext(),
      action: 'renew',
      durationDays: 30,
      idempotencyKey: 'renew-key',
    });

    expect(result).toBe(existing);
    expect(prisma.proxy_instances.update).not.toHaveBeenCalled();
    expect(auditData()).toMatchObject({
      action: 'proxy.renew.success',
      targetId: 'proxy-1',
      meta: expect.objectContaining({
        durationDays: 30,
        idempotencyKey: 'renew-key',
        upstreamProxyId: 'UP_PROXY_1',
        deliveryUpdated: false,
      }),
    });
  });

  it('records change-password success audit without storing the new plaintext password', async () => {
    const adapter = {
      ...adapterWithoutLifecycle(),
      changeProxyPassword: vi.fn().mockResolvedValue({
        proxy: {
          upstreamProxyId: 'UP_PROXY_1',
          ip: '203.0.113.10',
          port: 8000,
          username: 'rotated-user',
          password: 'rotated-pass',
          protocol: 'HTTP',
          expiresAt: new Date('2026-07-10T00:00:00.000Z'),
          countryCode: 'HK',
        },
      }),
    };
    const service = createService(adapter);
    const updated = proxyInstance({ username: 'rotated-user' });
    mockFindUnique(proxyInstance());
    vi.mocked(prisma.proxy_instances.update).mockResolvedValue(updated);

    await service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'changePassword' });

    expect(auditData()).toMatchObject({
      action: 'proxy.change_password.success',
      targetId: 'proxy-1',
      meta: expect.objectContaining({
        upstreamProxyId: 'UP_PROXY_1',
        deliveryUpdated: true,
      }),
    });
    expect(JSON.stringify(auditData()?.meta)).not.toContain('rotated-pass');
  });

  it('updates local proxy delivery fields when switch ip returns a new proxy', async () => {
    const adapter = adapterWithLifecycle();
    const service = createService(adapter);
    const existing = proxyInstance();
    const updated = proxyInstance({ ip: '203.0.113.20', upstreamProxyId: 'UP_PROXY_2' });
    mockFindUnique(existing);
    vi.mocked(prisma.proxy_instances.update).mockResolvedValue(updated);

    const result = await service.execute({ proxyId: 'proxy-1', ctx: authContext(), action: 'switchIp' });

    expect(result).toBe(updated);
    expect(adapter.switchProxyIp).toHaveBeenCalledWith({ upstreamProxyId: 'UP_PROXY_1', durationDays: undefined, idempotencyKey: undefined }, runtimeConfig());
    const updateArg = vi.mocked(prisma.proxy_instances.update).mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'proxy-1' });
    expect(updateArg?.data).toMatchObject({
      upstreamProxyId: 'UP_PROXY_2',
      ip: '203.0.113.20',
      port: 9000,
      username: 'new-user',
      protocol: 'SOCKS5',
      countryCode: 'HK',
      status: 'ACTIVE',
    });
    expect(decryptAesGcm(String(updateArg?.data?.password), ENCRYPTION_KEY)).toBe('new-pass');
    expect(auditData()).toMatchObject({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      actorType: 'USER',
      actorId: 'user-1',
      targetType: 'proxy_instances',
      targetId: 'proxy-1',
      action: 'proxy.switch_ip.success',
      requestId: 'req-1',
      meta: expect.objectContaining({
        providerCode: 'UPSTREAM_API',
        orderId: 'order-1',
        upstreamProxyId: 'UP_PROXY_2',
        deliveryUpdated: true,
      }),
    });
    expect(JSON.stringify(auditData()?.meta)).not.toContain('new-pass');
  });
});

function createService(adapter: ProviderAdapter): ProxyLifecycleService {
  const registry = {
    getConfigForProviderAccount: vi.fn().mockResolvedValue(runtimeConfig()),
    getConfigForUpstreamAccount: vi.fn().mockResolvedValue(runtimeConfig()),
    getConfig: vi.fn().mockResolvedValue(runtimeConfig()),
    getAdapter: vi.fn().mockReturnValue(adapter),
  } as unknown as ProviderRegistryService;
  const config = {
    get: () => ENCRYPTION_KEY,
  } as unknown as ConfigService;
  return new ProxyLifecycleService(registry, config, new ProxyAuditService());
}

function authContext(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'req-1',
    ...overrides,
  };
}

function auditData() {
  return vi.mocked(prisma.audit_logs.create).mock.calls[0]?.[0]?.data;
}

function adapterWithLifecycle(): ProviderAdapter {
  return {
    ...adapterWithoutLifecycle(),
    switchProxyIp: vi.fn().mockResolvedValue({
      proxy: {
        upstreamProxyId: 'UP_PROXY_2',
        ip: '203.0.113.20',
        port: 9000,
        username: 'new-user',
        password: 'new-pass',
        protocol: 'SOCKS5',
        expiresAt: new Date('2026-07-10T00:00:00.000Z'),
        countryCode: 'HK',
      },
    }),
  };
}

function adapterWithoutLifecycle(): ProviderAdapter {
  return {
    code: 'UPSTREAM_API',
    healthCheck: vi.fn(),
    syncInventory: vi.fn(),
    buyStaticProxy: vi.fn(),
    buildBuyRequest: vi.fn(),
    queryOrder: vi.fn(),
  };
}

function runtimeConfig(): ProviderRuntimeConfig {
  return {
    code: 'UPSTREAM_API',
    status: 'ACTIVE',
    siteId: 'site-1',
    upstreamAccountId: 'upstream-account-1',
    baseUrl: 'https://upstream.example.com',
    timeoutMs: 1000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: { apiKey: 'plain-key' },
  };
}

function mockFindUnique(proxy: ProxyInstance | null) {
  vi.mocked(prisma.proxy_instances.findUnique).mockResolvedValue(proxy);
}

function proxyInstance(overrides: Partial<ProxyInstance> = {}): ProxyInstance {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'proxy-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    orderId: 'order-1',
    upstreamAccountId: 'upstream-account-1',
    upstreamOrderMirrorId: 'mirror-1',
    upstreamProxyId: 'UP_PROXY_1',
    providerCode: 'UPSTREAM_API',
    ip: '203.0.113.10',
    port: 8000,
    username: 'proxy-user',
    password: 'encrypted-pass',
    protocol: 'HTTP',
    countryCode: 'HK',
    regionCode: null,
    ipType: 'NATIVE',
    status: 'ACTIVE',
    expiresAt: now,
    businessType: null,
    userNote: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
