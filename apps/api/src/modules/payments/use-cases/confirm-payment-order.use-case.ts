import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { PaymentsRepository } from '../payments.repository';
import { WalletRepository } from '../../wallet/wallet.repository';
import { PaymentOrderDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertCanConfirm } from '../domain';
import { ConfigService } from '../../../common/config/config.service';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { Prisma } from '@ipeasy/db';
import { ConfirmPaymentOrderDto } from '../dto';
import { requireTenantId } from '../../wallet/access';
import { toPaymentOrderDto } from '../payment-order.mapper';

type PaymentOrderStatus = Prisma.payment_ordersGetPayload<Record<string, never>>['status'];
type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class ConfirmPaymentOrderUseCase {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly walletRepo: WalletRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(
    ctx: AuthenticatedContext,
    orderId: string,
    dto: ConfirmPaymentOrderDto = {},
  ): Promise<{ order: PaymentOrderDto; wallet: { available: string; currency: string } }> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
    }

    if (this.config.get('PAYMENT_CONFIRMATION_ENABLED') !== 'true') {
      throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'payment_confirmation_disabled', 503);
    }

    const reason = dto.reason?.trim();
    if (!reason) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'reason_required', 400);
    }

    // PLATFORM_ADMIN can confirm across tenants (audit log records the action);
    // TENANT_ADMIN is restricted to its own tenant.
    const scopeTenantId = ctx.ownerType === 'TENANT_ADMIN' ? requireTenantId(ctx) : null;
    const order = await this.repo.getPaymentOrderById(orderId, ctx.siteId, scopeTenantId);

    // Idempotency: a completed order with its deposit ledger can be confirmed
    // repeatedly without mutating the wallet again.
    const existingEntry = await prisma.ledger_entries.findFirst({
      where: {
        siteId: order.siteId,
        tenantId: order.tenantId,
        userId: order.userId,
        relatedId: orderId,
        type: 'DEPOSIT',
      },
    });
    if (existingEntry) {
      const wallet = await this.walletRepo.getWalletByUserId(order.userId, order.siteId, order.tenantId);
      return {
        order: toPaymentOrderDto(order),
        wallet: { available: wallet.available.toString(), currency: wallet.currency },
      };
    }

    assertCanConfirm(order.status as PaymentOrderStatus);

    // Use the order's own tenantId for wallet lookup so PLATFORM_ADMIN reaches the right wallet
    const wallet = await this.walletRepo.getWalletByUserId(order.userId, order.siteId, order.tenantId);
    const requestId = requestIdStorage.getStore() ?? '';

    const result = await prisma.$transaction(async (tx) => {
      const txClient = tx as PrismaTransactionClient;
      await this.repo.updatePaymentOrderStatus(txClient, orderId, 'CONFIRMING');
      await this.walletRepo.creditWalletTx(
        txClient,
        wallet.id,
        order.amount.toString(),
        order.currency,
        'DEPOSIT',
        orderId,
        'payment_order_confirmed',
        `pay_confirm_${orderId}`,
      );
      const confirmed = await this.repo.updatePaymentOrderStatus(txClient, orderId, 'COMPLETED', {
        confirmedBy: ctx.ownerId,
        confirmedAt: new Date(),
      });
      await tx.audit_logs.create({
        data: {
          siteId: ctx.siteId,
          tenantId: order.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'payment_order',
          targetId: orderId,
          action: 'payment_order.confirm',
          reason,
          requestId,
        },
      });
      const updatedWallet = await tx.wallets.findUniqueOrThrow({ where: { id: wallet.id } });
      return { order: confirmed, wallet: updatedWallet };
    });

    return {
      order: toPaymentOrderDto({ ...result.order, user: order.user }),
      wallet: { available: result.wallet.available.toString(), currency: result.wallet.currency },
    };
  }
}
