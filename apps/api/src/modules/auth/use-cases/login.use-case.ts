import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthRepository } from '../auth.repository';
import { LoginDto, LoginResponseDto } from '../dto';
import { requestIdStorage } from '../../../common/logging/request-id.context';

export type LoginIdentity = {
  ownerType: 'USER' | 'ADMIN_USER';
  ownerId: string;
  siteId: string;
  tenantId: string | null;
  email: string;
  name: string | null;
  role: string;
};

export type LegacyLoginResult = {
  token: string;
  expiresAt: Date;
  refreshToken: string;
  identity: LoginIdentity;
};

@Injectable()
export class LoginUseCase {
  constructor(private readonly authRepo: AuthRepository) {}

  async execute(dto: LoginDto): Promise<LoginResponseDto> {
    const identity = await this.authenticate(dto);
    const { token, expiresAt } = await this.authRepo.issueSession(identity);
    await this.auditLogin(identity);

    return { token, expiresAt };
  }

  async executeLegacy(dto: LoginDto, expectedOwnerType: 'USER' | 'ADMIN_USER'): Promise<LegacyLoginResult> {
    const identity = await this.authenticate(dto, expectedOwnerType);
    const access = await this.authRepo.issueSession(identity);
    const refresh = await this.authRepo.issueRefreshSession(identity);
    await this.auditLogin(identity);
    return { token: access.token, expiresAt: access.expiresAt, refreshToken: refresh.token, identity };
  }

  private async authenticate(dto: LoginDto, expectedOwnerType?: 'USER' | 'ADMIN_USER'): Promise<LoginIdentity> {
    const { email, password, siteId } = dto;
    const user = expectedOwnerType === 'ADMIN_USER'
      ? null
      : await prisma.users.findFirst({ where: { email, siteId } });
    const adminUser = expectedOwnerType === 'USER'
      ? null
      : user ? null : await prisma.admin_users.findFirst({ where: { email, siteId } });
    const record = user ?? adminUser;
    if (!record || !(await bcrypt.compare(password, record.passwordHash))) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'invalid_credentials', 401);
    }
    const ownerType = user ? 'USER' : 'ADMIN_USER';
    const admin = adminUser as Prisma.admin_usersGetPayload<Record<string, never>> | null;
    return {
      ownerType,
      ownerId: record.id,
      siteId,
      tenantId: user ? user.tenantId : admin?.tenantId ?? null,
      email: record.email,
      name: user?.name ?? null,
      role: user ? 'user' : String(admin?.role ?? 'admin').toLowerCase(),
    };
  }

  private async auditLogin(identity: LoginIdentity): Promise<void> {
    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: identity.siteId,
        tenantId: identity.tenantId,
        actorType: identity.ownerType === 'USER' ? 'USER' : 'ADMIN_USER',
        actorId: identity.ownerId,
        action: 'auth.login',
        requestId,
      },
    });
  }
}
