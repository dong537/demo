import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { CustomerLoginFeature } from '../customer-login.feature';
import * as client from '../../../shared/api/client';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockReset();
  sessionStorage.clear();
});

describe('CustomerLoginFeature', () => {
  it('reads real siteId before customer login', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'user-session-token' });
    vi.spyOn(client, 'apiRequest').mockResolvedValueOnce({
      ownerId: 'user-1',
      ownerType: 'USER',
      siteId: 'real-site-id',
      tenantId: 'tenant-1',
      scopes: [],
    });
    render(<CustomerLoginFeature />);
    const user = userEvent.setup();

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(emailInput, 'user@example.com');
    await user.type(passwordInput, 'pw-12345');
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('user_token')).toBe('user-session-token'));
    expect(sessionStorage.getItem('admin_token')).toBeNull();
    expect(navigateMock).toHaveBeenCalledWith({ to: '/overview' });
    expect(spy).toHaveBeenNthCalledWith(1, '/api/sites/current', { headers: { 'x-public-host': 'localhost:3000' } });
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'pw-12345', siteId: 'real-site-id' }),
    });
  });

  it('submits a non-email account identifier without native email validation blocking it', async () => {
    const spy = vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'user-session-token' });
    vi.spyOn(client, 'apiRequest').mockResolvedValueOnce({
      ownerId: 'user-1',
      ownerType: 'USER',
      siteId: 'real-site-id',
      tenantId: 'tenant-1',
      scopes: [],
    });
    render(<CustomerLoginFeature />);
    const user = userEvent.setup();

    const accountInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(accountInput, 'admin');
    await user.type(passwordInput, '123456');
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('user_token')).toBe('user-session-token'));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/overview' });
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin', password: '123456', siteId: 'real-site-id' }),
    });
  });

  it('routes an admin account from the customer login form into the admin area', async () => {
    vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'admin-session-token' });
    const identitySpy = vi.spyOn(client, 'apiRequest').mockResolvedValueOnce({
      ownerId: 'admin-1',
      ownerType: 'PLATFORM_ADMIN',
      siteId: 'real-site-id',
      tenantId: null,
      scopes: [],
    });
    render(<CustomerLoginFeature />);
    const user = userEvent.setup();

    const accountInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(accountInput, 'admin');
    await user.type(passwordInput, '123456');
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('admin_token')).toBe('admin-session-token'));
    expect(sessionStorage.getItem('user_token')).toBeNull();
    expect(identitySpy).toHaveBeenCalledWith('/api/auth/me', {
      headers: { Authorization: 'Bearer admin-session-token' },
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/admin' });
  });

  it('shows localized invalid credentials copy from login response', async () => {
    vi.spyOn(client, 'userApiRequest')
      .mockResolvedValueOnce({ site: { id: 'site-id' } })
      .mockRejectedValueOnce(new client.ApiError(401, 'invalid_credentials'));
    render(<CustomerLoginFeature />);
    const user = userEvent.setup();

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(emailInput, 'user@example.com');
    await user.type(passwordInput, 'wrongpass');
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('customer.login.invalidCredentials')).toBeTruthy());
  });
});
