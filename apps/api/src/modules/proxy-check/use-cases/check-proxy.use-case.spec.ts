import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppError } from '../../../common/errors/app-error';
import { ConfigService } from '../../../common/config/config.service';
import { encryptAesGcm } from '../../../common/crypto/aes-gcm';
import { ProxiesRepository, ProxyInstance } from '../../proxies/proxies.repository';
import { ProbeOutcome, ProxyProber } from '../proxy-prober';
import { CheckProxyUseCase } from './check-proxy.use-case';

const ENCRYPTION_KEY = randomBytes(32).toString('hex');

const auditCreate = vi.fn();
vi.mock('@ipeasy/db', () => ({
  prisma: {
    audit_logs: { create: (...args: unknown[]) => auditCreate(...args) },
  },
}));

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

const now = new Date('2026-06-09T00:00:00.000Z');

function proxy(overrides: Partial<ProxyInstance> = {}): ProxyInstance {
  return {
    id: 'proxy-1',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    orderId: 'order-1',
    upstreamOrderMirrorId: 'mirror-1',
    upstreamProxyId: null,
    providerCode: 'IPIPD',
    ip: '203.0.113.10',
    port: 8080,
    username: 'proxy-user',
    password: encryptAesGcm('proxy-pass', ENCRYPTION_KEY),
    protocol: 'HTTP',
    countryCode: 'US',
    regionCode: null,
    ipType: 'STATIC',
    status: 'ACTIVE',
    expiresAt: now,
    businessType: null,
    userNote: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ProxyInstance;
}

function createUseCase(probeOutcome?: ProbeOutcome | (() => Promise<ProbeOutcome>)) {
  const repo = { findById: vi.fn<ProxiesRepository['findById']>() };
  const config = { get: () => ENCRYPTION_KEY } as unknown as ConfigService;
  const prober = {
    probe: vi.fn<ProxyProber['probe']>(async () =>
      typeof probeOutcome === 'function'
        ? probeOutcome()
        : (probeOutcome ?? { reachable: true, latencyMs: 120, exitIp: '198.51.100.5' }),
    ),
  };
  const useCase = new CheckProxyUseCase(repo as unknown as ProxiesRepository, config, prober);
  return { useCase, repo, prober };
}

beforeEach(() => {
  auditCreate.mockReset();
});

describe('CheckProxyUseCase', () => {
  it('returns reachable result with latency and exit IP for an owned proxy and writes audit', async () => {
    const { useCase, repo, prober } = createUseCase({ reachable: true, latencyMs: 142, exitIp: '198.51.100.5' });
    repo.findById.mockResolvedValue(proxy());

    const result = await useCase.execute(authContext(), { proxyId: 'proxy-1' });

    expect(result).toEqual({ reachable: true, latencyMs: 142, exitIp: '198.51.100.5' });
    // password is decrypted only at the boundary and handed to the prober in plaintext
    expect(prober.probe).toHaveBeenCalledWith({
      ip: '203.0.113.10',
      port: 8080,
      username: 'proxy-user',
      password: 'proxy-pass',
      protocol: 'HTTP',
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArg = auditCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(auditArg.data).toMatchObject({
      action: 'proxy.check',
      actorId: 'user-1',
      targetId: 'proxy-1',
      meta: { protocol: 'HTTP', reachable: true, latencyMs: 142 },
    });
  });

  it('does not leak proxy credentials in the result', async () => {
    const { useCase, repo } = createUseCase({ reachable: true, latencyMs: 10, exitIp: '198.51.100.5' });
    repo.findById.mockResolvedValue(proxy());

    const result = await useCase.execute(authContext(), { proxyId: 'proxy-1' });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('proxy-pass');
    expect(serialized).not.toContain('proxy-user');
    expect(serialized).not.toContain('203.0.113.10');
  });

  it('maps an unreachable probe to reachable=false + proxy_unreachable', async () => {
    const { useCase, repo } = createUseCase({ reachable: false, timedOut: false });
    repo.findById.mockResolvedValue(proxy());

    const result = await useCase.execute(authContext(), { proxyId: 'proxy-1' });

    expect(result).toEqual({
      reachable: false,
      error: { code: 'PROXY_UNREACHABLE', reasonKey: 'proxy_unreachable' },
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('maps a timed-out probe to reachable=false + proxy_check_timeout', async () => {
    const { useCase, repo } = createUseCase({ reachable: false, timedOut: true });
    repo.findById.mockResolvedValue(proxy());

    const result = await useCase.execute(authContext(), { proxyId: 'proxy-1' });

    expect(result).toEqual({
      reachable: false,
      error: { code: 'PROXY_TIMEOUT', reasonKey: 'proxy_check_timeout' },
    });
  });

  it('rejects probing another user proxy with NOT_FOUND and never probes', async () => {
    const { useCase, repo, prober } = createUseCase();
    repo.findById.mockResolvedValue(proxy({ userId: 'someone-else' }));

    await expect(useCase.execute(authContext(), { proxyId: 'proxy-1' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'proxy_not_found',
      httpStatus: 404,
    });
    expect(prober.probe).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a proxy from another tenant with NOT_FOUND', async () => {
    const { useCase, repo } = createUseCase();
    repo.findById.mockResolvedValue(proxy({ tenantId: 'other-tenant' }));

    await expect(useCase.execute(authContext(), { proxyId: 'proxy-1' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      reasonKey: 'proxy_not_found',
    });
  });

  it('rejects when proxy does not exist', async () => {
    const { useCase, repo } = createUseCase();
    repo.findById.mockResolvedValue(null);

    await expect(useCase.execute(authContext(), { proxyId: 'missing' })).rejects.toBeInstanceOf(AppError);
  });

  it('rejects non-USER callers with PERMISSION_DENIED', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext({ ownerType: 'TENANT_ADMIN' }), { proxyId: 'proxy-1' }),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_DENIED });
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('rejects a missing proxyId with VALIDATION_ERROR', async () => {
    const { useCase, repo } = createUseCase();

    await expect(
      useCase.execute(authContext(), { proxyId: '   ' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'proxy_id_required' });
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
