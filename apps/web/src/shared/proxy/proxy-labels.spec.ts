import { describe, expect, it } from 'vitest';
import { formatProxyStatusZh, proxyStatusColor, proxyStatusTone } from './proxy-labels';

describe('proxy labels', () => {
  it('formats proxy lifecycle statuses as Chinese labels', () => {
    expect(formatProxyStatusZh('ACTIVE')).toBe('正常');
    expect(formatProxyStatusZh('PROVISIONING')).toBe('交付中');
    expect(formatProxyStatusZh('PENDING')).toBe('交付中');
    expect(formatProxyStatusZh('EXPIRED')).toBe('已过期');
    expect(formatProxyStatusZh('FAILED')).toBe('失败');
    expect(formatProxyStatusZh('SUSPENDED')).toBe('已暂停');
    expect(formatProxyStatusZh('RELEASED')).toBe('已释放');
    expect(formatProxyStatusZh('CUSTOM')).toBe('CUSTOM');
    expect(formatProxyStatusZh('')).toBe('-');
    expect(formatProxyStatusZh(null)).toBe('-');
  });

  it('maps proxy statuses to Ant Design tag colors', () => {
    expect(proxyStatusColor('ACTIVE')).toBe('success');
    expect(proxyStatusColor('EXPIRED')).toBe('error');
    expect(proxyStatusColor('FAILED')).toBe('error');
    expect(proxyStatusColor('PENDING')).toBe('processing');
    expect(proxyStatusColor('PROVISIONING')).toBe('processing');
    expect(proxyStatusColor('SUSPENDED')).toBe('default');
    expect(proxyStatusColor('RELEASED')).toBe('default');
  });

  it('maps proxy statuses to customer list tone classes', () => {
    expect(proxyStatusTone('ACTIVE')).toBe('success');
    expect(proxyStatusTone('EXPIRED')).toBe('expired');
    expect(proxyStatusTone('FAILED')).toBe('expired');
    expect(proxyStatusTone('PENDING')).toBe('warning');
    expect(proxyStatusTone('PROVISIONING')).toBe('warning');
    expect(proxyStatusTone('SUSPENDED')).toBe('default');
  });
});
