import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ProviderCode } from './provider.types';

export type NativeProviderCode = Exclude<ProviderCode, 'UPSTREAM_API'>;
export type ProviderAccountStatus = 'ACTIVE' | 'DISABLED';

export const NATIVE_PROVIDER_CODES: NativeProviderCode[] = ['IPIPD', 'NINE_EIGHT_FIVE', 'PR'];

const SECRET_FIELD_NAMES = new Set([
  'credential',
  'credentialEncrypted',
  'apikey',
  'apiKey',
  'appId',
  'appSecret',
  'authorization',
  'token',
  'username',
  'password',
  'secret',
]);

export function isNativeProviderCode(value: string): value is NativeProviderCode {
  return NATIVE_PROVIDER_CODES.includes(value as NativeProviderCode);
}

export function assertCliUsage(condition: unknown, message: string): asserts condition {
  if (!condition) throwCliUsageError(message);
}

export function throwCliUsageError(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'cli_invalid_argument', 400, message);
}

export function parseCredentialJson(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throwCliUsageError('Credential is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throwCliUsageError('Credential JSON must be an object, e.g. {"apikey":"..."}.');
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throwCliUsageError(`Credential field "${key}" must be a non-empty string.`);
    }
    output[key] = value.trim();
  }
  return output;
}

export function assertProviderCredential(
  providerCode: NativeProviderCode,
  credential: Record<string, string>,
): Record<string, string> {
  if (providerCode === 'IPIPD') {
    requireCredentialFields(credential, ['appId', 'appSecret']);
    return pickCredential(credential, ['appId', 'appSecret']);
  }

  if (providerCode === 'NINE_EIGHT_FIVE') {
    requireCredentialFields(credential, ['apikey']);
    return pickCredential(
      credential,
      ['apikey', 'zoneId'].filter((field) => typeof credential[field] === 'string' && credential[field].trim() !== ''),
    );
  }

  if (hasCredentialFields(credential, ['apikey'])) {
    return pickCredential(credential, ['apikey']);
  }
  if (hasCredentialFields(credential, ['username', 'password'])) {
    return pickCredential(credential, ['username', 'password']);
  }
  throwCliUsageError(`${providerCode} credential must include either {"apikey":"..."} or {"username":"...","password":"..."}.`);
}

export function formatCliError(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.code}: ${error.reasonKey}`;
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

export function isCliUsageError(error: unknown): boolean {
  return error instanceof AppError &&
    error.code === ErrorCode.VALIDATION_ERROR &&
    error.reasonKey === 'cli_invalid_argument';
}

export function redactSecrets(value: string): string {
  let result = value;
  for (const key of SECRET_FIELD_NAMES) {
    result = result.replace(new RegExp(`("${key}"\\s*:\\s*")[^"]+(")`, 'gi'), `$1[REDACTED]$2`);
    result = result.replace(new RegExp(`(${key}=)[^\\s&]+`, 'gi'), '$1[REDACTED]');
  }
  return result;
}

function requireCredentialFields(credential: Record<string, string>, fields: string[]): void {
  if (!hasCredentialFields(credential, fields)) {
    throwCliUsageError(`Credential must include fields: ${fields.join(', ')}.`);
  }
}

function hasCredentialFields(credential: Record<string, string>, fields: string[]): boolean {
  return fields.every((field) => typeof credential[field] === 'string' && credential[field].trim() !== '');
}

function pickCredential(credential: Record<string, string>, fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, credential[field]]));
}
