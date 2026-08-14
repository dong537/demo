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

  it('rejects unsafe control-node URLs before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new ManagedLineProjectionAdapter({ get: (key: string) => key === 'APP_ENCRYPTION_KEY' ? encryptionKey : 10_000 } as never, fetchImpl);

    await expect(adapter.get({ ...node(), baseUrl: 'http://127.0.0.1:8080' }, 'line-1-node-1')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
