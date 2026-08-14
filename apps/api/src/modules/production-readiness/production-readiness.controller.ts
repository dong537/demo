import { Controller, Get } from '@nestjs/common';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequirePlatformAdmin } from '../../common/auth/guards';
import { ProductionReadinessResult, ProductionReadinessUseCase } from './production-readiness.use-case';

@Controller('admin/production-readiness')
export class ProductionReadinessController {
  constructor(private readonly useCase: ProductionReadinessUseCase) {}

  @Get()
  @RequirePlatformAdmin()
  get(@CurrentContext() ctx: AuthenticatedContext): Promise<ProductionReadinessResult> {
    return this.useCase.execute(ctx);
  }
}
