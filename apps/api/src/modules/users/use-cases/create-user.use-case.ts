import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { isUniqueConstraintError } from '../../../common/errors/prisma-errors';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ConfigService } from '../../../common/config/config.service';
import { CreateUserDto, CreatedUserDto } from '../dto';

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CreateUserUseCase {
  constructor(private readonly config: ConfigService) {}

  async execute(ctx: AuthenticatedContext, dto: CreateUserDto): Promise<CreatedUserDto> {
    if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'admin_only', 403);
    }

    const email = typeof dto.email === 'string' ? dto.email.trim() : '';
    const password = typeof dto.password === 'string' ? dto.password : '';
    const requestedTenantId = typeof dto.tenantId === 'string' ? dto.tenantId.trim() : '';
    const tenantId = ctx.ownerType === 'TENANT_ADMIN' ? ctx.tenantId : requestedTenantId;

    if (!EMAIL_PATTERN.test(email)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_email', 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'password_too_weak', 400);
    }
    if (!tenantId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'tenant_required', 400);
    }

    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, siteId: ctx.siteId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!tenant) {
      throw new AppError(ErrorCode.NOT_FOUND, 'tenant_not_found', 404);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const currency = this.config.get('APP_PLATFORM_CURRENCY');

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            siteId: ctx.siteId,
            tenantId: tenant.id,
            email,
            passwordHash,
            status: 'ACTIVE',
            kycStatus: 'NONE',
            riskStatus: 'NORMAL',
          },
          select: {
            id: true,
            email: true,
            tenantId: true,
            status: true,
            kycStatus: true,
            createdAt: true,
          },
        });

        await tx.wallets.create({
          data: {
            siteId: ctx.siteId,
            tenantId: tenant.id,
            userId: user.id,
            available: '0',
            frozen: '0',
            currency,
          },
        });

        await tx.audit_logs.create({
          data: {
            siteId: ctx.siteId,
            tenantId: tenant.id,
            actorType: 'ADMIN_USER',
            actorId: ctx.ownerId,
            targetType: 'user',
            targetId: user.id,
            action: 'users.create',
            requestId: ctx.requestId,
          },
        });

        return user;
      });
    } catch (error) {
      if (isUniqueConstraintError(error, 'email')) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'email_taken', 409);
      }
      throw error;
    }
  }
}
