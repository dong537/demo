import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { ProxiesController } from './proxies.controller';
import { ProxiesRepository, ProxyInstance } from './proxies.repository';
import { RenewProxyUseCase } from './use-cases/renew-proxy.use-case';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';
import { SwitchIpUseCase } from './use-cases/switch-ip.use-case';
import { BatchProxyLifecycleUseCase } from './use-cases/batch-proxy-lifecycle.use-case';
import { ProxyAuditService } from './proxy-audit.service';

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

function createController() {
  const repo = {
    findByUserId: vi.fn<ProxiesRepository['findByUserId']>(),
    listForAdmin: vi.fn<ProxiesRepository['listForAdmin']>(),
    findAllActiveByUserId: vi.fn<ProxiesRepository['findAllActiveByUserId']>(),
  };
  const audit = {
    recordExport: vi.fn(),
  };
  const batchLifecycle = {
    renew: vi.fn<BatchProxyLifecycleUseCase['renew']>(),
    changePassword: vi.fn<BatchProxyLifecycleUseCase['changePassword']>(),
    switchIp: vi.fn<BatchProxyLifecycleUseCase['switchIp']>(),
  };
  const config = {
    get: () => ENCRYPTION_KEY,
  };

  return {
    repo,
    controller: new ProxiesController(
      repo as unknown as ProxiesRepository,
      {} as RenewProxyUseCase,
      {} as ChangePasswordUseCase,
      {} as SwitchIpUseCase,
      batchLifecycle as unknown as BatchProxyLifecycleUseCase,
      config as unknown as ConfigService,
      audit as unknown as ProxyAuditService,
    ),
    audit,
    batchLifecycle,
  };
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

function proxyInstance(overrides: Partial<ProxyInstance> = {}): ProxyInstance {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'proxy-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    orderId: 'order-1',
    upstreamAccountId: null,
    upstreamOrderMirrorId: 'mirror-1',
    upstreamProxyId: null,
    providerCode: '985proxy',
    ip: '1.2.3.4',
    port: 8000,
    username: 'proxy-user',
    password: encryptAesGcm('plain-pass', ENCRYPTION_KEY),
    protocol: 'HTTP',
    countryCode: 'US',
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

function page(items: ProxyInstance[]) {
  return {
    page: 1,
    pageSize: 20,
    total: items.length,
    items,
  };
}

describe('ProxiesController.list', () => {
  it('returns decrypted delivery fields for the current user only', async () => {
    const { controller, repo } = createController();
    const query = { page: 1, pageSize: 20, status: 'ACTIVE' as const };
    repo.findByUserId.mockResolvedValue(page([proxyInstance()]));

    const result = await controller.list(authContext(), query);

    expect(repo.findByUserId).toHaveBeenCalledWith('user-1', 'site-1', 'tenant-1', query);
    expect(repo.listForAdmin).not.toHaveBeenCalled();
    const item = result.items[0] as Record<string, unknown>;
    expect(item.username).toBe('proxy-user');
    expect(item.password).toBe('plain-pass');
  });

  it('lists tenant admin proxies inside the current tenant without password fields', async () => {
    const { controller, repo } = createController();
    const query = { page: 1, pageSize: 20, userId: 'user-2' };
    repo.listForAdmin.mockResolvedValue(page([proxyInstance({ userId: 'user-2' })]));

    const result = await controller.list(
      authContext({ ownerId: 'tenant-admin-1', ownerType: 'TENANT_ADMIN' }),
      query,
    );

    expect(repo.listForAdmin).toHaveBeenCalledWith('site-1', 'tenant-1', query);
    expect(repo.findByUserId).not.toHaveBeenCalled();
    const item = result.items[0] as Record<string, unknown>;
    expect(item.userId).toBe('user-2');
    expect('password' in item).toBe(false);
  });

  it('lets platform admin optionally filter proxies by tenant without password fields', async () => {
    const { controller, repo } = createController();
    const query = { page: 1, pageSize: 20, tenantId: 'tenant-2', countryCode: 'US' };
    repo.listForAdmin.mockResolvedValue(page([proxyInstance({ tenantId: 'tenant-2' })]));

    const result = await controller.list(
      authContext({ ownerId: 'platform-admin-1', ownerType: 'PLATFORM_ADMIN', tenantId: null }),
      query,
    );

    expect(repo.listForAdmin).toHaveBeenCalledWith('site-1', 'tenant-2', query);
    const item = result.items[0] as Record<string, unknown>;
    expect(item.tenantId).toBe('tenant-2');
    expect('password' in item).toBe(false);
  });
});

describe('ProxiesController.export', () => {
  it('records export audit with format and count without passing plaintext proxy lines', async () => {
    const { controller, repo, audit } = createController();
    repo.findAllActiveByUserId.mockResolvedValue([proxyInstance()]);

    const result = await controller.export(authContext(), 'IP_PORT_AUTH');

    expect(result).toEqual(['1.2.3.4:8000:proxy-user:plain-pass']);
    expect(audit.recordExport).toHaveBeenCalledWith(authContext(), {
      format: 'IP_PORT_AUTH',
      count: 1,
    });
    expect(JSON.stringify(audit.recordExport.mock.calls[0])).not.toContain('plain-pass');
  });
});

describe('ProxiesController batch lifecycle', () => {
  it('maps batch renew successes to delivery DTOs and preserves item failures', async () => {
    const { controller, batchLifecycle } = createController();
    const body = {
      proxyIds: ['proxy-1', 'proxy-2'],
      durationDays: 30,
      idempotencyKey: 'batch-key',
    };
    const failure = {
      code: 'NOT_FOUND',
      reasonKey: 'proxy_not_found',
      httpStatus: 404,
    };
    batchLifecycle.renew.mockResolvedValue({
      totalCount: 2,
      successCount: 1,
      failureCount: 1,
      items: [
        { proxyId: 'proxy-1', success: true, proxy: proxyInstance() },
        { proxyId: 'proxy-2', success: false, error: failure },
      ],
    });

    const result = await controller.batchRenew(authContext(), body);

    expect(batchLifecycle.renew).toHaveBeenCalledWith(authContext(), body);
    expect(result.totalCount).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      proxyId: 'proxy-1',
      success: true,
      proxy: {
        id: 'proxy-1',
        username: 'proxy-user',
        password: 'plain-pass',
      },
    });
    expect(result.items[1]).toEqual({
      proxyId: 'proxy-2',
      success: false,
      error: failure,
    });
  });

  it('delegates batch password changes and IP switches to the batch use case', async () => {
    const { controller, batchLifecycle } = createController();
    const body = { proxyIds: ['proxy-1'] };
    const result = {
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [{ proxyId: 'proxy-1', success: true as const, proxy: proxyInstance() }],
    };
    batchLifecycle.changePassword.mockResolvedValue(result);
    batchLifecycle.switchIp.mockResolvedValue(result);

    await controller.batchChangePassword(authContext(), body);
    await controller.batchSwitchIp(authContext(), body);

    expect(batchLifecycle.changePassword).toHaveBeenCalledWith(authContext(), body);
    expect(batchLifecycle.switchIp).toHaveBeenCalledWith(authContext(), body);
  });
});
