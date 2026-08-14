export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}
