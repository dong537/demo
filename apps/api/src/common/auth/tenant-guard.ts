import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedContext } from './auth-context';

export function assertTenantAccess(ctx: AuthenticatedContext, targetTenantId: string): void {
  if (ctx.ownerType === 'PLATFORM_ADMIN' || ctx.ownerType === 'SYSTEM') return;
  if (ctx.tenantId !== targetTenantId) {
    throw new AppError(
      ErrorCode.TENANT_SCOPE_VIOLATION,
      'tenant_access_denied',
      403,
      'Access denied: cross-tenant operation',
    );
  }
}
