export {
  PrismaClient,
  LedgerEntryType,
  PaymentChannel,
  PaymentOrderStatus,
  OrderType,
  OrderStatus,
  FulfillmentJobStatus,
  ProxyStatus,
  ProxyInstanceProtocol,
  ProxyInstanceIpType,
  ResourceStatus,
  ResourceType,
} from '../generated/client';
export type { Prisma } from '../generated/client';

import { PrismaClient } from '../generated/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
