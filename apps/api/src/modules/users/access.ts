import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface SelfUserScope {
  userId: string;
  siteId: string;
  tenantId: string;
}

/**
 * The self-service profile surface (/users/me) is customer-facing. Only USER
 * callers read and edit their own profile; the tenant context must be present so
 * queries stay tenant-scoped. Admin/system callers never reach this surface.
 */
export function requireSelfUser(ctx: AuthenticatedContext): SelfUserScope {
  if (ctx.ownerType !== 'USER') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
  }
  return { userId: ctx.ownerId, siteId: ctx.siteId, tenantId: ctx.tenantId };
}
