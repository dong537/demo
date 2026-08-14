import { Injectable } from '@nestjs/common';
import { WalletRepository } from '../wallet.repository';
import { WalletDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { prisma } from '@ipeasy/db';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { getWalletForContext } from '../access';

@Injectable()
export class GetWalletUseCase {
  constructor(private readonly repo: WalletRepository) {}

  async execute(ctx: AuthenticatedContext, userId: string): Promise<WalletDto> {
    const wallet = await getWalletForContext(this.repo, ctx, userId);
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      const requestId = requestIdStorage.getStore() ?? '';
      await prisma.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: wallet.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'wallet',
          targetId: wallet.id,
          action: 'wallet.read',
          requestId,
        },
      });
    }

    return {
      id: wallet.id,
      userId: wallet.userId,
      available: wallet.available.toString(),
      frozen: wallet.frozen.toString(),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }
}
