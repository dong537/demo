import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode } from '../../../common/errors/error-codes';

const bcrypt = vi.hoisted(() => ({
  hash: vi.fn(),
}));
vi.mock('bcryptjs', () => bcrypt);

import { RegisterUserUseCase } from './register-user.use-case';
import { AuthRepository } from '../auth.repository';
import { ConfigService } from '../../../common/config/config.service';

function repoMock(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findSignupTenant: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
    findSignupTenantById: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
    createUserWithWallet: vi.fn().mockResolvedValue({ id: 'user-new' }),
    issueSession: vi
      .fn()
      .mockResolvedValue({ token: 'plain-token', expiresAt: new Date('2026-06-16T00:00:00.000Z') }),
    ...overrides,
  } as unknown as AuthRepository;
}

function configMock(currency = 'CNY'): ConfigService {
  return { get: vi.fn().mockReturnValue(currency) } as unknown as ConfigService;
}

const validDto = { email: 'new@example.com', password: 'Customer123!', siteId: 'site-1' };

beforeEach(() => {
  bcrypt.hash.mockReset();
  bcrypt.hash.mockResolvedValue('hashed-pw');
});

describe('RegisterUserUseCase', () => {
  it('rejects an invalid email before any write', async () => {
    const repo = repoMock();
    const useCase = new RegisterUserUseCase(repo, configMock());

    await expect(
      useCase.execute({ ...validDto, email: 'not-an-email' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'invalid_email' });
    expect(repo.findUserByEmail).not.toHaveBeenCalled();
    expect(repo.createUserWithWallet).not.toHaveBeenCalled();
  });

  it('rejects a weak password before any write', async () => {
    const repo = repoMock();
    const useCase = new RegisterUserUseCase(repo, configMock());

    await expect(
      useCase.execute({ ...validDto, password: 'short' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'password_too_weak' });
    expect(repo.createUserWithWallet).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email with a uniform error and creates nothing', async () => {
    const repo = repoMock({ findUserByEmail: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const useCase = new RegisterUserUseCase(repo, configMock());

    await expect(useCase.execute(validDto)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'email_taken',
      httpStatus: 409,
    });
    expect(repo.createUserWithWallet).not.toHaveBeenCalled();
    expect(repo.issueSession).not.toHaveBeenCalled();
  });

  it('fails loudly when the site has no signup tenant', async () => {
    const repo = repoMock({ findSignupTenant: vi.fn().mockResolvedValue(null) });
    const useCase = new RegisterUserUseCase(repo, configMock());

    await expect(useCase.execute(validDto)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      reasonKey: 'no_signup_tenant',
    });
    expect(repo.createUserWithWallet).not.toHaveBeenCalled();
  });

  it('hashes the password and creates user+wallet+audit in the default tenant, then issues a session', async () => {
    const repo = repoMock();
    const useCase = new RegisterUserUseCase(repo, configMock('CNY'));

    const result = await useCase.execute(validDto);

    expect(bcrypt.hash).toHaveBeenCalledWith('Customer123!', 10);
    expect(repo.findSignupTenant).toHaveBeenCalledWith('site-1');
    expect(repo.createUserWithWallet).toHaveBeenCalledWith({
      siteId: 'site-1',
      tenantId: 'tenant-1',
      email: 'new@example.com',
      passwordHash: 'hashed-pw',
      currency: 'CNY',
      requestId: '',
    });
    expect(repo.issueSession).toHaveBeenCalledWith({
      ownerType: 'USER',
      ownerId: 'user-new',
      siteId: 'site-1',
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ token: 'plain-token', expiresAt: new Date('2026-06-16T00:00:00.000Z') });
  });

  it('uses the requested active signup tenant for reseller-domain registration', async () => {
    const repo = repoMock({ findSignupTenantById: vi.fn().mockResolvedValue({ id: 'tenant-reseller' }) });
    const useCase = new RegisterUserUseCase(repo, configMock('CNY'));

    await useCase.execute({ ...validDto, tenantId: 'tenant-reseller' });

    expect(repo.findSignupTenant).not.toHaveBeenCalled();
    expect(repo.findSignupTenantById).toHaveBeenCalledWith('site-1', 'tenant-reseller');
    expect(repo.createUserWithWallet).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-1',
      tenantId: 'tenant-reseller',
    }));
    expect(repo.issueSession).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-reseller',
    }));
  });

  it('rejects an invalid requested signup tenant without creating a user', async () => {
    const repo = repoMock({ findSignupTenantById: vi.fn().mockResolvedValue(null) });
    const useCase = new RegisterUserUseCase(repo, configMock());

    await expect(useCase.execute({ ...validDto, tenantId: 'missing-tenant' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'signup_tenant_invalid',
      httpStatus: 400,
    });
    expect(repo.createUserWithWallet).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from the email', async () => {
    const repo = repoMock();
    const useCase = new RegisterUserUseCase(repo, configMock());

    await useCase.execute({ ...validDto, email: '  new@example.com  ' });

    expect(repo.findUserByEmail).toHaveBeenCalledWith('new@example.com');
  });
});
