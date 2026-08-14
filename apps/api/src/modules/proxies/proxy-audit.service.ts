import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import type { Prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ProxyInstance } from './proxies.repository';
import type { ProxyLifecycleAction } from './proxy-lifecycle.service';

type ProxyAuditLifecycleResult = 'success' | 'failed';

@Injectable()
export class ProxyAuditService {
  async recordExport(ctx: AuthenticatedContext, input: { format: string; count: number }): Promise<void> {
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        actorType: actorType(ctx),
        actorId: ctx.ownerId,
        targetType: 'proxy_instances',
        targetId: null,
        action: 'proxy.export',
        requestId: ctx.requestId,
        meta: {
          format: input.format,
          count: input.count,
        },
      },
    });
  }

  async recordLifecycle(
    ctx: AuthenticatedContext,
    proxy: ProxyInstance,
    action: ProxyLifecycleAction,
    result: ProxyAuditLifecycleResult,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: proxy.tenantId,
        actorType: actorType(ctx),
        actorId: ctx.ownerId,
        targetType: 'proxy_instances',
        targetId: proxy.id,
        action: `proxy.${auditActionName(action)}.${result}`,
        reason: typeof meta['reasonKey'] === 'string' ? meta['reasonKey'] : undefined,
        requestId: ctx.requestId,
        meta: {
          providerCode: proxy.providerCode,
          orderId: proxy.orderId,
          upstreamProxyId: proxy.upstreamProxyId,
          ...meta,
        } as Prisma.InputJsonObject,
      },
    });
  }

  errorMeta(error: unknown): Record<string, unknown> {
    if (error instanceof AppError) {
      return {
        code: error.code,
        reasonKey: error.reasonKey,
        httpStatus: error.httpStatus,
      };
    }
    return {
      code: 'INTERNAL_ERROR',
      reasonKey: 'internal_error',
    };
  }
}

function actorType(ctx: AuthenticatedContext): 'USER' | 'ADMIN_USER' | 'SYSTEM' {
  if (ctx.ownerType === 'USER') return 'USER';
  if (ctx.ownerType === 'SYSTEM') return 'SYSTEM';
  return 'ADMIN_USER';
}

function auditActionName(action: ProxyLifecycleAction): 'renew' | 'change_password' | 'switch_ip' {
  if (action === 'renew') return 'renew';
  if (action === 'changePassword') return 'change_password';
  return 'switch_ip';
}
