import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildUpdateProfileBody,
  buildChangePasswordBody,
  CustomerProfileFeature,
} from '../profile.feature';
import * as client from '../../../shared/api/client';
import { clearCurrentUserCache } from '../../../shared/auth/current-user';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => {
      if (typeof options === 'string') return options;
      if (key === 'customer.profile.ownerType.USER') return 'USER';
      if (key === 'customer.profile.scopeValue.generic') return 'customer:*';
      return options?.defaultValue ?? key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const PROFILE = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Old Name',
  phone: '13800000000',
  status: 'ACTIVE',
  kycStatus: 'PENDING',
  riskStatus: 'NORMAL',
};

const CURRENT_USER = {
  ownerId: 'user-1',
  ownerType: 'USER',
  siteId: 'site-1',
  tenantId: 'tenant-1',
  scopes: ['customer:*'],
};

const CURRENT_SITE = {
  site: { id: 'site-1', name: 'Main Site', domain: 'example.com', brandConfig: { siteName: 'Main Console' } },
  tenant: { id: 'tenant-1', code: 'reseller-a', name: 'Reseller A', brandConfig: { siteName: 'Reseller Portal' } },
  announcements: [],
};

function mockProfileApis(
  handler?: (path: string, init?: RequestInit) => Promise<unknown> | unknown,
) {
  return vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
    const handled = handler?.(path, init);
    if (handled !== undefined) return Promise.resolve(handled);
    if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
    if (path === '/api/sites/current') return Promise.resolve(CURRENT_SITE);
    return Promise.resolve(PROFILE);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  clearCurrentUserCache('customer');
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('customer profile feature contracts', () => {
  it('builds a trimmed update body and a change-password body', () => {
    expect(buildUpdateProfileBody({ name: ' Alice ', phone: ' 139 ' })).toEqual({
      name: 'Alice',
      phone: '139',
    });
    expect(
      buildChangePasswordBody({ oldPassword: 'old', newPassword: 'new', confirmPassword: 'new' }),
    ).toEqual({ oldPassword: 'old', newPassword: 'new' });
  });

  it('submits the edited profile through PUT /api/users/me with the correct body', async () => {
    let putBody: Record<string, unknown> | undefined;
    mockProfileApis((path, init) => {
      if (path === '/api/users/me' && init?.method === 'PUT') {
        putBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return { ...PROFILE, name: 'New Name' };
      }
    });

    renderWithQuery(<CustomerProfileFeature />);

    const nameInput = await screen.findByPlaceholderText('customer.profile.namePlaceholder');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'customer.profile.save' }));

    await waitFor(() =>
      expect(putBody).toEqual({ name: 'New Name', phone: '13800000000' }),
    );
  });

  it('blocks change-password submission when confirm does not match', async () => {
    const spy = mockProfileApis();

    renderWithQuery(<CustomerProfileFeature />);

    await screen.findByPlaceholderText('customer.profile.namePlaceholder');
    fireEvent.change(screen.getByPlaceholderText('customer.profile.oldPasswordPlaceholder'), {
      target: { value: 'oldpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.newPasswordPlaceholder'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.confirmPasswordPlaceholder'), {
      target: { value: 'different12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'customer.profile.changePassword' }));

    expect(await screen.findByText('customer.profile.confirmMismatch')).toBeInTheDocument();
    expect(
      spy.mock.calls.some((c) => c[0] === '/api/auth/change-password'),
    ).toBe(false);
  });

  it('blocks change-password submission when the new password is too short', async () => {
    const spy = mockProfileApis();

    renderWithQuery(<CustomerProfileFeature />);

    await screen.findByPlaceholderText('customer.profile.namePlaceholder');
    fireEvent.change(screen.getByPlaceholderText('customer.profile.oldPasswordPlaceholder'), {
      target: { value: 'oldpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.newPasswordPlaceholder'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.confirmPasswordPlaceholder'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'customer.profile.changePassword' }));

    expect(await screen.findByText('customer.profile.newPasswordTooShort')).toBeInTheDocument();
    expect(
      spy.mock.calls.some((c) => c[0] === '/api/auth/change-password'),
    ).toBe(false);
  });

  it('posts {oldPassword,newPassword} when the change-password form is valid', async () => {
    let postBody: Record<string, unknown> | undefined;
    mockProfileApis((path, init) => {
      if (path === '/api/auth/change-password' && init?.method === 'POST') {
        postBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return null;
      }
    });

    renderWithQuery(<CustomerProfileFeature />);

    await screen.findByPlaceholderText('customer.profile.namePlaceholder');
    fireEvent.change(screen.getByPlaceholderText('customer.profile.oldPasswordPlaceholder'), {
      target: { value: 'oldpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.newPasswordPlaceholder'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.confirmPasswordPlaceholder'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'customer.profile.changePassword' }));

    await waitFor(() =>
      expect(postBody).toEqual({ oldPassword: 'oldpass12', newPassword: 'newpass12' }),
    );
  });

  it('shows the backend reasonKey when change-password fails', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path, init) => {
      if (path === '/api/auth/me') return Promise.resolve(CURRENT_USER);
      if (path === '/api/sites/current') return Promise.resolve(CURRENT_SITE);
      if (path === '/api/auth/change-password' && init?.method === 'POST') {
        return Promise.reject(new client.ApiError('VALIDATION_ERROR', 'old_password_incorrect'));
      }
      return Promise.resolve(PROFILE);
    });

    renderWithQuery(<CustomerProfileFeature />);

    await screen.findByPlaceholderText('customer.profile.namePlaceholder');
    fireEvent.change(screen.getByPlaceholderText('customer.profile.oldPasswordPlaceholder'), {
      target: { value: 'wrongpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.newPasswordPlaceholder'), {
      target: { value: 'newpass12' },
    });
    fireEvent.change(screen.getByPlaceholderText('customer.profile.confirmPasswordPlaceholder'), {
      target: { value: 'newpass12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'customer.profile.changePassword' }));

    expect(
      await screen.findByText('old_password_incorrect'),
    ).toBeInTheDocument();
  });

  it('renders real account identity, auth context, and site context', async () => {
    mockProfileApis();

    renderWithQuery(<CustomerProfileFeature />);

    expect((await screen.findAllByText('user@example.com')).length).toBeGreaterThan(0);
    expect(await screen.findByText('USER')).toBeInTheDocument();
    expect(await screen.findByText('customer:*')).toBeInTheDocument();
    expect(await screen.findByText('Main Console')).toBeInTheDocument();
    expect(await screen.findByText('Reseller Portal')).toBeInTheDocument();
    expect(await screen.findByText('tenant-1')).toBeInTheDocument();
  });

  it('surfaces auth and site reasonKeys instead of inventing account context', async () => {
    vi.spyOn(client, 'userApiRequest').mockImplementation((path) => {
      if (path === '/api/auth/me') return Promise.reject(new client.ApiError('PERMISSION_DENIED', 'insufficient_permissions'));
      if (path === '/api/sites/current') return Promise.reject(new client.ApiError('NOT_FOUND', 'site_not_found'));
      return Promise.resolve(PROFILE);
    });

    renderWithQuery(<CustomerProfileFeature />);

    expect(await screen.findByText('insufficient_permissions')).toBeInTheDocument();
    expect(await screen.findByText('site_not_found')).toBeInTheDocument();
  });
});
