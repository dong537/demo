import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CreatePaymentOrderUseCase } from './use-cases/create-payment-order.use-case';
import { ConfirmPaymentOrderUseCase } from './use-cases/confirm-payment-order.use-case';
import { PaymentsRepository } from './payments.repository';
import { ConfirmPaymentOrderDto, CreatePaymentOrderDto, PaymentOrderDto } from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PaymentOrderStatus, PaymentChannel } from '@ipeasy/db';
import { requireTenantId } from '../wallet/access';
import { toPaymentOrderDto } from './payment-order.mapper';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly createUseCase: CreatePaymentOrderUseCase,
    private readonly confirmUseCase: ConfirmPaymentOrderUseCase,
    private readonly repo: PaymentsRepository,
  ) {}

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreatePaymentOrderDto,
  ): Promise<PaymentOrderDto> {
    return this.createUseCase.execute(ctx, body);
  }

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto & { userId?: string; status?: PaymentOrderStatus; channel?: PaymentChannel },
  ): Promise<PageResult<PaymentOrderDto>> {
    const tenantId = paymentListTenantScope(ctx);
    const effectiveUserId = ctx.ownerType === 'USER' ? ctx.ownerId : query.userId;
    const result = await this.repo.listPaymentOrders(ctx.siteId, tenantId, { ...query, userId: effectiveUserId });
    return {
      ...result,
      items: result.items.map(toPaymentOrderDto),
    };
  }

  @Get(':id')
  @RequireAuth()
  async detail(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ): Promise<PaymentOrderDto> {
    const tenantId = paymentDetailTenantScope(ctx);
    const order = await this.repo.getPaymentOrderById(id, ctx.siteId, tenantId);
    if (ctx.ownerType === 'USER' && order.userId !== ctx.ownerId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'cannot_read_other_order', 403);
    }
    return toPaymentOrderDto(order);
  }

  @Post(':id/confirm')
  @RequireAuth()
  async confirm(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: ConfirmPaymentOrderDto,
  ): Promise<{ order: PaymentOrderDto; wallet: { available: string; currency: string } }> {
    return this.confirmUseCase.execute(ctx, id, body);
  }
}

function paymentListTenantScope(ctx: AuthenticatedContext): string | null {
  if (ctx.ownerType === 'PLATFORM_ADMIN') return null;
  if (ctx.ownerType === 'USER' || ctx.ownerType === 'TENANT_ADMIN') return requireTenantId(ctx);
  throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
}

function paymentDetailTenantScope(ctx: AuthenticatedContext): string | null {
  if (ctx.ownerType === 'PLATFORM_ADMIN') return null;
  if (ctx.ownerType === 'USER' || ctx.ownerType === 'TENANT_ADMIN') return requireTenantId(ctx);
  throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
}
