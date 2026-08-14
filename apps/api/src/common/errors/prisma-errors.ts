import { Prisma } from '@ipeasy/db/generated/client';

export function isUniqueConstraintError(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!target) return true;
  const metaTarget = error.meta?.['target'];
  return Array.isArray(metaTarget) ? metaTarget.includes(target) : metaTarget === target;
}
