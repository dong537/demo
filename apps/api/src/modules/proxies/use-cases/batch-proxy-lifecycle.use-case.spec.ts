import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ProxyInstance } from '../proxies.repository';
import { BatchProxyLifecycleUseCase } from './batch-proxy-lifecycle.use-case';
import { ChangePasswordUseCase } from './change-password.use-case';
import { RenewProxyUseCase } from './renew-proxy.use-case';
import { SwitchIpUseCase } from './switch-ip.use-case';

function authContext(): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes: [],
    requestId: 'req-1',
  };
}

function proxyInstance(id: string): ProxyInstance {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    siteId: 'site-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    orderId: 'order-1',
    upstreamAccountId: null,
    upstreamOrderMirrorId: 'mirror-1',
    upstreamProxyId: 'upstream-1',
    providerCode: '985proxy',
    ip: '1.2.3.4',
    port: 8000,
    username: 'proxy-user',
    password: 'encrypted-password',
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
  };
}

function createUseCase() {
  const renew = {
    execute: vi.fn<RenewProxyUseCase['execute']>(),
  };
  const changePassword = {
    execute: vi.fn<ChangePasswordUseCase['execute']>(),
  };
  const switchIp = {
    execute: vi.fn<SwitchIpUseCase['execute']>(),
  };

  return {
    renew,
    changePassword,
    switchIp,
    useCase: new BatchProxyLifecycleUseCase(
      renew as unknown as RenewProxyUseCase,
      changePassword as unknown as ChangePasswordUseCase,
      switchIp as unknown as SwitchIpUseCase,
    ),
  };
}

function expectValidationError(action: () => unknown, reasonKey: string) {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey,
      httpStatus: 400,
    });
    return;
  }
  throw new Error(`Expected validation error: ${reasonKey}`);
}

describe('BatchProxyLifecycleUseCase.renew', () => {
  it('returns mixed item results and continues after item-level AppError failures', async () => {
    const { useCase, renew } = createUseCase();
    const ctx = authContext();
    const proxy = proxyInstance('proxy-1');
    renew.execute
      .mockResolvedValueOnce(proxy)
      .mockRejectedValueOnce(new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, 'renew_not_supported', 501));

    const result = await useCase.renew(ctx, {
      proxyIds: ['proxy-1', 'proxy-2'],
      durationDays: '30',
      idempotencyKey: 'batch-key',
    });

    expect(renew.execute).toHaveBeenNthCalledWith(1, ctx, 'proxy-1', 30, 'batch-key:proxy-1');
    expect(renew.execute).toHaveBeenNthCalledWith(2, ctx, 'proxy-2', 30, 'batch-key:proxy-2');
    expect(result).toEqual({
      totalCount: 2,
      successCount: 1,
      failureCount: 1,
      items: [
        { proxyId: 'proxy-1', success: true, proxy },
        {
          proxyId: 'proxy-2',
          success: false,
          error: {
            code: ErrorCode.UNSUPPORTED_CAPABILITY,
            reasonKey: 'renew_not_supported',
            httpStatus: 501,
          },
        },
      ],
    });
  });

  it('rejects invalid batch input before calling single-item use cases', () => {
    const { useCase, renew } = createUseCase();
    const ctx = authContext();

    expectValidationError(() => useCase.renew(ctx, { proxyIds: [], durationDays: 30 }), 'proxy_ids_required');
    expectValidationError(() => useCase.renew(ctx, { proxyIds: ['proxy-1'], durationDays: 0 }), 'duration_days_invalid');
    expectValidationError(() => useCase.renew(ctx, { proxyIds: ['   '], durationDays: 30 }), 'proxy_id_invalid');
    expect(renew.execute).not.toHaveBeenCalled();
  });
});

describe('BatchProxyLifecycleUseCase password and IP lifecycle actions', () => {
  it('delegates password changes through the single-item use case', async () => {
    const { useCase, changePassword } = createUseCase();
    const ctx = authContext();
    const proxy = proxyInstance('proxy-1');
    changePassword.execute.mockResolvedValueOnce(proxy);

    const result = await useCase.changePassword(ctx, { proxyIds: ['proxy-1'] });

    expect(changePassword.execute).toHaveBeenCalledWith(ctx, 'proxy-1');
    expect(result).toEqual({
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [{ proxyId: 'proxy-1', success: true, proxy }],
    });
  });

  it('delegates IP switches through the single-item use case', async () => {
    const { useCase, switchIp } = createUseCase();
    const ctx = authContext();
    const proxy = proxyInstance('proxy-1');
    switchIp.execute.mockResolvedValueOnce(proxy);

    const result = await useCase.switchIp(ctx, { proxyIds: ['proxy-1'] });

    expect(switchIp.execute).toHaveBeenCalledWith(ctx, 'proxy-1');
    expect(result).toEqual({
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [{ proxyId: 'proxy-1', success: true, proxy }],
    });
  });
});
