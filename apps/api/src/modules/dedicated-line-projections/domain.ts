import { createHash } from 'node:crypto';
import type { ManagedLineProjectionRequest } from './managed-line-projection.adapter';

export function managedLineProjectionDesiredHash(request: ManagedLineProjectionRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
