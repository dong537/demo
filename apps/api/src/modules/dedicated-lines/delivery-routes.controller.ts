import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { DeliveryRouteImportUseCase } from './delivery-route-import.use-case';
import { DedicatedLineDeliveryUseCase } from './dedicated-line-delivery.use-case';
import { RequireUser } from '../../common/auth/guards';
import { RenewDedicatedLineUseCase } from './renew-dedicated-line.use-case';
import { DedicatedLineLifecycleUseCase } from './dedicated-line-lifecycle.use-case';
import { DedicatedLineLifecycleResultDto } from './dedicated-line-lifecycle.dto';

@Controller('admin/delivery-routes')
export class DeliveryRoutesController {
  constructor(private readonly importUseCase: DeliveryRouteImportUseCase) {}

  @Post('import')
  @RequireAuth()
  import(@CurrentContext() ctx: AuthenticatedContext, @Body() body: unknown) {
    return this.importUseCase.execute(ctx, body);
  }
}

@Controller('dedicated-lines')
@RequireUser()
export class DedicatedLineDeliveryController {
  constructor(
    private readonly delivery: DedicatedLineDeliveryUseCase,
    private readonly renew: RenewDedicatedLineUseCase,
    private readonly lifecycle: DedicatedLineLifecycleUseCase,
  ) {}

  @Get()
  list(@CurrentContext() ctx: AuthenticatedContext) {
    return this.delivery.list(ctx);
  }

  @Get(':id')
  get(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    return this.delivery.get(ctx, id);
  }

  @Post(':id/renew')
  renewLine(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string, @Body() body: unknown) {
    return this.renew.execute(ctx, id, body);
  }

  @Post(':id/suspend')
  @ApiCreatedResponse({ type: DedicatedLineLifecycleResultDto })
  suspend(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    return this.lifecycle.execute(ctx, id, 'suspend');
  }

  @Post(':id/resume')
  @ApiCreatedResponse({ type: DedicatedLineLifecycleResultDto })
  resume(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    return this.lifecycle.execute(ctx, id, 'resume');
  }
}
