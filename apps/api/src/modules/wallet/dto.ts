export interface WalletDto {
  id: string;
  userId: string;
  available: string;
  frozen: string;
  currency: string;
  updatedAt: Date;
}

export interface LedgerEntryDto {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  currency: string;
  relatedId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface AdjustWalletDto {
  direction: 'credit' | 'debit';
  amount: string;
  currency: string;
  reason: string;
  idempotencyKey: string;
}
