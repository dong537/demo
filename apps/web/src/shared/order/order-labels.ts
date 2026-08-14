export function orderStatusColor(status?: string | null): string {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'REFUNDED') return 'error';
  if (status === 'PARTIALLY_COMPLETED') return 'warning';
  if (status === 'FULFILLING' || status === 'PENDING') return 'processing';
  return 'default';
}
