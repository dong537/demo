import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  buildAdjustWalletPath,
  buildAdjustWalletBody,
  WalletAdjustModal,
  type WalletSummary,
} from '../wallet-adjust-modal.feature';
import * as client from '../../../shared/api/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'ledger.adjust.reasonValue.reason_required': '请填写修改原因',
        'ledger.adjust.reasonValue.generic': '余额修改失败，请检查填写内容后重试',
      };
      return translations[key] ?? key;
    },
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const WALLET: WalletSummary = {
  id: 'wallet-1',
  userId: 'user-1',
  available: '100.00',
  frozen: '0.00',
  currency: 'USD',
  updatedAt: '2026-06-09T00:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    getPropertyValue: () => '',
  } as unknown as CSSStyleDeclaration));
});

describe('wallet adjust feature contracts', () => {
  it('builds the adjust path against the real endpoint', () => {
    expect(buildAdjustWalletPath('user 1')).toBe('/api/wallet/user%201/adjust');
  });

  it('builds the adjust body with stringified amount and required fields', () => {
    expect(
      buildAdjustWalletBody({
        direction: 'credit',
        amount: 12.5,
        currency: 'USD',
        reason: 'compensation',
        idempotencyKey: 'idem-1',
      }),
    ).toEqual({
      direction: 'credit',
      amount: '12.5',
      currency: 'USD',
      reason: 'compensation',
      idempotencyKey: 'idem-1',
    });
  });

  it('blocks submission when reason is empty (no POST fires)', async () => {
    let posted = false;
    vi.spyOn(client, 'apiRequest').mockImplementation(() => {
      posted = true;
      return Promise.resolve(WALLET);
    });

    renderWithQuery(<WalletAdjustModal wallet={WALLET} open onClose={() => {}} />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '10' } });

    // open the danger confirm then confirm; validation must stop the POST
    fireEvent.click(within(dialog).getByRole('button', { name: 'ledger.adjust.submit' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'ledger.adjust.submit' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() =>
      expect(within(dialog).getByText('ledger.adjust.reasonRequired')).toBeInTheDocument(),
    );
    expect(posted).toBe(false);
  });

  it('posts the correct body and invalidates wallet + ledger queries on success', async () => {
    let postBody: Record<string, unknown> | undefined;
    let postPath: string | undefined;
    vi.spyOn(client, 'apiRequest').mockImplementation((path, init) => {
      postPath = path;
      postBody = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Promise.resolve(WALLET);
    });

    const { queryClient } = renderWithQuery(
      <WalletAdjustModal wallet={WALLET} open onClose={() => {}} />,
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'manual top-up' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'ledger.adjust.submit' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'ledger.adjust.submit' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(postPath).toBe('/api/wallet/user-1/adjust'));
    expect(postBody).toMatchObject({
      direction: 'credit',
      amount: '25',
      currency: 'USD',
      reason: 'manual top-up',
    });
    expect(typeof postBody!.idempotencyKey).toBe('string');
    expect((postBody!.idempotencyKey as string).length).toBeGreaterThan(0);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wallet', 'user-1'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ledger', 'user-1'] });
  });

  it('shows a readable adjust failure instead of the backend reasonKey', async () => {
    vi.spyOn(client, 'apiRequest').mockImplementation(() =>
      Promise.reject(new client.ApiError('VALIDATION_ERROR', 'reason_required')),
    );

    renderWithQuery(<WalletAdjustModal wallet={WALLET} open onClose={() => {}} />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'manual top-up' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'ledger.adjust.submit' }));
    const confirmButtons = await screen.findAllByRole('button', { name: 'ledger.adjust.submit' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByText('请填写修改原因')).toBeInTheDocument();
    expect(screen.queryByText('reason_required')).not.toBeInTheDocument();
  });
});
