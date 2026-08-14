import { describe, expect, it } from 'vitest';
import { normalizeProviderCredential } from './provider-credential';

describe('provider credential normalization', () => {
  it('accepts the frontend apiKey spelling and stores the canonical apikey field', () => {
    expect(normalizeProviderCredential('PR', { apiKey: ' key ' }, { partial: false })).toEqual({ apikey: 'key' });
    expect(normalizeProviderCredential('NINE_EIGHT_FIVE', { apiKey: ' key ', zoneId: ' zone ' }, { partial: false })).toEqual({
      apikey: 'key',
      zoneId: 'zone',
    });
  });
});
