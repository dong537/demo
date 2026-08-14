import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface NotificationOwnerScope {
  userId: string;
  siteId: string;
  tenantId: string;
}

/**
 * Notifications are a customer-facing surface. Only USER callers read and manage
 * their own notifications; the tenant context must be present so queries stay
 * tenant-scoped. Admin/system callers never reach this surface.
 */
export function requireNotificationOwner(ctx: AuthenticatedContext): NotificationOwnerScope {
  if (ctx.ownerType !== 'USER') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
  }
  return { userId: ctx.ownerId, siteId: ctx.siteId, tenantId: ctx.tenantId };
}
