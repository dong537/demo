import { Prisma } from '@ipeasy/db';

export const CURRENT_PROVIDER_ACCOUNT_ORDER_BY: Prisma.provider_accountsOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { createdAt: 'desc' },
];

export const CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY: Prisma.upstream_api_accountsOrderByWithRelationInput[] = [
  { updatedAt: 'desc' },
  { createdAt: 'desc' },
];
