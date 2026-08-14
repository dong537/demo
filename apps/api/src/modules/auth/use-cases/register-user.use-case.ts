import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AuthRepository } from '../auth.repository';
import { RegisterDto, RegisterResponseDto } from '../dto';
import { ConfigService } from '../../../common/config/config.service';
import { requestIdStorage } from '../../../common/logging/request-id.context';

const BCRYPT_COST = 10;
const MIN_PASSWORD_LENGTH = 8;
// Pragmatic single-pass email shape check; full RFC validation is left to the
// account lifecycle, not the signup gate.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly authRepo: AuthRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Self-service customer signup. Validates email shape and password strength,
   * rejects duplicate accounts (without leaking which field collided), lands the
   * user in the site's default signup tenant, then creates the user + zero-balance
   * wallet + audit row in one transaction and returns a session so the new user is
   * logged in immediately.
   */
  async execute(dto: RegisterDto): Promise<RegisterResponseDto> {
    const email = typeof dto.email === 'string' ? dto.email.trim() : '';
    const password = typeof dto.password === 'string' ? dto.password : '';
    const siteId = typeof dto.siteId === 'string' ? dto.siteId : '';
    const tenantId = typeof dto.tenantId === 'string' ? dto.tenantId.trim() : '';

    if (!siteId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'site_required', 400);
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_email', 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'password_too_weak', 400);
    }

    // users.email is globally unique in the schema, so dedup must be global. A
    // uniform error avoids revealing which account already exists.
    const existing = await this.authRepo.findUserByEmail(email);
    if (existing) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'email_taken', 409);
    }

    const tenant = tenantId
      ? await this.authRepo.findSignupTenantById(siteId, tenantId)
      : await this.authRepo.findSignupTenant(siteId);
    if (!tenant) {
      // Misconfigured site (no ACTIVE tenant). Fail loudly instead of guessing.
      throw new AppError(
        tenantId ? ErrorCode.VALIDATION_ERROR : ErrorCode.INTERNAL_ERROR,
        tenantId ? 'signup_tenant_invalid' : 'no_signup_tenant',
        tenantId ? 400 : 500,
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const currency = this.config.get('APP_PLATFORM_CURRENCY');
    const requestId = requestIdStorage.getStore() ?? '';

    const user = await this.authRepo.createUserWithWallet({
      siteId,
      tenantId: tenant.id,
      email,
      passwordHash,
      currency,
      requestId,
    });

    return this.authRepo.issueSession({
      ownerType: 'USER',
      ownerId: user.id,
      siteId,
      tenantId: tenant.id,
    });
  }
}
