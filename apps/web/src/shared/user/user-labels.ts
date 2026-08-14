export function formatAccountStatusZh(status?: string | null): string {
  if (status === 'ACTIVE') return '正常';
  if (status === 'NORMAL') return '正常';
  if (status === 'PENDING') return '待处理';
  if (status === 'APPROVED' || status === 'VERIFIED') return '已认证';
  if (status === 'REVIEWING') return '审核中';
  if (status === 'SUSPENDED') return '已暂停';
  if (status === 'DISABLED') return '已停用';
  if (status === 'BANNED') return '已封禁';
  if (status === 'REJECTED') return '已拒绝';
  if (status === 'BLOCKED') return '已拦截';
  return status || '-';
}

export function accountStatusColor(status?: string | null): string {
  if (status === 'ACTIVE' || status === 'NORMAL' || status === 'APPROVED' || status === 'VERIFIED') return 'success';
  if (status === 'PENDING' || status === 'REVIEWING') return 'processing';
  if (status === 'BANNED' || status === 'SUSPENDED' || status === 'REJECTED' || status === 'BLOCKED') return 'error';
  if (status === 'DISABLED') return 'default';
  return 'default';
}
