import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProxiesRepository, ProxyInstance } from '../proxies/proxies.repository';
import { ProxyAuditService } from '../proxies/proxy-audit.service';
import { ResStaticController } from './res-static.controller';

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

function createController() {
  const repo = {
    findByUserId: vi.fn<ProxiesRepository['findByUserId']>(),
  };
  const audit = {
    recordExport: vi.fn(),
  };
  const config = {
    get: () => ENCRYPTION_KEY,
  };

  return {
    repo,
    audit,
    controller: new ResStaticController(
      {} as never,
      {} as never,
      {} as never,
      repo as unknown as ProxiesRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config as unknown as ConfigService,
      audit as unknown as ProxyAuditService,
    ),
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
    upstreamProxyId: 'up-proxy-1',
    providerCode: '985proxy',
    ip: '1.2.3.4',
    port: 8000,
    username: 'proxy-user',
    password: encryptAesGcm('plain-pass', ENCRYPTION_KEY),
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

function page(items: ProxyInstance[]) {
  return {
    page: 1,
    pageSize: 1000,
    total: items.length,
    items,
  };
}

describe('ResStaticController.ipList', () => {
  it('maps OpenAPI list filters to repository query and returns decrypted proxies', async () => {
    const { controller, repo } = createController();
    repo.findByUserId.mockResolvedValue({
      page: 2,
      pageSize: 10,
      total: 1,
      items: [proxyInstance({
        id: '123e4567-e89b-42d3-a456-426614174000',
        orderId: '223e4567-e89b-42d3-a456-426614174111',
      })],
    });

    const result = await controller.ipList(authContext(), {
      page: 2,
      page_size: 10,
      status: 'ACTIVE',
      country_code: 'HK',
      search: 'order-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    expect(repo.findByUserId).toHaveBeenCalledWith('user-1', 'site-1', 'tenant-1', {
      page: 2,
      pageSize: 10,
      status: 'ACTIVE',
      countryCode: 'HK',
      search: 'order-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(10);
    expect(result.items[0]).toMatchObject({
      proxy_id: 'IP_123e4567e89b42d3a456426614174000',
      order_no: 'ORD_223e4567e89b42d3a456426614174111',
      password: 'plain-pass',
      country_code: 'HK',
    });
  });

  it('propagates repository validation errors for invalid expiry dates', async () => {
    const { controller, repo } = createController();
    repo.findByUserId.mockRejectedValue(new AppError(ErrorCode.VALIDATION_ERROR, 'from_invalid', 400));

    await expect(controller.ipList(authContext(), { from: 'not-a-date' }))
      .rejects
      .toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        reasonKey: 'from_invalid',
      });
  });
});

describe('ResStaticController.ipExport', () => {
  it('exports current user proxies with filters and sanitized audit metadata', async () => {
    const { controller, repo, audit } = createController();
    repo.findByUserId.mockResolvedValue(page([proxyInstance()]));
    const ctx = authContext();

    const result = await controller.ipExport(ctx, {
      format: 'HTTP_URL',
      status: 'ACTIVE',
      country_code: 'HK',
      search: 'order-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });

    expect(repo.findByUserId).toHaveBeenCalledWith('user-1', 'site-1', 'tenant-1', {
      page: 1,
      pageSize: 1000,
      status: 'ACTIVE',
      countryCode: 'HK',
      search: 'order-1',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(result).toEqual({
      format: 'HTTP_URL',
      count: 1,
      lines: ['http://proxy-user:plain-pass@1.2.3.4:8000'],
    });
    expect(audit.recordExport).toHaveBeenCalledWith(ctx, { format: 'HTTP_URL', count: 1 });
    expect(JSON.stringify(audit.recordExport.mock.calls[0])).not.toContain('plain-pass');
    expect(JSON.stringify(audit.recordExport.mock.calls[0])).not.toContain('1.2.3.4:8000');
  });

  it('defaults to active IP_PORT_AUTH export', async () => {
    const { controller, repo } = createController();
    repo.findByUserId.mockResolvedValue(page([proxyInstance()]));

    const result = await controller.ipExport(authContext(), {});

    expect(repo.findByUserId).toHaveBeenCalledWith('user-1', 'site-1', 'tenant-1', expect.objectContaining({
      status: 'ACTIVE',
    }));
    expect(result).toMatchObject({
      format: 'IP_PORT_AUTH',
      lines: ['1.2.3.4:8000:proxy-user:plain-pass'],
    });
  });

  it('rejects invalid export format before reading proxies', async () => {
    const { controller, repo, audit } = createController();

    await expect(controller.ipExport(authContext(), { format: 'BAD_FORMAT' as never }))
      .rejects
      .toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        reasonKey: 'proxy_export_format_invalid',
      });
    expect(repo.findByUserId).not.toHaveBeenCalled();
    expect(audit.recordExport).not.toHaveBeenCalled();
  });
});
