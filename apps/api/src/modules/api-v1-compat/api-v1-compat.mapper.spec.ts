import { describe, expect, it } from 'vitest';
import { toCapabilitiesResponse, toLegacyLineDto, toLegacySkuDto } from './api-v1-compat.mapper';

describe('api v1 compatibility mappers', () => {
  it('exposes dedicated-only capability flags', () => {
    expect(toCapabilitiesResponse()).toEqual({
      smtpConfigured: false,
      otpLoginEnabled: false,
      residentialUiEnabled: false,
      residentialPurchaseEnabled: false,
      dedicatedUiEnabled: true,
      dedicatedPurchaseEnabled: true,
      selfServiceRechargeEnabled: false,
    });
  });

  it('keeps the legacy SKU fields and protocol list readable by the frozen frontend', () => {
    expect(toLegacySkuDto({
      id: 'sku-1',
      code: 'SV',
      name: 'Short video',
      description: 'Dedicated short-video line',
      capabilities: { delivery: 'dedicated-line', supportedProtocols: ['VLESS', 'VMESS'] },
      contractVersion: 2,
      isActive: true,
      isVisible: true,
    })).toEqual({
      id: 'sku-1',
      code: 'SV',
      name: 'Short video',
      description: 'Dedicated short-video line',
      protocols: ['vless', 'vmess'],
      capabilities: { delivery: 'dedicated-line', supportedProtocols: ['VLESS', 'VMESS'] },
      contractVersion: 2,
      isActive: true,
      isVisible: true,
    });
  });

  it('maps a ready line to the numeric legacy id and a front-door URI', () => {
    const mapped = toLegacyLineDto({
      id: 'line-uuid',
      legacyId: 42,
      status: 'ACTIVE',
      countryCode: 'HK',
      protocol: 'VLESS',
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      clientEmail: 'line@example.com',
      client: { email: 'line@example.com', id: 'client-uuid' },
      domains: [{ hostname: 'sv-1.example.com', port: 60701, isPrimary: true }],
      sku: { code: 'SV', name: 'Short video' },
      legacyRemark: 'customer note',
    });

    expect(mapped).toMatchObject({
      id: 42,
      proxyId: 42,
      country: 'HK',
      protocol: 'vless',
      status: 'active',
      remark: 'customer note',
      connectionUri: 'vless://client-uuid@sv-1.example.com:60701?type=tcp#SV',
    });
  });
});
