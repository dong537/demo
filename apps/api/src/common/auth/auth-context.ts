import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export type OwnerType = 'USER' | 'TENANT_ADMIN' | 'PLATFORM_ADMIN' | 'SYSTEM';

export interface AuthenticatedContext {
  ownerId: string;
  ownerType: OwnerType;
  siteId: string;
  tenantId: string | null;
  scopes: string[];
  requestId: string;
}

export function requireAuthenticatedContext(ctx: unknown): AuthenticatedContext {
  if (
    ctx !== null &&
    typeof ctx === 'object' &&
    'ownerId' in ctx &&
    'ownerType' in ctx &&
    'siteId' in ctx &&
    'scopes' in ctx &&
    'requestId' in ctx
  ) {
    return ctx as AuthenticatedContext;
  }
  throw new AppError(ErrorCode.AUTH_REQUIRED, 'AUTH_REQUIRED', 401);
}

export function requireUserContext(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'USER') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'PERMISSION_DENIED', 403);
  }
}

export function requireOperatorContext(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'SYSTEM') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'PERMISSION_DENIED', 403);
  }
}

export function requireTenantAdminContext(ctx: AuthenticatedContext, tenantId: string): void {
  if (ctx.ownerType !== 'TENANT_ADMIN' || ctx.tenantId !== tenantId) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'PERMISSION_DENIED', 403);
  }
}

export function requirePlatformAdminContext(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'PERMISSION_DENIED', 403);
  }
}

export function requireSystemContext(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'SYSTEM') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'PERMISSION_DENIED', 403);
  }
}

export function requireScope(ctx: AuthenticatedContext, requiredScope: string): void {
  const wildcard = requiredScope.includes(':')
    ? `${requiredScope.slice(0, requiredScope.indexOf(':'))}:*`
    : '*';
  if (!ctx.scopes.includes(requiredScope) && !ctx.scopes.includes(wildcard) && !ctx.scopes.includes('*')) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_scope', 403);
  }
}
