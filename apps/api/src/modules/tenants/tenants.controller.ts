import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@ipeasy/db';
import { RequireAuth, RequirePlatformAdmin, RequireUser } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertTenantAccess } from '../../common/auth/tenant-guard';
import { isUniqueConstraintError } from '../../common/errors/prisma-errors';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { PageQueryDto } from '../../common/pagination/pagination.dto';
import { ConfigService } from '../../common/config/config.service';
import {
  CreateSelfServiceTenantDto,
  CreateTenantDto,
  SelfServiceTenantResponseDto,
  TenantDetailDto,
  TenantListItemDto,
  TenantPageDto,
  UpdateTenantStatusDto,
} from './dto';
import { TenantsRepository } from './tenants.repository';
import { CreateSelfServiceTenantUseCase } from './use-cases/create-self-service-tenant.use-case';

const BCRYPT_COST = 10;
const MIN_ADMIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly repo: TenantsRepository,
    private readonly config: ConfigService,
    private readonly createSelfServiceTenantUseCase: CreateSelfServiceTenantUseCase,
  ) {}

  @Get()
  @RequireAuth()
  @ApiOkResponse({ type: TenantPageDto })
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: PageQueryDto,
  ) {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.repo.findAll(ctx.siteId, query);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      const tenantId = requireTenantId(ctx);
      const tenant = await this.repo.findById(ctx.siteId, tenantId);
      return {
        page: 1,
        pageSize: 1,
        total: tenant ? 1 : 0,
        items: tenant ? [tenant] : [],
      };
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Post()
  @RequirePlatformAdmin()
  @ApiCreatedResponse({ type: TenantListItemDto })
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateTenantDto,
  ) {
    const code = body.code?.trim();
    const name = body.name?.trim();
    const adminEmail = body.adminEmail?.trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
    if (!code || !name) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_required_fields_missing', 400);
    }
    if (!EMAIL_PATTERN.test(adminEmail ?? '')) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_admin_email_invalid', 400);
    }
    if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_admin_password_weak', 400);
    }

    const adminPasswordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
    const tenant = await this.repo.create({ siteId: ctx.siteId, code, name, adminEmail, adminPasswordHash }).catch((error: unknown) => {
      if (isUniqueConstraintError(error, 'code')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_code_exists', 409);
      }
      if (isUniqueConstraintError(error, 'email')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_admin_email_exists', 409);
      }
      throw error;
    });
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: tenant.id,
        actorType: 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'tenant',
        targetId: tenant.id,
        action: 'tenant.create',
        requestId: requestIdStorage.getStore() ?? '',
        meta: { code, name, adminEmail },
      },
    });
    return toTenantListItem(tenant);
  }

  @Post('self-service')
  @RequireUser()
  @ApiCreatedResponse({ type: SelfServiceTenantResponseDto })
  async createSelfService(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateSelfServiceTenantDto,
  ): Promise<SelfServiceTenantResponseDto> {
    return this.createSelfServiceTenantUseCase.execute(ctx, body);
  }

  @Get(':id')
  @RequireAuth()
  @ApiOkResponse({ type: TenantDetailDto })
  async getById(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    if (ctx.ownerType !== 'PLATFORM_ADMIN') {
      assertTenantAccess(ctx, id);
    }
    const tenant = await this.repo.findById(ctx.siteId, id);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    const stats = await this.repo.getTenantStats(ctx.siteId, id, this.config.get('APP_PLATFORM_CURRENCY'));
    return { ...tenant, ...stats, stats };
  }

  @Put(':id/status')
  @RequirePlatformAdmin()
  @ApiOkResponse({ type: TenantListItemDto })
  async updateStatus(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
    @Body() body: UpdateTenantStatusDto,
  ) {
    if (body.status !== 'ACTIVE' && body.status !== 'SUSPENDED') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_status_invalid', 400);
    }
    const tenant = await this.repo.findById(ctx.siteId, id);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    const updated = await this.repo.updateStatus(ctx.siteId, id, body.status);
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: updated.id,
        actorType: 'ADMIN_USER',
        actorId: ctx.ownerId,
        targetType: 'tenant',
        targetId: updated.id,
        action: 'tenant.status.update',
        requestId: requestIdStorage.getStore() ?? '',
        meta: { from: tenant.status, to: updated.status },
      },
    });
    return updated;
  }
}

function requireTenantId(ctx: AuthenticatedContext): string {
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
  }
  return ctx.tenantId;
}

function toTenantListItem<T extends { adminUserId?: string }>(tenant: T): Omit<T, 'adminUserId'> {
  const { adminUserId: _adminUserId, ...rest } = tenant;
  return rest;
}
