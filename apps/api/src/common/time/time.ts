export function nowUtc(): Date {
  return new Date();
}

export function toIso(d: Date): string {
  return d.toISOString();
}

export function isExpired(d: Date): boolean {
  return d < new Date();
}
