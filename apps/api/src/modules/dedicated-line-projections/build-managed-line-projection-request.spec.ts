import { describe, expect, it } from 'vitest';
import { encryptAesGcm } from '../../common/crypto/aes-gcm';
import {
  buildManagedLineProjectionRequest,
  type ManagedLineProjectionSource,
} from './build-managed-line-projection-request';

const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('buildManagedLineProjectionRequest', () => {
  it('carries per-email bandwidth and connection limits to the OpenUI data plane', () => {
    const request = buildManagedLineProjectionRequest(projectionSource(), encryptionKey);

    expect(request.lifecycle).toMatchObject({
      trafficLimitBytes: 10_000,
      ipLimit: 2,
      uplinkLimitBps: 131_072,
      downlinkLimitBps: 524_288,
      maxConnections: 32,
    });
  });

  it.each([
    ['uplink limit outside the JSON-safe range', { uplinkLimitBps: BigInt(Number.MAX_SAFE_INTEGER) + 1n }, 'dedicated_line_uplink_limit_invalid'],
    ['negative downlink limit', { downlinkLimitBps: -1n }, 'dedicated_line_downlink_limit_invalid'],
    ['negative connection limit', { maxConnections: -1 }, 'dedicated_line_connection_limit_invalid'],
  ] as const)('rejects %s', (_case, override, reasonKey) => {
    expect(() => buildManagedLineProjectionRequest({ ...projectionSource(), ...override }, encryptionKey))
      .toThrow(reasonKey);
  });
});

function projectionSource(): ManagedLineProjectionSource {
  return {
    desiredVersion: 3,
    inboundTag: 'sv-hk-1',
    protocol: 'VLESS',
    clientEmail: 'line-3@365proxy.internal',
    clientIdentityCiphertext: encryptAesGcm(JSON.stringify({ id: 'b6a611d3-f35f-4de6-8a55-3d7f0932ca78' }), encryptionKey),
    lineStatus: 'ACTIVE',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    quotaBytes: 10_000n,
    uplinkLimitBps: 131_072n,
    downlinkLimitBps: 524_288n,
    maxConnections: 32,
    ipLimit: 2,
    endpointCiphertext: encryptAesGcm(JSON.stringify({ host: '198.51.100.10', port: 1080, protocol: 'SOCKS5' }), encryptionKey),
    credentialCiphertext: encryptAesGcm(JSON.stringify({ username: 'egress', password: 'secret' }), encryptionKey),
  };
}
