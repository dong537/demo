import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma } from '@ipeasy/db';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedContext, OwnerType } from './auth-context';
import { AuthRepository } from '../../modules/auth/auth.repository';
import { requestIdStorage } from '../logging/request-id.context';

@Injectable()
export class JwtStrategy {
  constructor(private readonly authRepo: AuthRepository) {}

  async authenticate(bearerToken: string): Promise<AuthenticatedContext & { sessionId: string }> {
    if (bearerToken.startsWith('rt_')) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'refresh_token_not_allowed', 401);
    }

    const hash = crypto.createHash('sha256').update(bearerToken).digest('hex');
    const session = await this.authRepo.findSessionByTokenHash(hash);

    if (session.revokedAt !== null || session.expiresAt < new Date()) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'session_expired', 401);
    }

    const requestId = requestIdStorage.getStore() ?? '';
    let ownerType: OwnerType;

    if (session.ownerType === 'USER') {
      ownerType = 'USER';
    } else {
      const adminUser = await prisma.admin_users.findUnique({ where: { id: session.ownerId } });
      if (!adminUser) throw new AppError(ErrorCode.AUTH_REQUIRED, 'session_expired', 401);
      ownerType = adminUser.role === 'PLATFORM_ADMIN' || adminUser.role === 'OPERATOR'
        ? 'PLATFORM_ADMIN'
        : 'TENANT_ADMIN';
    }

    return {
      ownerId: session.ownerId,
      ownerType,
      siteId: session.siteId,
      tenantId: session.tenantId ?? null,
      scopes: [],
      requestId,
      sessionId: session.id,
    };
  }
}
