import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../../common/errors/error-codes';
import { normalizeDeliveryRouteImport } from './delivery-route-import.domain';

describe('normalizeDeliveryRouteImport', () => {
  it('normalizes multiple domains and preserves a stable fingerprint', () => {
    const input = {
      sourceName: 'ny-panel', sourceVersion: '2026-08-11-1', capturedAt: '2026-08-11T10:00:00.000Z',
      routes: [{
        sourceRouteId: 'route-1', dedicatedLineId: 'line-1', entranceGroupCode: 'SV', protocol: 'VLESS', listenPort: 60701,
        sourceVersion: 'ny-1', validFrom: '2026-08-11T10:00:00.000Z',
        domains: [
          { hostname: 'TEST-SV-1.YISUKJ.TOP', port: 60701, isPrimary: true },
          { hostname: 'test-sv-backup.yisukj.top', port: 60701, isPrimary: false },
        ],
        targets: [{ nodeId: 'node-1', targetPort: 60701, targetVersion: 'xray-1' }],
      }],
    };
    const first = normalizeDeliveryRouteImport(input);
    const second = normalizeDeliveryRouteImport(input);
    expect(first.routes[0]?.domains[0]?.hostname).toBe('test-sv-1.yisukj.top');
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
  });

  it('rejects duplicate domains and missing primary domain', () => {
    const base = {
      sourceName: 'ny-panel', sourceVersion: '1', capturedAt: '2026-08-11T10:00:00.000Z',
      routes: [{
        sourceRouteId: 'route-1', dedicatedLineId: 'line-1', entranceGroupCode: 'SV', protocol: 'VLESS', listenPort: 60701,
        sourceVersion: '1', validFrom: '2026-08-11T10:00:00.000Z',
        domains: [{ hostname: 'test.yisukj.top', port: 60701, isPrimary: false }, { hostname: 'test.yisukj.top', port: 60701, isPrimary: true }],
        targets: [{ nodeId: 'node-1', targetPort: 60701, targetVersion: '1' }],
      }],
    };
    expect(() => normalizeDeliveryRouteImport(base)).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR, reasonKey: 'route_import_domain_duplicate' }));
  });
});
