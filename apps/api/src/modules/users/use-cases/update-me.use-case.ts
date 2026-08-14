import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { UsersRepository } from '../users.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { requestIdStorage } from '../../../common/logging/request-id.context';
import { requireSelfUser } from '../access';
import { UpdateUserProfileDto, UserProfileDto } from '../dto';

const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 32;

/**
 * Normalizes an optional free-text profile field: trims, treats an empty/whitespace
 * value as cleared (null), and rejects over-length input with a stable reasonKey.
 * A field omitted from the request keeps its current stored value.
 */
function normalizeOptional(
  value: unknown,
  present: boolean,
  current: string | null,
  maxLength: number,
  reasonKey: string,
): string | null {
  if (!present) return current;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return trimmed;
}

@Injectable()
export class UpdateMeUseCase {
  constructor(private readonly repo: UsersRepository) {}

  async execute(ctx: AuthenticatedContext, dto: UpdateUserProfileDto): Promise<UserProfileDto> {
    const owner = requireSelfUser(ctx);
    const current = await this.repo.getSelfProfile(owner);

    const name = normalizeOptional(
      dto.name,
      Object.prototype.hasOwnProperty.call(dto, 'name'),
      current.name,
      MAX_NAME_LENGTH,
      'invalid_name',
    );
    const phone = normalizeOptional(
      dto.phone,
      Object.prototype.hasOwnProperty.call(dto, 'phone'),
      current.phone,
      MAX_PHONE_LENGTH,
      'invalid_phone',
    );

    const updated = await this.repo.updateSelfProfile(owner, { name, phone });

    const requestId = requestIdStorage.getStore() ?? '';
    await prisma.audit_logs.create({
      data: {
        siteId: owner.siteId,
        tenantId: owner.tenantId,
        actorType: 'USER',
        actorId: owner.userId,
        targetType: 'user',
        targetId: owner.userId,
        action: 'user.update_profile',
        requestId,
      },
    });

    return updated;
  }
}
