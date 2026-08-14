export function formatProxyStatusZh(status?: string | null): string {
  if (status === 'ACTIVE') return '正常';
  if (status === 'PROVISIONING' || status === 'PENDING') return '交付中';
  if (status === 'EXPIRED') return '已过期';
  if (status === 'FAILED') return '失败';
  if (status === 'SUSPENDED') return '已暂停';
  if (status === 'RELEASED') return '已释放';
  return status || '-';
}

export function proxyStatusColor(status?: string | null): string {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED' || status === 'FAILED') return 'error';
  if (status === 'PENDING' || status === 'PROVISIONING') return 'processing';
  if (status === 'RELEASED') return 'default';
  return 'default';
}

export function proxyStatusTone(status?: string | null): string {
  if (status === 'ACTIVE') return 'success';
  if (status === 'EXPIRED' || status === 'FAILED') return 'expired';
  if (status === 'PENDING' || status === 'PROVISIONING') return 'warning';
  return 'default';
}
