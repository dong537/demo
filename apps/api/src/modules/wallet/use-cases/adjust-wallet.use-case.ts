import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { WalletRepository } from '../wallet.repository';
import { AdjustWalletDto, WalletDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { assertTenantAccess } from '../../../common/auth/tenant-guard';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertPositiveAmount, assertSameCurrency } from '../domain';
import { requestIdStorage } from '../../../common/logging/request-id.context';

type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class AdjustWalletUseCase {
  constructor(private readonly repo: WalletRepository) {}

  async execute(ctx: AuthenticatedContext, userId: string, dto: AdjustWalletDto): Promise<WalletDto> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
    }

    assertPositiveAmount(dto.amount);
    if (!dto.reason) throw new AppError(ErrorCode.VALIDATION_ERROR, 'reason_required', 400);
    if (!dto.idempotencyKey) throw new AppError(ErrorCode.VALIDATION_ERROR, 'idempotency_key_required', 400);

    const wallet = await this.repo.getWalletByUserId(userId, ctx.siteId);
    if (ctx.ownerType === 'TENANT_ADMIN') {
      assertTenantAccess(ctx, wallet.tenantId);
    }

    assertSameCurrency(wallet.currency, dto.currency);

    const idempotencyKey = dto.idempotencyKey;
    const reason = dto.reason;
    const requestId = requestIdStorage.getStore() ?? '';

    const updatedWallet = await prisma.$transaction(async (tx) => {
      const txClient = tx as PrismaTransactionClient;
      if (dto.direction === 'credit') {
        await this.repo.creditWalletTx(txClient, wallet.id, dto.amount, dto.currency, 'ADJUSTMENT', ctx.ownerId, reason, idempotencyKey);
      } else {
        await this.repo.debitWalletTx(txClient, wallet.id, dto.amount, dto.currency, 'ADJUSTMENT', ctx.ownerId, reason, idempotencyKey);
      }

      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: wallet.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'wallet',
          targetId: wallet.id,
          action: 'wallet.adjust',
          reason,
          requestId,
          meta: { targetUserId: userId, amount: dto.amount, direction: dto.direction, idempotencyKey },
        },
      });

      return tx.wallets.findUniqueOrThrow({ where: { id: wallet.id } });
    });

    return {
      id: updatedWallet.id,
      userId: updatedWallet.userId,
      available: updatedWallet.available.toString(),
      frozen: updatedWallet.frozen.toString(),
      currency: updatedWallet.currency,
      updatedAt: updatedWallet.updatedAt,
    };
  }
}
