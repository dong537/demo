import { describe, expect, it } from 'vitest';
import { formatProviderLabel, PROVIDER_OPTIONS } from './provider-labels';

describe('provider labels', () => {
  it('maps upstream provider codes to Chinese platform labels', () => {
    expect(formatProviderLabel('IPIPD')).toBe('ipmigo 平台');
    expect(formatProviderLabel('NINE_EIGHT_FIVE')).toBe('985 平台');
    expect(formatProviderLabel('PR')).toBe('PR 平台');
    expect(PROVIDER_OPTIONS).toContainEqual({ value: 'NINE_EIGHT_FIVE', label: '985 平台' });
  });
});
