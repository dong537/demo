import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { isUniqueConstraintError } from '../../../common/errors/prisma-errors';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { CreateSelfServiceTenantDto, SelfServiceTenantResponseDto } from '../dto';
import { TenantsRepository } from '../tenants.repository';

@Injectable()
export class CreateSelfServiceTenantUseCase {
  constructor(private readonly tenantsRepo: TenantsRepository) {}

  async execute(ctx: AuthenticatedContext, dto: CreateSelfServiceTenantDto): Promise<SelfServiceTenantResponseDto> {
    if (ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'user_only', 403);
    }

    const code = dto.code?.trim();
    const name = dto.name?.trim();

    if (!code || !name) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_required_fields_missing', 400);
    }

    const existing = await this.tenantsRepo.findOwnedByUser(ctx.siteId, ctx.ownerId);
    if (existing) {
      return { tenant: existing };
    }

    const tenant = await this.tenantsRepo.create({
      siteId: ctx.siteId,
      code,
      name,
      ownerUserId: ctx.ownerId,
    }).catch((error: unknown) => {
      if (isUniqueConstraintError(error, 'code')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_code_exists', 409);
      }
      throw error;
    });

    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: tenant.id,
        actorType: 'USER',
        actorId: ctx.ownerId,
        targetType: 'tenant',
        targetId: tenant.id,
        action: 'tenant.self_service_create',
        requestId: requestIdStorage.getStore() ?? '',
        meta: { code, name, ownerUserId: ctx.ownerId },
      },
    });

    return {
      tenant: toTenantListItem(tenant),
    };
  }
}

function toTenantListItem<T extends { adminUserId?: string }>(tenant: T): Omit<T, 'adminUserId'> {
  const { adminUserId: _adminUserId, ...rest } = tenant;
  return rest;
}
