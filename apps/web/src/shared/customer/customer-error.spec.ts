import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { formatCustomerError } from './customer-error';

describe('formatCustomerError', () => {
  it('uses a localized reason when the translation exists', () => {
    const error = new ApiError('VALIDATION_ERROR', 'old_password_incorrect');

    expect(
      formatCustomerError(
        error,
        (key) => key === 'customer.profile.reason.old_password_incorrect' ? 'Current password is incorrect.' : key,
        'customer.profile.reason',
      ),
    ).toBe('Current password is incorrect.');
  });

  it('keeps an unknown backend reasonKey visible for diagnosis', () => {
    const error = new ApiError('SERVICE_UNAVAILABLE', 'upstream_timeout');

    expect(formatCustomerError(error, (key) => key, 'customer.notifications.reason')).toBe('upstream_timeout');
  });
});
