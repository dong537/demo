import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { requireTenantId } from '../../wallet/access';

const IMPERSONATION_TTL_MS = 2 * 60 * 60 * 1000;

export interface ImpersonateUserResult {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class ImpersonateUserUseCase {
  async execute(ctx: AuthenticatedContext, userId: string): Promise<ImpersonateUserResult> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const tenantId = ctx.ownerType === 'TENANT_ADMIN' ? requireTenantId(ctx) : null;
    const user = await prisma.users.findFirst({
      where: {
        id: userId,
        siteId: ctx.siteId,
        ...(tenantId ? { tenantId } : {}),
        status: 'ACTIVE',
      },
      select: { id: true, tenantId: true },
    });
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    }
    if (!user.tenantId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'user_tenant_missing', 422);
    }

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.sessions.create({
        data: {
          ownerType: 'USER',
          ownerId: user.id,
          siteId: ctx.siteId,
          tenantId: user.tenantId,
          token: tokenHash,
          expiresAt,
        },
        select: { expiresAt: true },
      });

      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: user.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'user',
          targetId: user.id,
          action: 'users.impersonate',
          requestId: ctx.requestId,
        },
      });

      return created;
    });

    return { token: plainToken, expiresAt: session.expiresAt };
  }
}
