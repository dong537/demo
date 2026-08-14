import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { normalizeDnsHostname } from '../../common/validation/dns-hostname';
import type { TenantBrandConfig } from './tenants.repository';

export function assertBrandConfig(value: unknown): TenantBrandConfig {
  assertRequestBody(value);

  const siteName = requiredTrimmedString(value.siteName, 'brand_site_name_required', 80);
  const config: TenantBrandConfig = { siteName };

  const logoUrl = optionalTrimmedString(value.logoUrl, 'brand_logo_url_invalid', 2048);
  if (logoUrl !== undefined) config.logoUrl = assertHttpsUrl(logoUrl);

  const primaryColor = optionalTrimmedString(value.primaryColor, 'brand_primary_color_invalid', 7);
  if (primaryColor !== undefined) config.primaryColor = assertPrimaryColor(primaryColor);

  const customDomain = optionalTrimmedString(value.customDomain, 'brand_custom_domain_invalid', 253);
  if (customDomain !== undefined) config.customDomain = assertCustomDomain(customDomain);

  const supportEmail = optionalTrimmedString(value.supportEmail, 'brand_support_email_invalid', 254);
  if (supportEmail !== undefined) config.supportEmail = assertSupportEmail(supportEmail);

  return config;
}

function assertRequestBody(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'invalid_request', 400);
  }
}

function requiredTrimmedString(value: unknown, reasonKey: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return trimmed;
}

function optionalTrimmedString(
  value: unknown,
  reasonKey: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  }
  return trimmed;
}

function assertHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'brand_logo_url_invalid', 400);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'brand_logo_url_invalid', 400);
  }
  return value;
}

function assertPrimaryColor(value: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'brand_primary_color_invalid', 400);
  }
  return value.toUpperCase();
}

function assertCustomDomain(value: string): string {
  return normalizeDnsHostname(value, 'brand_custom_domain_invalid');
}

function assertSupportEmail(value: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'brand_support_email_invalid', 400);
  }
  return value;
}
