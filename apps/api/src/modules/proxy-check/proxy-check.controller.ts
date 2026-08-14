import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { CheckProxyUseCase } from './use-cases/check-proxy.use-case';
import { CheckProxyDto, ProxyCheckResultDto } from './dto';

@Controller('proxy-check')
export class ProxyCheckController {
  constructor(private readonly checkUseCase: CheckProxyUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireAuth()
  async check(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CheckProxyDto,
  ): Promise<ProxyCheckResultDto> {
    return this.checkUseCase.execute(ctx, body);
  }
}
