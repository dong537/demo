import React from 'react';
import { LedgerListFeature } from '../../../features/wallet/ledger-list.feature';

export function WalletPage() {
  const userId = new URLSearchParams(window.location.search).get('userId')?.trim() ?? '';
  return <LedgerListFeature initialUserId={userId} />;
}
