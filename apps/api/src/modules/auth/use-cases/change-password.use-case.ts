import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthRepository } from '../auth.repository';
import { ChangePasswordDto } from '../dto';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requestIdStorage } from '../../../common/logging/request-id.context';

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class ChangePasswordUseCase {
  constructor(private readonly authRepo: AuthRepository) {}

  /**
   * Changes the calling USER's login password. Verifies the old password with
   * bcrypt.compare (uniform error that does not reveal whether the account or the
   * password was at fault), enforces a minimum strength on the new password,
   * re-hashes with a production cost, and revokes the user's other sessions so a
   * leaked session elsewhere cannot survive a password change. The current
   * session is kept so the active device stays signed in.
   */
  async execute(
    ctx: AuthenticatedContext,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    if (ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }

    const oldPassword = typeof dto.oldPassword === 'string' ? dto.oldPassword : '';
    const newPassword = typeof dto.newPassword === 'string' ? dto.newPassword : '';

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'password_too_weak', 400);
    }

    const currentHash = await this.authRepo.findUserPasswordHash(ctx.ownerId, ctx.siteId);
    const valid = await bcrypt.compare(oldPassword, currentHash);
    if (!valid) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'old_password_incorrect', 400);
    }

    if (await bcrypt.compare(newPassword, currentHash)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'password_reuse', 400);
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.authRepo.updateUserPassword(ctx.ownerId, ctx.siteId, newHash);
    await this.authRepo.revokeOtherUserSessions(ctx.ownerId, currentSessionId);

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: ctx.siteId,
        tenantId: ctx.tenantId,
        actorType: 'USER',
        actorId: ctx.ownerId,
        targetType: 'user',
        targetId: ctx.ownerId,
        action: 'auth.change_password',
        requestId,
      },
    });
  }
}
