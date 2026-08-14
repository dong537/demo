import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Admin ticket scope. `tenantId === null` means "all tenants within the site"
 * (PLATFORM_ADMIN); a concrete tenantId narrows the scope to that tenant
 * (TENANT_ADMIN). USER callers never reach this surface.
 */
export interface AdminTicketScope {
  siteId: string;
  tenantId: string | null;
}

/**
 * Resolves the admin scope for ticket operations. PLATFORM_ADMIN sees the whole
 * site; TENANT_ADMIN is locked to its own tenant. Any other caller (USER,
 * SYSTEM) is rejected so the customer-facing surface stays separate.
 */
export function requireTicketAdminScope(ctx: AuthenticatedContext): AdminTicketScope {
  if (ctx.ownerType === 'PLATFORM_ADMIN') {
    return { siteId: ctx.siteId, tenantId: null };
  }
  if (ctx.ownerType === 'TENANT_ADMIN') {
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'tenant_context_required', 403);
    }
    return { siteId: ctx.siteId, tenantId: ctx.tenantId };
  }
  throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
}

const TICKET_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export function requireTicketStatus(value: unknown): TicketStatus {
  if (typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)) {
    return value as TicketStatus;
  }
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_ticket_status', 400);
}
