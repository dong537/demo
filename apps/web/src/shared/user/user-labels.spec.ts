import { describe, expect, it } from 'vitest';
import { accountStatusColor, formatAccountStatusZh } from './user-labels';

describe('user labels', () => {
  it('formats account, KYC and risk statuses as Chinese labels', () => {
    expect(formatAccountStatusZh('ACTIVE')).toBe('正常');
    expect(formatAccountStatusZh('NORMAL')).toBe('正常');
    expect(formatAccountStatusZh('PENDING')).toBe('待处理');
    expect(formatAccountStatusZh('APPROVED')).toBe('已认证');
    expect(formatAccountStatusZh('VERIFIED')).toBe('已认证');
    expect(formatAccountStatusZh('REVIEWING')).toBe('审核中');
    expect(formatAccountStatusZh('SUSPENDED')).toBe('已暂停');
    expect(formatAccountStatusZh('DISABLED')).toBe('已停用');
    expect(formatAccountStatusZh('BANNED')).toBe('已封禁');
    expect(formatAccountStatusZh('REJECTED')).toBe('已拒绝');
    expect(formatAccountStatusZh('BLOCKED')).toBe('已拦截');
    expect(formatAccountStatusZh('UNKNOWN')).toBe('UNKNOWN');
    expect(formatAccountStatusZh('')).toBe('-');
    expect(formatAccountStatusZh(null)).toBe('-');
  });

  it('maps account, KYC and risk statuses to Ant Design tag colors', () => {
    expect(accountStatusColor('ACTIVE')).toBe('success');
    expect(accountStatusColor('NORMAL')).toBe('success');
    expect(accountStatusColor('APPROVED')).toBe('success');
    expect(accountStatusColor('VERIFIED')).toBe('success');
    expect(accountStatusColor('PENDING')).toBe('processing');
    expect(accountStatusColor('REVIEWING')).toBe('processing');
    expect(accountStatusColor('BANNED')).toBe('error');
    expect(accountStatusColor('SUSPENDED')).toBe('error');
    expect(accountStatusColor('REJECTED')).toBe('error');
    expect(accountStatusColor('BLOCKED')).toBe('error');
    expect(accountStatusColor('DISABLED')).toBe('default');
    expect(accountStatusColor('UNKNOWN')).toBe('default');
  });
});
