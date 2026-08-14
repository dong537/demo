import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireUser } from '../../common/auth/guards';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { CustomerResellerRepository } from './customer-reseller.repository';
import { FederatedUpstreamService } from './federated-upstream.service';

@Controller('customer/reseller/upstream-connections')
@RequireUser()
export class FederatedUpstreamController {
  constructor(
    private readonly reseller: CustomerResellerRepository,
    private readonly service: FederatedUpstreamService,
  ) {}

  @Get()
  async list(@CurrentContext() ctx: AuthenticatedContext, @Query() query: PageQueryDto) {
    const tenant = await this.reseller.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.service.list(ctx.siteId, tenant.id, query);
  }

  @Post()
  async create(@CurrentContext() ctx: AuthenticatedContext, @Body() body: Record<string, unknown>) {
    const tenant = await this.reseller.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.service.create({
      siteId: ctx.siteId,
      tenantId: tenant.id,
      kind: body.kind,
      name: body.name,
      baseUrl: body.baseUrl,
      credentials: body.credentials,
      timeoutMs: body.timeoutMs,
    });
  }

  @Put(':id')
  async update(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const tenant = await this.reseller.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.service.update(ctx.siteId, tenant.id, id, body);
  }

  @Post(':id/scan')
  async scan(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    const tenant = await this.reseller.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.service.scan(ctx.siteId, tenant.id, id);
  }

  @Delete(':id')
  async disable(@CurrentContext() ctx: AuthenticatedContext, @Param('id') id: string) {
    const tenant = await this.reseller.requireOwnedTenant(ctx.siteId, ctx.ownerId);
    return this.service.disable(ctx.siteId, tenant.id, id);
  }
}
