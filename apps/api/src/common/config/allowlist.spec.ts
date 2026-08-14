import { describe, expect, it } from 'vitest';
import { allows, allowsAny, parseAllowlist } from './allowlist';

describe('allowlist helpers', () => {
  it('treats an empty allowlist as closed', () => {
    expect(allows('IPIPD', '')).toBe(false);
  });

  it('requires an exact value when allowlist has entries', () => {
    expect(allows('IPIPD', 'IPIPD,NINE_EIGHT_FIVE')).toBe(true);
    expect(allows('PR', 'IPIPD,NINE_EIGHT_FIVE')).toBe(false);
    expect(allows(undefined, 'account-1')).toBe(false);
  });

  it('trims entries and skips empty values', () => {
    expect(parseAllowlist(' IPIPD, ,PR ')).toEqual(new Set(['IPIPD', 'PR']));
  });

  it('allows when any configured allowlist contains its candidate', () => {
    expect(
      allowsAny([
        { value: 'IPIPD', allowlist: '' },
        { value: 'account-1', allowlist: 'account-1' },
      ]),
    ).toBe(true);
    expect(
      allowsAny([
        { value: 'IPIPD', allowlist: '' },
        { value: undefined, allowlist: 'account-1' },
      ]),
    ).toBe(false);
  });
});
