import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProviderAdapter } from './provider.types';
import { ProviderCapabilitiesDto } from './dto';

/**
 * Provider accounts are platform-level resources, so the provider-health panel
 * is PLATFORM_ADMIN-only. Any other caller (TENANT_ADMIN, USER, SYSTEM) is
 * rejected before any account is read.
 */
export function requireProviderAdmin(ctx: AuthenticatedContext): void {
  if (ctx.ownerType !== 'PLATFORM_ADMIN') {
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }
}

/**
 * Derives the capability summary from the account toggle (`inventorySync`) and
 * which optional lifecycle methods the matching adapter implements. Reflects
 * real behaviour rather than a hardcoded matrix.
 */
export function deriveCapabilities(
  adapter: ProviderAdapter,
  inventorySyncEnabled: boolean,
): ProviderCapabilitiesDto {
  return {
    inventorySync: inventorySyncEnabled,
    renew: typeof adapter.renewStaticProxy === 'function',
    changePassword: typeof adapter.changeProxyPassword === 'function',
    switchIp: typeof adapter.switchProxyIp === 'function',
  };
}
