import { describe, expect, it } from 'vitest';
import {
  evaluateProductionReadiness,
  ProductionReadinessSnapshot,
} from './production-readiness.use-case';

const completeSnapshot: ProductionReadinessSnapshot = {
  activeSkuIds: ['sku-sv', 'sku-zb'],
  pricedSkuIds: ['sku-sv', 'sku-zb'],
  inventorySkuIds: ['sku-sv', 'sku-zb'],
  placementSkuIds: ['sku-sv', 'sku-zb'],
  readyProviderAccounts: 1,
  availableControlNodes: 2,
  activeInboundProfiles: 2,
  completeCurrentRoutes: 1,
  routesWithPrimaryAndBackupDomains: 1,
  alertsConfigured: true,
  executionGatesEnabled: true,
};

describe('evaluateProductionReadiness', () => {
  it('reports every missing production prerequisite without exposing sensitive values', () => {
    const result = evaluateProductionReadiness({
      activeSkuIds: [],
      pricedSkuIds: [],
      inventorySkuIds: [],
      placementSkuIds: [],
      readyProviderAccounts: 0,
      availableControlNodes: 0,
      activeInboundProfiles: 0,
      completeCurrentRoutes: 0,
      routesWithPrimaryAndBackupDomains: 0,
      alertsConfigured: false,
      executionGatesEnabled: false,
    }, new Date('2026-08-14T00:00:00.000Z'));

    expect(result.ready).toBe(false);
    expect(result.checkedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(result.checks).toHaveLength(11);
    expect(result.checks.every((check) => !check.ok)).toBe(true);
    expect(result.checks.map((check) => check.key)).toEqual([
      'skus',
      'pricing',
      'providers',
      'inventory',
      'placement',
      'nodes',
      'inbounds',
      'routes',
      'domains',
      'alerts',
      'executionGates',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/credential|password|secret|baseUrl|hostname/i);
  });

  it('is ready only when every active dedicated-line SKU has a complete sale path', () => {
    const result = evaluateProductionReadiness(completeSnapshot, new Date('2026-08-14T00:00:00.000Z'));

    expect(result.ready).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it.each([
    ['pricing', { pricedSkuIds: ['sku-sv'] as string[] }],
    ['inventory', { inventorySkuIds: ['sku-sv'] as string[] }],
    ['placement', { placementSkuIds: ['sku-sv'] as string[] }],
  ] as const)('fails %s when one active SKU is not covered', (key, patch) => {
    const result = evaluateProductionReadiness({ ...completeSnapshot, ...patch });
    const check = result.checks.find((item) => item.key === key);

    expect(result.ready).toBe(false);
    expect(check).toMatchObject({ ok: false, missing: 1 });
  });
});
