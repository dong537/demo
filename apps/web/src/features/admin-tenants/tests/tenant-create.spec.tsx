import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { TenantCreateFeature } from '../tenant-create.feature';
import * as client from '../../../shared/api/client';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    message: {
      ...actual.message,
      success: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.restoreAllMocks();
  navigateMock.mockReset();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('tenant create feature', () => {
  it('creates a sub-site with a real tenant admin account', async () => {
    let body: Record<string, unknown> | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(path).toBe('/api/tenants');
      expect(init?.method).toBe('POST');
      return Promise.resolve({ id: 'tenant-1', name: 'Reseller A', code: 'reseller-a' });
    });

    render(<TenantCreateFeature mode="reseller" />);

    fireEvent.change(screen.getByLabelText('tenants.name'), { target: { value: ' Reseller A ' } });
    fireEvent.change(screen.getByLabelText('tenants.code'), { target: { value: ' reseller-a ' } });
    fireEvent.change(screen.getByLabelText('tenants.adminEmail'), { target: { value: ' owner@example.com ' } });
    fireEvent.change(screen.getByLabelText('tenants.adminPassword'), { target: { value: 'OwnerPass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(body).toEqual({
        name: 'Reseller A',
        code: 'reseller-a',
        adminEmail: 'owner@example.com',
        adminPassword: 'OwnerPass123',
      });
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/admin/resellers/tenant-1' });
  });
});
