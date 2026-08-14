import { AuthenticatedContext } from '../../common/auth/auth-context';
import { assertTenantAccess } from '../../common/auth/tenant-guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { WalletRepository, Wallet } from './wallet.repository';

export async function getWalletForContext(
  repo: WalletRepository,
  ctx: AuthenticatedContext,
  userId: string,
): Promise<Wallet> {
  if (ctx.ownerType === 'USER') {
    if (ctx.ownerId !== userId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'cannot_read_other_wallet', 403);
    }
    return repo.getWalletByUserId(userId, ctx.siteId, requireTenantId(ctx));
  }

  if (ctx.ownerType === 'TENANT_ADMIN') {
    const wallet = await repo.getWalletByUserId(userId, ctx.siteId);
    assertTenantAccess(ctx, wallet.tenantId);
    return wallet;
  }

  if (ctx.ownerType === 'PLATFORM_ADMIN') {
    return repo.getWalletByUserId(userId, ctx.siteId);
  }

  throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
}

export function requireTenantId(ctx: AuthenticatedContext): string {
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
  }
  return ctx.tenantId;
}
