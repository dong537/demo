import { describe, expect, it } from 'vitest';
import { buildBrandUpdateBody, normalizeSiteConfig } from './site-config.feature';

describe('site config normalization', () => {
  it('normalizes the real current-site response into the admin site form shape', () => {
    const config = normalizeSiteConfig({
      site: {
        name: '主站',
        brandConfig: {
          name: '主站品牌',
          logoUrl: '/logo.svg',
          primaryColor: '#003afe',
          supportEmail: 'support@example.com',
        },
        maintenanceMode: true,
        maintenanceMessage: '维护中',
      },
      announcements: [
        {
          id: 'ann-1',
          content: '公告',
          status: 'ACTIVE',
          createdAt: '2026-06-17T00:00:00.000Z',
        },
      ],
    });

    expect(config.brand.brandName).toBe('主站品牌');
    expect(config.brand.logoUrl).toBe('/logo.svg');
    expect(config.brand.primaryColor).toBe('#003afe');
    expect(config.brand.supportEmail).toBe('support@example.com');
    expect(config.maintenance).toEqual({ enabled: true, message: '维护中' });
    expect(config.announcements).toHaveLength(1);
  });

  it('lets tenant brand override the main-site brand for reseller context', () => {
    const config = normalizeSiteConfig({
      site: { name: '主站', brandConfig: { name: '主站品牌' } },
      tenant: { name: '分站', brandConfig: { siteName: '分站品牌' } },
    });

    expect(config.brand.brandName).toBe('分站品牌');
  });

  it('writes compatible brand keys back to the backend brand config', () => {
    expect(buildBrandUpdateBody({
      brandName: '新品牌',
      logoUrl: '/new.svg',
      primaryColor: '#0055ff',
      supportEmail: 'help@example.com',
    })).toEqual({
      brandName: '新品牌',
      name: '新品牌',
      siteName: '新品牌',
      logoUrl: '/new.svg',
      primaryColor: '#0055ff',
      supportEmail: 'help@example.com',
    });
  });
});
