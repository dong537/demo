import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { prisma, OrderStatus } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireTenantId } from '../../wallet/access';
import { WalletRepository } from '../../wallet/wallet.repository';
import { optionalAdminReason, requiredAdminReason } from '../admin-reason';
import { OrdersRepository, Order } from '../orders.repository';

export interface AdminOrderOperationInput {
  reason?: string;
}

export interface AdminOrderOperationResult {
  orderId: string;
  status: OrderStatus;
  fulfillmentJobId?: string;
  wallet?: {
    available: string;
    currency: string;
  };
}

type PrismaTransactionClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class AdminOrderOperationsUseCase {
  constructor(
    private readonly ordersRepo: OrdersRepository,
    private readonly walletRepo: WalletRepository,
  ) {}

  async retryFulfillment(
    ctx: AuthenticatedContext,
    orderId: string,
    input: AdminOrderOperationInput = {},
  ): Promise<AdminOrderOperationResult> {
    const order = await this.getAdminOrder(ctx, orderId);
    if (order.status !== 'FAILED') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_not_retryable', 422);
    }
    if (await this.hasRefundLedger(prisma, order)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_already_refunded', 422);
    }

    const resource = await prisma.platform_resources.findFirst({
      where: { id: order.resourceId, siteId: order.siteId },
      select: { providerCode: true, upstreamAccountId: true },
    });
    if (!resource) throw new AppError(ErrorCode.NOT_FOUND, 'resource_not_found', 404);

    const reason = optionalAdminReason(input);
    const requestId = requestIdStorage.getStore() ?? ctx.requestId;

    return prisma.$transaction(async (tx) => {
      await tx.orders.update({
        where: { id: order.id },
        data: { status: 'PENDING', failReason: null },
      });
      const job = await tx.fulfillment_jobs.create({
        data: {
          id: randomUUID(),
          siteId: order.siteId,
          orderId: order.id,
          providerCode: resource.providerCode,
          upstreamAccountId: resource.upstreamAccountId,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          scheduledAt: new Date(),
        },
      });
      await tx.audit_logs.create({
        data: {
          siteId: order.siteId,
          tenantId: order.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'orders',
          targetId: order.id,
          action: 'order.retry_fulfillment',
          reason,
          requestId,
          meta: { previousStatus: order.status, fulfillmentJobId: job.id },
        },
      });

      return { orderId: order.id, status: 'PENDING', fulfillmentJobId: job.id };
    });
  }

  async refund(
    ctx: AuthenticatedContext,
    orderId: string,
    input: AdminOrderOperationInput = {},
  ): Promise<AdminOrderOperationResult> {
    const order = await this.getAdminOrder(ctx, orderId);
    const wallet = await this.walletRepo.getWalletByUserId(order.userId, order.siteId, order.tenantId);
    if (order.status === 'REFUNDED') {
      return {
        orderId: order.id,
        status: order.status,
        wallet: { available: wallet.available.toString(), currency: wallet.currency },
      };
    }
    if (!['FAILED', 'PENDING', 'FULFILLING'].includes(order.status)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_not_refundable', 422);
    }

    const reason = requiredAdminReason(input);
    const requestId = requestIdStorage.getStore() ?? ctx.requestId;

    const result = await prisma.$transaction(async (tx) => {
      const txClient = tx as PrismaTransactionClient;
      const existingRefund = await this.hasRefundLedger(txClient, order);
      if (!existingRefund) {
        await this.walletRepo.creditWalletTx(
          txClient,
          wallet.id,
          order.totalPrice.toString(),
          order.currency,
          'REFUND',
          order.id,
          'admin_order_refund',
          `order_refund_${order.id}`,
        );
      }

      await tx.fulfillment_jobs.updateMany({
        where: {
          orderId: order.id,
          siteId: order.siteId,
          status: { notIn: ['COMPLETED', 'FAILED'] },
        },
        data: { status: 'FAILED', lastError: reason, completedAt: new Date() },
      });
      const updatedOrder = await tx.orders.update({
        where: { id: order.id },
        data: { status: 'REFUNDED', failReason: reason },
      });
      await tx.audit_logs.create({
        data: {
          siteId: order.siteId,
          tenantId: order.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'orders',
          targetId: order.id,
          action: 'order.refund',
          reason,
          requestId,
          meta: { previousStatus: order.status, ledgerAlreadyExisted: Boolean(existingRefund) },
        },
      });
      const updatedWallet = await tx.wallets.findUniqueOrThrow({ where: { id: wallet.id } });
      return { order: updatedOrder, wallet: updatedWallet };
    });

    return {
      orderId: result.order.id,
      status: result.order.status,
      wallet: { available: result.wallet.available.toString(), currency: result.wallet.currency },
    };
  }

  async manualComplete(
    ctx: AuthenticatedContext,
    orderId: string,
    input: AdminOrderOperationInput = {},
  ): Promise<AdminOrderOperationResult> {
    const order = await this.getAdminOrder(ctx, orderId);
    if (!['PENDING', 'FULFILLING', 'FAILED'].includes(order.status)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_not_manual_completable', 422);
    }
    if (await this.hasRefundLedger(prisma, order)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_already_refunded', 422);
    }

    const reason = requiredAdminReason(input);
    const requestId = requestIdStorage.getStore() ?? ctx.requestId;

    return prisma.$transaction(async (tx) => {
      const latestJob = await tx.fulfillment_jobs.findFirst({
        where: { orderId: order.id, siteId: order.siteId },
        orderBy: { createdAt: 'desc' },
      });
      if (latestJob && latestJob.status !== 'COMPLETED') {
        await tx.fulfillment_jobs.update({
          where: { id: latestJob.id },
          data: { status: 'COMPLETED', completedAt: new Date(), lastError: null },
        });
      }
      await tx.orders.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', failReason: null },
      });
      await tx.audit_logs.create({
        data: {
          siteId: order.siteId,
          tenantId: order.tenantId,
          actorType: 'ADMIN_USER',
          actorId: ctx.ownerId,
          targetType: 'orders',
          targetId: order.id,
          action: 'order.manual_complete',
          reason,
          requestId,
          meta: { previousStatus: order.status, fulfillmentJobId: latestJob?.id ?? null },
        },
      });

      return { orderId: order.id, status: 'COMPLETED', fulfillmentJobId: latestJob?.id };
    });
  }

  private async getAdminOrder(ctx: AuthenticatedContext, orderId: string): Promise<Order> {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.ordersRepo.getByIdForScope(orderId, ctx.siteId, null);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.ordersRepo.getByIdForScope(orderId, ctx.siteId, requireTenantId(ctx));
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
  }

  private async hasRefundLedger(tx: PrismaTransactionClient, order: Order): Promise<boolean> {
    const refund = await tx.ledger_entries.findFirst({
      where: {
        siteId: order.siteId,
        tenantId: order.tenantId,
        userId: order.userId,
        relatedId: order.id,
        type: 'REFUND',
      },
      select: { id: true },
    });
    return Boolean(refund);
  }
}
