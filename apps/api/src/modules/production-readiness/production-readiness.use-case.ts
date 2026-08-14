import { Injectable } from '@nestjs/common';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { parseAllowlist } from '../../common/config/allowlist';
import { ConfigService } from '../../common/config/config.service';
import { requireProviderAdmin } from '../providers/admin-access';
import { ProductionReadinessRepository } from './production-readiness.repository';

export type ProductionReadinessSnapshot = {
  activeSkuIds: string[];
  pricedSkuIds: string[];
  inventorySkuIds: string[];
  placementSkuIds: string[];
  readyProviderAccounts: number;
  availableControlNodes: number;
  activeInboundProfiles: number;
  completeCurrentRoutes: number;
  routesWithPrimaryAndBackupDomains: number;
  alertsConfigured: boolean;
  executionGatesEnabled: boolean;
};

export type ProductionReadinessCheck = {
  key: 'skus' | 'pricing' | 'providers' | 'inventory' | 'placement' | 'nodes' | 'inbounds' | 'routes' | 'domains' | 'alerts' | 'executionGates';
  ok: boolean;
  reasonKey: string | null;
  count?: number;
  missing?: number;
};

export type ProductionReadinessResult = {
  ready: boolean;
  checks: ProductionReadinessCheck[];
  checkedAt: string;
};

@Injectable()
export class ProductionReadinessUseCase {
  constructor(
    private readonly repository: ProductionReadinessRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(ctx: AuthenticatedContext): Promise<ProductionReadinessResult> {
    requireProviderAdmin(ctx);
    const now = new Date();
    const dbSnapshot = await this.repository.read({
      siteId: ctx.siteId,
      currency: this.config.get('APP_PLATFORM_CURRENCY'),
      providerAllowlist: parseAllowlist(this.config.get('DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST')),
      providerAccountAllowlist: parseAllowlist(this.config.get('DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST')),
      now,
    });
    return evaluateProductionReadiness({
      ...dbSnapshot,
      alertsConfigured:
        this.config.get('BARK_ALERTS_ENABLED') === 'true'
        && this.config.get('BARK_DEVICE_KEYS').trim().length > 0,
      executionGatesEnabled: [
        this.config.get('PAYMENT_CONFIRMATION_ENABLED'),
        this.config.get('PROVIDER_INVENTORY_SYNC_ENABLED'),
        this.config.get('DEDICATED_LINE_ORDER_EXECUTION_ENABLED'),
        this.config.get('DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED'),
        this.config.get('DEDICATED_LINE_HEALTH_EXECUTION_ENABLED'),
      ].every((value) => value === 'true'),
    }, now);
  }
}

export function evaluateProductionReadiness(
  snapshot: ProductionReadinessSnapshot,
  now = new Date(),
): ProductionReadinessResult {
  const activeSkuIds = new Set(snapshot.activeSkuIds);
  const pricedSkuIds = intersectionCount(activeSkuIds, snapshot.pricedSkuIds);
  const inventorySkuIds = intersectionCount(activeSkuIds, snapshot.inventorySkuIds);
  const placementSkuIds = intersectionCount(activeSkuIds, snapshot.placementSkuIds);
  const skuCount = activeSkuIds.size;
  const checks: ProductionReadinessCheck[] = [
    countCheck('skus', skuCount, skuCount === 0 ? 1 : 0, 'production_readiness_skus_missing'),
    countCheck('pricing', pricedSkuIds, missingSkuCoverage(skuCount, pricedSkuIds), 'production_readiness_pricing_incomplete'),
    countCheck('providers', snapshot.readyProviderAccounts, snapshot.readyProviderAccounts > 0 ? 0 : 1, 'production_readiness_provider_unhealthy'),
    countCheck('inventory', inventorySkuIds, missingSkuCoverage(skuCount, inventorySkuIds), 'production_readiness_inventory_incomplete'),
    countCheck('placement', placementSkuIds, missingSkuCoverage(skuCount, placementSkuIds), 'production_readiness_placement_incomplete'),
    countCheck('nodes', snapshot.availableControlNodes, snapshot.availableControlNodes > 0 ? 0 : 1, 'production_readiness_nodes_unavailable'),
    countCheck('inbounds', snapshot.activeInboundProfiles, snapshot.activeInboundProfiles > 0 ? 0 : 1, 'production_readiness_inbounds_missing'),
    countCheck('routes', snapshot.completeCurrentRoutes, snapshot.completeCurrentRoutes > 0 ? 0 : 1, 'production_readiness_routes_missing'),
    countCheck(
      'domains',
      snapshot.routesWithPrimaryAndBackupDomains,
      Math.max(0, snapshot.completeCurrentRoutes - snapshot.routesWithPrimaryAndBackupDomains) || 1,
      'production_readiness_route_domains_incomplete',
      snapshot.completeCurrentRoutes > 0
        && snapshot.routesWithPrimaryAndBackupDomains === snapshot.completeCurrentRoutes,
    ),
    booleanCheck('alerts', snapshot.alertsConfigured, 'production_readiness_alerts_disabled'),
    booleanCheck('executionGates', snapshot.executionGatesEnabled, 'production_readiness_execution_gates_disabled'),
  ];
  return {
    ready: checks.every((check) => check.ok),
    checks,
    checkedAt: now.toISOString(),
  };
}

function intersectionCount(expected: Set<string>, actual: string[]): number {
  return new Set(actual.filter((id) => expected.has(id))).size;
}

function missingSkuCoverage(skuCount: number, coveredSkuCount: number): number {
  return skuCount === 0 ? 1 : Math.max(0, skuCount - coveredSkuCount);
}

function countCheck(
  key: ProductionReadinessCheck['key'],
  count: number,
  missing: number,
  reasonKey: string,
  explicitOk?: boolean,
): ProductionReadinessCheck {
  const ok = explicitOk ?? missing === 0;
  return { key, ok, reasonKey: ok ? null : reasonKey, count, missing };
}

function booleanCheck(
  key: ProductionReadinessCheck['key'],
  ok: boolean,
  reasonKey: string,
): ProductionReadinessCheck {
  return { key, ok, reasonKey: ok ? null : reasonKey };
}
