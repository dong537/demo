import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CustomerRegisterFeature } from '../customer-register.feature';
import * as client from '../../../shared/api/client';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function fillField(type: string, value: string, index = 0) {
  const input = document.querySelectorAll(`input[type="${type}"]`)[index] as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

describe('CustomerRegisterFeature', () => {
  it('blocks submit on invalid email', async () => {
    const spy = vi.spyOn(client, 'userApiRequest');
    render(<CustomerRegisterFeature />);

    fillField('email', 'not-an-email');
    fillField('password', 'longenough1', 0);
    fillField('password', 'longenough1', 1);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(spy).not.toHaveBeenCalled());
  });

  it('blocks submit when password is shorter than 8', async () => {
    const spy = vi.spyOn(client, 'userApiRequest');
    render(<CustomerRegisterFeature />);

    fillField('email', 'user@example.com');
    fillField('password', 'short', 0);
    fillField('password', 'short', 1);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(spy).not.toHaveBeenCalled());
    expect(screen.getByText('customer.register.passwordTooShort')).toBeTruthy();
  });

  it('blocks submit when passwords do not match', async () => {
    const spy = vi.spyOn(client, 'userApiRequest');
    render(<CustomerRegisterFeature />);

    fillField('email', 'user@example.com');
    fillField('password', 'longenough1', 0);
    fillField('password', 'different22', 1);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(spy).not.toHaveBeenCalled());
    expect(screen.getByText('customer.register.passwordMismatch')).toBeTruthy();
  });

  it('reads real siteId then registers and stores token', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'new-user-token' });
    render(<CustomerRegisterFeature />);
    const user = userEvent.setup();

    fillField('email', 'newuser@example.com');
    fillField('password', 'longenough1', 0);
    fillField('password', 'longenough1', 1);
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('user_token')).toBe('new-user-token'));
    expect(spy).toHaveBeenNthCalledWith(1, '/api/sites/current', { headers: { 'x-public-host': 'localhost:3000' } });
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'newuser@example.com', password: 'longenough1', siteId: 'real-site-id' }),
    });
  });

  it('passes tenantId when current site is resolved from a reseller domain', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' }, tenant: { id: 'tenant-domain-id' } })
      .mockResolvedValueOnce({ token: 'new-user-token' });
    render(<CustomerRegisterFeature />);
    const user = userEvent.setup();

    fillField('email', 'tenant-user@example.com');
    fillField('password', 'longenough1', 0);
    fillField('password', 'longenough1', 1);
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('user_token')).toBe('new-user-token'));
    expect(spy).toHaveBeenNthCalledWith(1, '/api/sites/current', { headers: { 'x-public-host': 'localhost:3000' } });
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'tenant-user@example.com',
        password: 'longenough1',
        siteId: 'real-site-id',
        tenantId: 'tenant-domain-id',
      }),
    });
  });

  it('shows email_taken reasonKey on conflict', async () => {
    vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'site-id' } })
      .mockRejectedValueOnce(new client.ApiError(409, 'email_taken'));
    render(<CustomerRegisterFeature />);
    const user = userEvent.setup();

    fillField('email', 'taken@example.com');
    fillField('password', 'longenough1', 0);
    fillField('password', 'longenough1', 1);
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('customer.register.emailTaken')).toBeTruthy());
  });
});
