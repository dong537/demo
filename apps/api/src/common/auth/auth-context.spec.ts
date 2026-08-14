import { describe, expect, it } from 'vitest';
import { AuthenticatedContext, requireScope } from './auth-context';

function context(scopes: string[]): AuthenticatedContext {
  return {
    ownerId: 'user-1',
    ownerType: 'USER',
    siteId: 'site-1',
    tenantId: 'tenant-1',
    scopes,
    requestId: 'request-1',
  };
}

describe('requireScope', () => {
  it('accepts an exact scope and a namespace wildcard', () => {
    expect(() => requireScope(context(['dedicated:catalog:read']), 'dedicated:catalog:read')).not.toThrow();
    expect(() => requireScope(context(['dedicated:*']), 'dedicated:inventory:read')).not.toThrow();
  });

  it('rejects unrelated scopes', () => {
    expect(() => requireScope(context(['dedicated:wallet:read']), 'dedicated:catalog:read')).toThrowError(
      expect.objectContaining({ reasonKey: 'insufficient_scope', httpStatus: 403 }),
    );
  });
});
