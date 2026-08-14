import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AdminLoginFeature } from '../admin-login.feature';
import * as client from '../../../shared/api/client';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('AdminLoginFeature', () => {
  it('账号为空时 apiRequest 不被调用', async () => {
    const spy = vi.spyOn(client, 'apiRequest');
    render(<AdminLoginFeature />);
    // Submit with empty fields — Zod blocks
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(spy).not.toHaveBeenCalled());
  });

  it('password 为空时 apiRequest 不被调用', async () => {
    const spy = vi.spyOn(client, 'apiRequest');
    render(<AdminLoginFeature />);
    const user = userEvent.setup();

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    await user.type(emailInput, 'admin');
    await user.click(screen.getByRole('button'));

    await waitFor(() => expect(spy).not.toHaveBeenCalled());
    expect(screen.getByText('login.passwordRequired')).toBeTruthy();
  });

  it('API 401 显示错误文案', async () => {
    vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ site: { id: 'site-id' } })
      .mockRejectedValueOnce(new client.ApiError(401, 'invalid_credentials'));
    render(<AdminLoginFeature />);

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'admin@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(screen.getByText('login.invalidCredentials')).toBeTruthy(),
    );
  });

  it('API 网络错误显示通用错误文案', async () => {
    vi.spyOn(client, 'apiRequest').mockRejectedValueOnce(new client.ApiError(0, 'network_error'));
    render(<AdminLoginFeature />);

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'admin@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'pw-12345' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByText('login.networkError')).toBeTruthy());
  });

  it('非邮箱用户名（如 admin）也能提交登录', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'session-token' });
    render(<AdminLoginFeature />);

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'admin' } });
    fireEvent.change(passwordInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('admin_token')).toBe('session-token'));
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin', password: '123456', siteId: 'real-site-id' }),
    });
  });

  it('登录前读取真实 siteId 并提交登录', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ site: { id: 'real-site-id' } })
      .mockResolvedValueOnce({ token: 'session-token' });
    render(<AdminLoginFeature />);

    const emailInput = document.querySelector('input:not([type="password"])') as HTMLInputElement;
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: 'admin@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'pw-12345' } });
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(sessionStorage.getItem('admin_token')).toBe('session-token'));
    expect(spy).toHaveBeenNthCalledWith(1, '/api/sites/current');
    expect(spy).toHaveBeenNthCalledWith(2, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', password: 'pw-12345', siteId: 'real-site-id' }),
    });
  });
});
