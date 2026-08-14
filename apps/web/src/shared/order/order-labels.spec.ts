import { describe, expect, it } from 'vitest';
import { orderStatusColor } from './order-labels';

describe('order labels', () => {
  it('maps order statuses to Ant Design tag colors', () => {
    expect(orderStatusColor('COMPLETED')).toBe('success');
    expect(orderStatusColor('FAILED')).toBe('error');
    expect(orderStatusColor('REFUNDED')).toBe('error');
    expect(orderStatusColor('PARTIALLY_COMPLETED')).toBe('warning');
    expect(orderStatusColor('FULFILLING')).toBe('processing');
    expect(orderStatusColor('PENDING')).toBe('processing');
    expect(orderStatusColor('UNKNOWN')).toBe('default');
    expect(orderStatusColor(null)).toBe('default');
  });
});
