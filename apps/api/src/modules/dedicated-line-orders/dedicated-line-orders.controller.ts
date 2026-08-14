import { Body, Controller, Post } from '@nestjs/common';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { RequireUser } from '../../common/auth/guards';
import { CreateDedicatedLineOrderUseCase } from './create-dedicated-line-order.use-case';
import { CreateDedicatedLineOrderDto } from './dto';

@Controller('dedicated-line-orders')
export class DedicatedLineOrdersController {
  constructor(private readonly createOrder: CreateDedicatedLineOrderUseCase) {}

  @Post()
  @RequireUser()
  create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() dto: CreateDedicatedLineOrderDto,
  ) {
    return this.createOrder.execute(ctx, dto);
  }
}
