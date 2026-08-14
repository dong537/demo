export type MoneyInput = number | string | null | undefined;

export function parseMoneyAmount(value: MoneyInput): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoneyAmount(value: MoneyInput, currency = 'CNY'): string | null {
  const parsed = parseMoneyAmount(value);
  if (parsed !== null) return `${parsed.toFixed(2)} ${currency}`;

  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return `${raw} ${currency}`;
}
