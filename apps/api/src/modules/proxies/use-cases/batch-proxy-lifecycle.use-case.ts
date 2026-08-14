import { Injectable } from '@nestjs/common';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ProxyInstance } from '../proxies.repository';
import { RenewProxyUseCase } from './renew-proxy.use-case';
import { ChangePasswordUseCase } from './change-password.use-case';
import { SwitchIpUseCase } from './switch-ip.use-case';

export interface BatchRenewInput {
  proxyIds: string[];
  durationDays: number | string;
  idempotencyKey?: string;
}

export interface BatchProxyIdsInput {
  proxyIds: string[];
}

export type BatchProxyLifecycleItem =
  | { proxyId: string; success: true; proxy: ProxyInstance }
  | { proxyId: string; success: false; error: BatchProxyLifecycleError };

export interface BatchProxyLifecycleError {
  code: string;
  reasonKey: string;
  httpStatus: number;
}

export interface BatchProxyLifecycleResult {
  totalCount: number;
  successCount: number;
  failureCount: number;
  items: BatchProxyLifecycleItem[];
}

@Injectable()
export class BatchProxyLifecycleUseCase {
  constructor(
    private readonly renewUseCase: RenewProxyUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly switchIpUseCase: SwitchIpUseCase,
  ) {}

  renew(ctx: AuthenticatedContext, input: BatchRenewInput): Promise<BatchProxyLifecycleResult> {
    const proxyIds = validateProxyIds(input.proxyIds);
    const durationDays = positiveInteger(input.durationDays, 'duration_days_invalid');
    return runBatch(proxyIds, (proxyId) => this.renewUseCase.execute(
      ctx,
      proxyId,
      durationDays,
      itemIdempotencyKey(input.idempotencyKey, proxyId),
    ));
  }

  changePassword(ctx: AuthenticatedContext, input: BatchProxyIdsInput): Promise<BatchProxyLifecycleResult> {
    const proxyIds = validateProxyIds(input.proxyIds);
    return runBatch(proxyIds, (proxyId) => this.changePasswordUseCase.execute(ctx, proxyId));
  }

  switchIp(ctx: AuthenticatedContext, input: BatchProxyIdsInput): Promise<BatchProxyLifecycleResult> {
    const proxyIds = validateProxyIds(input.proxyIds);
    return runBatch(proxyIds, (proxyId) => this.switchIpUseCase.execute(ctx, proxyId));
  }
}

async function runBatch(
  proxyIds: string[],
  action: (proxyId: string) => Promise<ProxyInstance>,
): Promise<BatchProxyLifecycleResult> {
  const items: BatchProxyLifecycleItem[] = [];
  for (const proxyId of proxyIds) {
    try {
      items.push({ proxyId, success: true, proxy: await action(proxyId) });
    } catch (error: unknown) {
      items.push({ proxyId, success: false, error: toItemError(error) });
    }
  }
  const successCount = items.filter((item) => item.success).length;
  return {
    totalCount: items.length,
    successCount,
    failureCount: items.length - successCount,
    items,
  };
}

function validateProxyIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'proxy_ids_required', 400);
  }
  const proxyIds = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (proxyIds.some((proxyId) => proxyId.length === 0)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'proxy_id_invalid', 400);
  }
  return proxyIds;
}

function positiveInteger(value: number | string, reasonKey: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return parsed;
}

function itemIdempotencyKey(key: string | undefined, proxyId: string): string | undefined {
  return key ? `${key}:${proxyId}` : undefined;
}

function toItemError(error: unknown): BatchProxyLifecycleError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      reasonKey: error.reasonKey,
      httpStatus: error.httpStatus,
    };
  }
  return {
    code: ErrorCode.INTERNAL_ERROR,
    reasonKey: 'internal_error',
    httpStatus: 500,
  };
}
