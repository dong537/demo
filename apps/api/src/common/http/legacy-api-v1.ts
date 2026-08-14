export function isLegacyApiV1Path(value: string | undefined): boolean {
  if (!value) return false;
  const path = value.split('?', 1)[0] ?? '';
  return path === '/api/v1' || path.startsWith('/api/v1/');
}

export function isLegacyApiV1Request(request: { url?: string; originalUrl?: string }): boolean {
  return isLegacyApiV1Path(request.url) || isLegacyApiV1Path(request.originalUrl);
}

export function legacyApiV1RequestPath(request: { url?: string; originalUrl?: string }): string {
  const value = request.originalUrl ?? request.url ?? '/api/v1';
  return value.split('?', 1)[0] ?? '/api/v1';
}
