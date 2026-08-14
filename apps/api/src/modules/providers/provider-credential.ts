import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { ProviderCode } from './provider.types';

export function normalizeProviderCredential(
  providerCode: ProviderCode,
  value: unknown,
  options: { partial: boolean },
): Record<string, string> {
  const credential = normalizeCredentialKeyAliases(providerCode, trimCredentialObject(value, options));
  const fields = credentialFieldsForProvider(providerCode);
  const recognized = [...fields.required, ...fields.optional].filter((field) => credential[field] !== undefined);
  if (options.partial) {
    if (recognized.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
    }
    return pickCredential(credential, recognized);
  }

  for (const field of fields.required) {
    if (!credential[field]) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
    }
  }
  return pickCredential(credential, [...fields.required, ...fields.optional].filter((field) => credential[field] !== undefined));
}

function normalizeCredentialKeyAliases(providerCode: ProviderCode, credential: Record<string, string>): Record<string, string> {
  if ((providerCode === 'NINE_EIGHT_FIVE' || providerCode === 'PR') && !credential['apikey'] && credential['apiKey']) {
    return { ...credential, apikey: credential['apiKey'] };
  }
  return credential;
}

export function trimCredentialObject(value: unknown, options: { partial: boolean }): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
  }
  const entries = Object.entries(value);
  if (!options.partial && entries.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
  }
  const credential: Record<string, string> = {};
  for (const [key, item] of entries) {
    const normalizedKey = key.trim();
    if (!normalizedKey || typeof item !== 'string') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
    }
    const normalizedValue = item.trim();
    if (!normalizedValue) continue;
    credential[normalizedKey] = normalizedValue;
  }
  if (Object.keys(credential).length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_credential_invalid', 400);
  }
  return credential;
}

function credentialFieldsForProvider(providerCode: ProviderCode): { required: string[]; optional: string[] } {
  if (providerCode === 'IPIPD') return { required: ['appId', 'appSecret'], optional: [] };
  if (providerCode === 'NINE_EIGHT_FIVE') return { required: ['apikey'], optional: ['zoneId'] };
  if (providerCode === 'PR') return { required: ['apikey'], optional: [] };
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'provider_code_invalid', 400);
}

function pickCredential(credential: Record<string, string>, fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, credential[field]]));
}
