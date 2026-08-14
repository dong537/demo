import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { prisma, Prisma } from '@ipeasy/db';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { RequireAuth } from '../../common/auth/guards';
import { assertTenantAccess } from '../../common/auth/tenant-guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { TenantBrandDto, UpdateTenantBrandConfigDto } from './dto';
import { TenantBrandConfig, TenantsRepository } from './tenants.repository';
import { assertBrandConfig } from './tenant-brand.validation';

@Controller('tenants/:id/brand')
export class TenantBrandController {
  constructor(private readonly repo: TenantsRepository) {}

  @Get()
  @ApiOkResponse({ type: TenantBrandDto })
  async get(@Param('id') id: string) {
    const brand = await this.repo.findBrandById(id);
    if (!brand) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    return brand;
  }

  @Put()
  @RequireAuth()
  @ApiOkResponse({ type: TenantBrandDto })
  async update(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateTenantBrandConfigDto,
  ) {
    await this.assertCanManageTenantBrand(ctx, id);
    const brandConfig = assertBrandConfig(body);
    const updated = await this.repo.updateBrandConfig(ctx.siteId, id, brandConfig);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);

    await writeAudit(ctx, id, brandConfig);
    return updated;
  }

  private async assertCanManageTenantBrand(ctx: AuthenticatedContext, tenantId: string): Promise<void> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    const tenant = await this.repo.findById(ctx.siteId, tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    assertTenantAccess(ctx, tenantId);
  }
}

async function writeAudit(
  ctx: AuthenticatedContext,
  tenantId: string,
  brandConfig: TenantBrandConfig,
): Promise<void> {
  await prisma.audit_logs.create({
    data: {
      siteId: ctx.siteId,
      tenantId,
      actorType: 'ADMIN_USER',
      actorId: ctx.ownerId,
      targetType: 'tenant',
      targetId: tenantId,
      action: 'tenant.brand.update',
      requestId: requestIdStorage.getStore() ?? ctx.requestId,
      meta: {
        changedFields: ['siteName', 'logoUrl', 'primaryColor', 'customDomain', 'supportEmail'],
        brandConfig,
      } as Prisma.InputJsonObject,
    },
  });
}
