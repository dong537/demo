import { describe, expect, it } from 'vitest';
import { formatDateTime } from './time';

describe('time helpers', () => {
  it('formats valid date values as local date time strings', () => {
    expect(formatDateTime(new Date('2026-06-10T08:30:00.000Z'))).toContain('2026');
  });

  it('keeps invalid date values visible', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  it('renders missing date values as dash', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime(undefined)).toBe('-');
  });
});
