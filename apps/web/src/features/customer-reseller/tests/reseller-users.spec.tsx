import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResellerUsersFeature } from '../reseller-users.feature';
import { userApiRequest } from '../../../shared/api/client';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/api/client')>('../../../shared/api/client');
  return {
    ...actual,
    userApiRequest: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration);
});

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ResellerUsersFeature', () => {
  it('creates a reseller customer through the real customer reseller endpoint and shows pending feedback', async () => {
    vi.mocked(userApiRequest)
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 20,
        total: 0,
        items: [],
      })
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 20,
        total: 1,
        items: [],
      });

    renderWithQueryClient(<ResellerUsersFeature />);

    const createText = await screen.findByText('customer.reseller.users.create');
    fireEvent.click(createText.closest('button') as HTMLButtonElement);
    fireEvent.change(screen.getByLabelText('customer.reseller.users.email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('customer.reseller.users.password'), { target: { value: 'password123' } });
    fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => {
      expect(userApiRequest).toHaveBeenCalledWith('/api/customer/reseller/users', {
        method: 'POST',
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'password123',
        }),
      });
    });
    expect(screen.getAllByText('customer.reseller.users.createPending').length).toBeGreaterThan(0);
    expect(vi.mocked(userApiRequest).mock.calls.some((call) => String(call[0]).startsWith('/api/resources'))).toBe(false);
  });
});
