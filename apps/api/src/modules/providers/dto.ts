import { ProviderCode } from './provider.types';

/**
 * Capability summary for a provider account. `inventorySync` reflects the
 * account's own toggle; the lifecycle flags are derived from which optional
 * methods the matching adapter actually implements (never fabricated).
 */
export interface ProviderCapabilitiesDto {
  inventorySync: boolean;
  renew: boolean;
  changePassword: boolean;
  switchIp: boolean;
}

/**
 * Read model for the platform provider-health panel. Intentionally excludes
 * `credentialEncrypted` (and any plaintext credential): the secret never leaves
 * the backend.
 */
export interface ProviderAccountListItemDto {
  id: string;
  providerCode: ProviderCode;
  tenantId: string | null;
  status: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs: number;
  inventorySyncEnabled: boolean;
  enabledCountryCodes: string[];
  availableCountries: Array<{ code: string; name: string }>;
  capabilities: ProviderCapabilitiesDto;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of a live connectivity probe against one provider account. A failed
 * probe (network/timeout/upstream/decrypt) converges into `reachable: false`
 * with a stable `reasonKey`; it never surfaces as a 500. `detail` carries the
 * non-sensitive upstream signal (HTTP status / message) for operators.
 */
export interface ProviderHealthCheckResultDto {
  accountId: string;
  providerCode: ProviderCode;
  reachable: boolean;
  latencyMs: number | null;
  reasonKey: string | null;
  detail: string | null;
  checkedAt: Date;
}

export interface CreateProviderAccountDto {
  providerCode: ProviderCode;
  status?: 'ACTIVE' | 'DISABLED';
  baseUrl: string;
  timeoutMs?: number;
  inventorySyncEnabled?: boolean;
  enabledCountryCodes?: string[];
  credential: Record<string, string>;
}

export interface UpdateProviderAccountDto {
  status?: 'ACTIVE' | 'DISABLED';
  baseUrl?: string;
  timeoutMs?: number;
  inventorySyncEnabled?: boolean;
  enabledCountryCodes?: string[];
  credential?: Record<string, string>;
}
