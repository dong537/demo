import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type Session = Prisma.sessionsGetPayload<Record<string, never>>;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthRepository {
  async findSessionByTokenHash(hash: string): Promise<Session> {
    const session = await prisma.sessions.findUnique({ where: { token: hash } });
    if (!session) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'session_not_found', 401);
    }
    return session;
  }

  async createSession(data: {
    ownerType: 'USER' | 'ADMIN_USER';
    ownerId: string;
    siteId: string;
    tenantId: string | null;
    token: string;
    expiresAt: Date;
  }): Promise<Session> {
    return prisma.sessions.create({ data });
  }

  /**
   * Mints an opaque session token, persists only its sha256 hash, and returns the
   * plain token plus expiry. Single source of truth for session creation so login
   * and self-registration cannot drift on token format, hashing, or TTL.
   */
  async issueSession(owner: {
    ownerType: 'USER' | 'ADMIN_USER';
    ownerId: string;
    siteId: string;
    tenantId: string | null;
  }): Promise<{ token: string; expiresAt: Date }> {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await this.createSession({ ...owner, token: tokenHash, expiresAt });
    return { token: plainToken, expiresAt: session.expiresAt };
  }

  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    return prisma.users.findUnique({ where: { email }, select: { id: true } });
  }

  /**
   * Resolves the tenant that open self-registration should land in: the earliest
   * created ACTIVE tenant of the site. Returns null when the site has no usable
   * tenant so the caller can fail loudly instead of guessing.
   */
  async findSignupTenant(siteId: string): Promise<{ id: string } | null> {
    return prisma.tenants.findFirst({
      where: { siteId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  async findSignupTenantById(siteId: string, tenantId: string): Promise<{ id: string } | null> {
    return prisma.tenants.findFirst({
      where: { id: tenantId, siteId, status: 'ACTIVE' },
      select: { id: true },
    });
  }

  /**
   * Atomically creates an ACTIVE user, a zero-balance wallet, and the
   * `auth.register` audit row. All three share one transaction so a partial
   * signup (user without wallet) can never be observed.
   */
  async createUserWithWallet(data: {
    siteId: string;
    tenantId: string;
    email: string;
    passwordHash: string;
    currency: string;
    requestId: string;
  }): Promise<{ id: string }> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          siteId: data.siteId,
          tenantId: data.tenantId,
          email: data.email,
          passwordHash: data.passwordHash,
          status: 'ACTIVE',
          kycStatus: 'NONE',
          riskStatus: 'NORMAL',
        },
        select: { id: true },
      });

      await tx.wallets.create({
        data: {
          siteId: data.siteId,
          tenantId: data.tenantId,
          userId: user.id,
          available: '0',
          frozen: '0',
          currency: data.currency,
        },
      });

      await tx.audit_logs.create({
        data: {
          siteId: data.siteId,
          tenantId: data.tenantId,
          actorType: 'USER',
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          action: 'auth.register',
          requestId: data.requestId,
        },
      });

      return user;
    });
  }

  async revokeSession(id: string): Promise<void> {
    await prisma.sessions.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async findUserPasswordHash(userId: string, siteId: string): Promise<string> {
    const user = await prisma.users.findFirst({
      where: { id: userId, siteId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    }
    return user.passwordHash;
  }

  async updateUserPassword(userId: string, siteId: string, passwordHash: string): Promise<void> {
    const result = await prisma.users.updateMany({
      where: { id: userId, siteId },
      data: { passwordHash },
    });
    if (result.count === 0) {
      throw new AppError(ErrorCode.NOT_FOUND, 'user_not_found', 404);
    }
  }

  /**
   * Revokes every other active session for a USER, keeping the current session
   * (so the device that just changed the password stays signed in). Sessions on
   * other devices must re-authenticate with the new password.
   */
  async revokeOtherUserSessions(userId: string, currentSessionId: string): Promise<number> {
    const result = await prisma.sessions.updateMany({
      where: {
        ownerType: 'USER',
        ownerId: userId,
        revokedAt: null,
        id: { not: currentSessionId },
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
