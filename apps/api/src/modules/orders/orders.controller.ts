import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiGoneResponse } from '@nestjs/swagger';
import { OrderStatus } from '@ipeasy/db';
import { RequireAuth, RequireUser } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AdminOrderOperationsUseCase } from './use-cases/admin-order-operations.use-case';
import {
  AdminCreateStaticProxyOrderDto,
  AdminOrderOperationDto,
  AdminOrderOperationResultDto,
  CreateStaticProxyOrderDto,
  RequiredAdminOrderOperationDto,
} from './dto';
import { OrdersRepository } from './orders.repository';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requireTenantId } from '../wallet/access';
import { assertStaticProxyPurchaseDisabled } from './static-purchase-disabled';

type OrderListQuery = PageQueryDto & { tenantId?: string; userId?: string; status?: OrderStatus };

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly adminOrderOps: AdminOrderOperationsUseCase,
    private readonly ordersRepo: OrdersRepository,
  ) {}

  @Post('static-proxy')
  @RequireUser()
  @ApiGoneResponse({ description: 'Static proxy purchase is disabled' })
  async createStaticProxy(
    @CurrentContext() _ctx: AuthenticatedContext,
    @Body() _body: CreateStaticProxyOrderDto,
  ) {
    assertStaticProxyPurchaseDisabled();
  }

  @Post('users/:userId/static-proxy')
  @RequireAuth()
  @ApiBody({ type: AdminCreateStaticProxyOrderDto })
  @ApiGoneResponse({ description: 'Static proxy purchase is disabled' })
  async createStaticProxyForUser(
    @CurrentContext() _ctx: AuthenticatedContext,
    @Param('userId') _userId: string,
    @Body() _body: AdminCreateStaticProxyOrderDto,
  ) {
    assertStaticProxyPurchaseDisabled();
  }

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: OrderListQuery,
  ): Promise<PageResult<unknown>> {
    if (ctx.ownerType === 'USER') {
      return this.ordersRepo.list(ctx.ownerId, requireTenantId(ctx), query);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.ordersRepo.listForAdmin(ctx.siteId, requireTenantId(ctx), query);
    }
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.ordersRepo.listForAdmin(ctx.siteId, query.tenantId ?? null, query);
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Post(':id/retry-fulfillment')
  @RequireAuth()
  @ApiBody({ type: AdminOrderOperationDto, required: false })
  @ApiCreatedResponse({ type: AdminOrderOperationResultDto })
  async retryFulfillment(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: AdminOrderOperationDto = {},
  ) {
    return this.adminOrderOps.retryFulfillment(ctx, id, body);
  }

  @Post(':id/refund')
  @RequireAuth()
  @ApiBody({ type: RequiredAdminOrderOperationDto })
  @ApiCreatedResponse({ type: AdminOrderOperationResultDto })
  async refund(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: RequiredAdminOrderOperationDto,
  ) {
    return this.adminOrderOps.refund(ctx, id, body);
  }

  @Post(':id/manual-complete')
  @RequireAuth()
  @ApiBody({ type: RequiredAdminOrderOperationDto })
  @ApiCreatedResponse({ type: AdminOrderOperationResultDto })
  async manualComplete(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: RequiredAdminOrderOperationDto,
  ) {
    return this.adminOrderOps.manualComplete(ctx, id, body);
  }

  @Get(':id/fulfillment')
  @RequireAuth()
  async getFulfillment(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    await this.readOrderForContext(ctx, id);
    return this.ordersRepo.getFulfillmentDetail(id, ctx.siteId);
  }

  @Get(':id')
  @RequireAuth()
  async getById(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    return this.readOrderForContext(ctx, id);
  }

  private async readOrderForContext(ctx: AuthenticatedContext, id: string) {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.ordersRepo.getByIdForScope(id, ctx.siteId, null);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.ordersRepo.getByIdForScope(id, ctx.siteId, requireTenantId(ctx));
    }
    if (ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const order = await this.ordersRepo.getByIdForScope(id, ctx.siteId, requireTenantId(ctx));
    if (order.userId !== ctx.ownerId) {
      throw new AppError(ErrorCode.NOT_FOUND, 'order_not_found', 404);
    }
    return order;
  }
}
