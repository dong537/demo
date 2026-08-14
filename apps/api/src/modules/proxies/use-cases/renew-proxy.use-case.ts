import { Injectable } from '@nestjs/common';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ProxyLifecycleService } from '../proxy-lifecycle.service';

@Injectable()
export class RenewProxyUseCase {
  constructor(private readonly lifecycle: ProxyLifecycleService) {}

  async execute(ctx: AuthenticatedContext, proxyId: string, durationDays: number, idempotencyKey?: string) {
    return this.lifecycle.execute({ proxyId, ctx, action: 'renew', durationDays, idempotencyKey });
  }
}
