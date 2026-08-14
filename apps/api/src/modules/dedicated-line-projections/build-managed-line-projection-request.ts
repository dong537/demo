import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ManagedLineProjectionRequest } from './managed-line-projection.adapter';

export type ManagedLineProjectionSource = {
  desiredVersion: number;
  inboundTag: string;
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
  clientEmail: string;
  clientIdentityCiphertext: string;
  lineStatus: string;
  expiresAt: Date | null;
  quotaBytes: bigint | null;
  uplinkLimitBps: bigint | null;
  downlinkLimitBps: bigint | null;
  maxConnections: number | null;
  ipLimit: number | null;
  endpointCiphertext: string;
  credentialCiphertext: string;
};

export function buildManagedLineProjectionRequest(
  source: ManagedLineProjectionSource,
  encryptionKey: string,
): ManagedLineProjectionRequest {
  const identity = decryptObject(source.clientIdentityCiphertext, encryptionKey, 'dedicated_line_client_identity_invalid');
  const endpoint = decryptObject(source.endpointCiphertext, encryptionKey, 'dedicated_line_exit_endpoint_invalid');
  const credential = decryptObject(source.credentialCiphertext, encryptionKey, 'dedicated_line_exit_credential_invalid');
  const client = source.protocol === 'MIXED'
    ? { email: source.clientEmail, user: requiredString(identity, 'user'), password: requiredString(identity, 'password') }
    : { email: source.clientEmail, id: requiredString(identity, 'id'), ...optionalFlow(identity) };
  return {
    desiredVersion: source.desiredVersion,
    inboundTag: source.inboundTag,
    protocol: source.protocol,
    client,
    egress: {
      host: requiredString(endpoint, 'host'),
      port: requiredPort(endpoint, 'port'),
      username: requiredString(credential, 'username'),
      password: requiredString(credential, 'password'),
    },
    lifecycle: {
      enabled: source.lineStatus === 'PROVISIONING' || source.lineStatus === 'ACTIVE' || source.lineStatus === 'DEGRADED' || source.lineStatus === 'MIGRATING_AWAITING_ROUTE_IMPORT',
      expiresAtMs: source.expiresAt?.getTime() ?? 0,
      trafficLimitBytes: safeBigIntNumber(source.quotaBytes, 'dedicated_line_quota_invalid'),
      ipLimit: source.ipLimit ?? 0,
      uplinkLimitBps: safeBigIntNumber(source.uplinkLimitBps, 'dedicated_line_uplink_limit_invalid'),
      downlinkLimitBps: safeBigIntNumber(source.downlinkLimitBps, 'dedicated_line_downlink_limit_invalid'),
      maxConnections: safeNonNegativeInt(source.maxConnections),
    },
  };
}

function decryptObject(ciphertext: string, key: string, reasonKey: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decryptAesGcm(ciphertext, key));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not_object');
    return value as Record<string, unknown>;
  } catch {
    invalid(reasonKey);
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) invalid(`dedicated_line_${key}_invalid`);
  return value.trim();
}

function requiredPort(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) invalid('dedicated_line_exit_port_invalid');
  return value as number;
}

function optionalFlow(record: Record<string, unknown>): { flow?: string } {
  const flow = record['flow'];
  return typeof flow === 'string' && flow.trim() ? { flow: flow.trim() } : {};
}

function safeBigIntNumber(value: bigint | null, reasonKey: string): number {
  if (value === null) return 0;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(reasonKey);
  return Number(value);
}

function safeNonNegativeInt(value: number | null): number {
  if (value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) invalid('dedicated_line_connection_limit_invalid');
  return value;
}

function invalid(reasonKey: string): never {
  throw new AppError(ErrorCode.DEDICATED_LINE_CONFIG_INVALID, reasonKey, 500);
}
