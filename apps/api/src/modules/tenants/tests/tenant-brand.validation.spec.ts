import { describe, expect, it } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { assertBrandConfig } from '../tenant-brand.validation';

describe('tenant brand validation', () => {
  it('normalizes valid brand config', () => {
    expect(assertBrandConfig({
      siteName: '  Reseller One  ',
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#12abEF',
      customDomain: 'Brand.Example.COM',
      supportEmail: 'support@example.com',
    })).toEqual({
      siteName: 'Reseller One',
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#12ABEF',
      customDomain: 'brand.example.com',
      supportEmail: 'support@example.com',
    });
  });

  it('requires a non-empty siteName', () => {
    expectReason(() => assertBrandConfig({ siteName: ' ' }), 'brand_site_name_required');
  });

  it('rejects unsafe urls, invalid colors, invalid domains, and invalid emails', () => {
    expectReason(
      () => assertBrandConfig({ siteName: 'Brand', logoUrl: 'http://cdn.example.com/logo.png' }),
      'brand_logo_url_invalid',
    );
    expectReason(
      () => assertBrandConfig({ siteName: 'Brand', primaryColor: 'blue' }),
      'brand_primary_color_invalid',
    );
    expectReason(
      () => assertBrandConfig({ siteName: 'Brand', customDomain: 'https://brand.example.com' }),
      'brand_custom_domain_invalid',
    );
    expectReason(
      () => assertBrandConfig({ siteName: 'Brand', supportEmail: 'support.example.com' }),
      'brand_support_email_invalid',
    );
  });

  it('treats null and blank optional fields as cleared', () => {
    expect(assertBrandConfig({
      siteName: 'Brand',
      logoUrl: null,
      primaryColor: '',
      customDomain: '   ',
      supportEmail: null,
    })).toEqual({ siteName: 'Brand' });
  });
});

function expectReason(fn: () => unknown, reasonKey: string): void {
  try {
    fn();
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).reasonKey).toBe(reasonKey);
  }
}
