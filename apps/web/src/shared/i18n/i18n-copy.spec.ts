import { describe, expect, it } from 'vitest';
import en from './en';
import zh from './zh';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

describe('i18n visible copy', () => {
  it('does not expose backend API paths in translated UI text', () => {
    const copy = [...collectStrings(zh), ...collectStrings(en)];

    expect(copy.filter((item) => item.includes('/api'))).toEqual([]);
  });
});
