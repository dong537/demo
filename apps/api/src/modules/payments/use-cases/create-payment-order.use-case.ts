import { Injectable } from '@nestjs/common';
import { prisma, PaymentChannel } from '@ipeasy/db';
import { PaymentsRepository } from '../payments.repository';
import { PaymentOrderDto, CreatePaymentOrderDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { assertPositiveAmount, assertSameCurrency } from '../../wallet/domain';
import { ConfigService } from '../../../common/config/config.service';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { toPaymentOrderDto } from '../payment-order.mapper';

@Injectable()
export class CreatePaymentOrderUseCase {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(ctx: AuthenticatedContext, dto: CreatePaymentOrderDto): Promise<PaymentOrderDto> {
    if (ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'user_only', 403);
    }
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_required', 403);
    }
    if (!dto.idempotencyKey?.trim()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'idempotency_key_required', 422);
    }

    const platformCurrency = this.config.get('APP_PLATFORM_CURRENCY');
    assertSameCurrency(platformCurrency, dto.currency);
    assertPositiveAmount(dto.amount);

    const tenantId = ctx.tenantId;

    // Idempotency check
    const existing = await this.repo.getPaymentOrderByIdempotencyKey(dto.idempotencyKey, tenantId, ctx.ownerId);
    if (existing) return toPaymentOrderDto(existing);

    const order = await this.repo.createPaymentOrder({
      siteId: ctx.siteId,
      tenantId,
      userId: ctx.ownerId,
      amount: dto.amount,
      currency: dto.currency,
      channel: dto.channel as PaymentChannel,
      idempotencyKey: dto.idempotencyKey,
    });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId,
        actorType: 'USER',
        actorId: ctx.ownerId,
        targetType: 'payment_order',
        targetId: order.id,
        action: 'payment_order.create',
        requestId,
      },
    });

    return toPaymentOrderDto(order);
  }
}
