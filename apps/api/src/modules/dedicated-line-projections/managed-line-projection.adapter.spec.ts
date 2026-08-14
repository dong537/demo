import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../common/errors/error-codes';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import { ManagedLineProjectionAdapter, type ManagedLineProjectionRequest } from './managed-line-projection.adapter';

const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const request: ManagedLineProjectionRequest = {
  desiredVersion: 1,
  inboundTag: 'sv-hk-1',
  protocol: 'VLESS',
  client: { email: 'line-1@365proxy.internal', id: 'client-id' },
  egress: { host: '198.51.100.10', port: 1080, username: 'egress-user', password: 'egress-secret' },
  lifecycle: {
    enabled: true,
    expiresAtMs: 1_900_000_000_000,
    trafficLimitBytes: 0,
    ipLimit: 0,
    uplinkLimitBps: 0,
    downlinkLimitBps: 0,
    maxConnections: 0,
  },
};

function node() {
  return {
    baseUrl: 'https://panel.example.com/',
    apiCredentialCiphertext: encryptAesGcm('panel-token', encryptionKey),
  };
}

describe('ManagedLineProjectionAdapter', () => {
  it('writes the OpenUI contract with bearer auth and returns the projection', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      projectionKey: 'line-1-node-1', desiredVersion: 1, observedVersion: 1,
      desiredHash: 'desired-hash', observedHash: 'desired-hash', status: 'ACTIVE',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    const result = await adapter.upsert(node(), 'line-1-node-1', request);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://panel.example.com/panel/api/managed-line-projections/line-1-node-1');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer panel-token');
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(result.status).toBe('ACTIVE');
  });

  it('maps remote conflicts without including client or egress secrets', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      msg: 'MANAGED_LINE_CONFLICT: current=2',
    }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.upsert(node(), 'line-1-node-1', request)).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
      httpStatus: 409,
    });
    try {
      await adapter.upsert(node(), 'line-1-node-1', request);
    } catch (error) {
      expect(String(error)).not.toContain('egress-secret');
      expect(String(error)).not.toContain('panel-token');
      expect(String(error)).not.toContain('client-id');
    }
  });

  it('maps request timeout to the shared upstream timeout error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.get(node(), 'line-1-node-1')).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_TIMEOUT,
      httpStatus: 504,
    });
  });

  it.each([400, 422])('maps remote input status %s to a non-retryable validation error', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      reasonKey: 'managed_line_projection_request_invalid',
    });
  });

  it('rejects unsafe control-node URLs before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.get({ ...node(), baseUrl: 'http://127.0.0.1:8080' }, 'line-1-node-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a remote 404 delete as idempotent success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('confirms a successful remote delete with a 404 read-back', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectionKey: 'line-1-node-1', desiredVersion: 3, observedVersion: 3,
        desiredHash: 'desired-hash', observedHash: 'desired-hash', status: 'DELETED',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('GET');
  });

  it('accepts a 204 delete response and still requires a 404 read-back', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('accepts the matching OpenUI DELETED tombstone as confirmed deletion', async () => {
    const tombstone = {
      projectionKey: 'line-1-node-1', desiredVersion: 3, observedVersion: 3,
      desiredHash: 'deleted', observedHash: 'deleted', status: 'DELETED',
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(tombstone), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tombstone), { status: 200 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a stale DELETED tombstone', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectionKey: 'line-1-node-1', desiredVersion: 3, observedVersion: 3,
        desiredHash: 'deleted', observedHash: 'deleted', status: 'DELETED',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectionKey: 'line-1-node-1', desiredVersion: 2, observedVersion: 2,
        desiredHash: 'old', observedHash: 'old', status: 'DELETED',
      }), { status: 200 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).rejects.toMatchObject({
      reasonKey: 'managed_line_projection_delete_not_confirmed',
    });
  });

  it('recovers an idempotent replay when OpenUI returns 409 for an existing tombstone', async () => {
    const tombstone = {
      projectionKey: 'line-1-node-1', desiredVersion: 3, observedVersion: 3,
      desiredHash: '', observedHash: '', status: 'DELETED',
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tombstone), { status: 200 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).resolves.toBeUndefined();
  });

  it('preserves a delete conflict when a 409 read-back returns 404', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
      reasonKey: 'managed_line_projection_conflict',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('preserves a true OpenUI delete conflict when read-back is not the exact tombstone', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectionKey: 'line-1-node-1', desiredVersion: 2, observedVersion: 2,
        desiredHash: 'active', observedHash: 'active', status: 'ACTIVE',
      }), { status: 200 }));
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.delete(node(), 'line-1-node-1', 3)).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
      reasonKey: 'managed_line_projection_conflict',
    });
  });
});
