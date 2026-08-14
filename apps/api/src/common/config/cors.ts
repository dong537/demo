export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'apikey',
  'x-request-id',
  'x-public-host',
] as const;

export function parseCorsOrigins(value = process.env['CORS_ORIGINS'] ?? ''): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

