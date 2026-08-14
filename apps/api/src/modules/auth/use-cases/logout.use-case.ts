import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthRepository } from '../auth.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';

@Injectable()
export class LogoutUseCase {
  constructor(private readonly authRepo: AuthRepository) {}

  async execute(ctx: AuthenticatedContext, sessionId: string): Promise<void> {
    await this.authRepo.revokeSession(sessionId);

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        actorType: ctx.ownerType === 'USER' ? 'USER' : 'ADMIN_USER',
        actorId: ctx.ownerId,
        action: 'auth.logout',
        requestId,
      },
    });
  }
}
