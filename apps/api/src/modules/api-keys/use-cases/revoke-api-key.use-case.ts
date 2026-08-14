import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ApiKeysRepository } from '../api-keys.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';

@Injectable()
export class RevokeApiKeyUseCase {
  constructor(private readonly repo: ApiKeysRepository) {}

  async execute(ctx: AuthenticatedContext, id: string): Promise<void> {
    const apiKey = await this.repo.findById(id);

    const isOwner = apiKey.ownerId === ctx.ownerId;
    const isPlatformAdmin = ctx.ownerType === 'PLATFORM_ADMIN';
    if (!isOwner && !isPlatformAdmin) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    await this.repo.revoke(id);

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        actorType: ctx.ownerType === 'USER' ? 'USER' : 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'api_key',
        targetId: id,
        action: 'api_key.revoke',
        requestId,
      },
    });
  }
}
