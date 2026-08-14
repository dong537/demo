import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthRepository } from '../auth.repository';
import { LoginDto, LoginResponseDto } from '../dto';
import { requestIdStorage } from '../../../common/logging/request-id.context';

@Injectable()
export class LoginUseCase {
  constructor(private readonly authRepo: AuthRepository) {}

  async execute(dto: LoginDto): Promise<LoginResponseDto> {
    const { email, password, siteId } = dto;

    // Try users first, then admin_users
    const user = await prisma.users.findFirst({ where: { email, siteId } });
    const adminUser = user ? null : await prisma.admin_users.findFirst({ where: { email, siteId } });

    const record = user ?? adminUser;
    if (!record) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'invalid_credentials', 401);
    }

    const valid = await bcrypt.compare(password, record.passwordHash);
    if (!valid) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'invalid_credentials', 401);
    }

    const ownerType = user ? 'USER' : 'ADMIN_USER';
    const tenantId = user ? user.tenantId : (adminUser as Prisma.admin_usersGetPayload<Record<string, never>>).tenantId ?? null;

    const { token, expiresAt } = await this.authRepo.issueSession({
      ownerType,
      ownerId: record.id,
      siteId,
      tenantId,
    });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId,
        tenantId,
        actorType: ownerType === 'USER' ? 'USER' : 'ADMIN_USER',
        actorId: record.id,
        action: 'auth.login',
        requestId,
      },
    });

    return { token, expiresAt };
  }
}
