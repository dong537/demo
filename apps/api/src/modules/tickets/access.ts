import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface OwnerScope {
  ownerId: string;
  siteId: string;
  tenantId: string;
}

/**
 * Tickets are a customer-facing surface. Only USER callers operate on their own
 * tickets; the tenant context must be present so queries stay tenant-scoped.
 */
export function requireTicketOwner(ctx: AuthenticatedContext): OwnerScope {
  if (ctx.ownerType !== 'USER') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
  }
  return { ownerId: ctx.ownerId, siteId: ctx.siteId, tenantId: ctx.tenantId };
}

export function requireNonEmpty(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return value.trim();
}
