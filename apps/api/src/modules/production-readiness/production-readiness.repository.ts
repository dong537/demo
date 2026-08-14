import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import type { ProductionReadinessSnapshot } from './production-readiness.use-case';

type DatabaseReadinessSnapshot = Omit<ProductionReadinessSnapshot, 'alertsConfigured' | 'executionGatesEnabled'>;

const PROVIDER_HEALTH_TTL_MS = 15 * 60 * 1_000;

@Injectable()
export class ProductionReadinessRepository {
  async read(input: {
    siteId: string;
    currency: string;
    providerAllowlist: Set<string>;
    providerAccountAllowlist: Set<string>;
    now: Date;
  }): Promise<DatabaseReadinessSnapshot> {
    const activeSkus = await prisma.service_skus.findMany({
      where: {
        siteId: input.siteId,
        isActive: true,
        isVisible: true,
        capabilities: { path: ['delivery'], equals: 'dedicated-line' },
      },
      select: { id: true },
    });
    const activeSkuIds = activeSkus.map((sku) => sku.id);
    if (activeSkuIds.length === 0) return emptyDatabaseSnapshot();

    const [priceRules, priceOverrides, providerAccounts, policies, routes] = await Promise.all([
      prisma.sku_price_rules.findMany({
        where: {
          siteId: input.siteId,
          skuId: { in: activeSkuIds },
          currency: input.currency,
          unitPrice: { gt: 0 },
          template: { siteId: input.siteId, tenantId: null, isDefault: true },
        },
        select: { skuId: true },
      }),
      prisma.sku_price_overrides.findMany({
        where: {
          siteId: input.siteId,
          skuId: { in: activeSkuIds },
          currency: input.currency,
          unitPrice: { gt: 0 },
        },
        select: { skuId: true },
      }),
      this.listAllowlistedProviderAccounts(input),
      prisma.line_placement_policies.findMany({
        where: {
          siteId: input.siteId,
          tenantId: null,
          userId: null,
          isActive: true,
          OR: [{ skuId: null }, { skuId: { in: activeSkuIds } }],
        },
        include: {
          inboundProfile: { select: { id: true, isActive: true, nodeGroupId: true } },
          nodeGroup: { select: { id: true, isActive: true } },
          allowedNodes: {
            select: {
              node: {
                select: {
                  id: true,
                  nodeGroupId: true,
                  status: true,
                  capacityUnits: true,
                  allocatedUnits: true,
                },
              },
            },
          },
        },
      }),
      prisma.delivery_routes.findMany({
        where: {
          siteId: input.siteId,
          dedicatedLineId: { not: null },
          isCurrent: true,
          isStaged: false,
          validFrom: { lte: input.now },
          AND: [
            { OR: [{ validUntil: null }, { validUntil: { gt: input.now } }] },
            { routeImport: { OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }] } },
          ],
        },
        select: {
          domains: { select: { isPrimary: true } },
          targets: { select: { node: { select: { status: true } } } },
        },
      }),
    ]);

    const readyProviderIds = await this.filterRecentlyHealthyProviders(input.siteId, providerAccounts.map((account) => account.id), input.now);
    const inventory = readyProviderIds.length === 0
      ? []
      : await prisma.dedicated_line_inventory_snapshots.findMany({
        where: {
          siteId: input.siteId,
          providerAccountId: { in: readyProviderIds },
          skuId: { in: activeSkuIds },
          expiresAt: { gt: input.now },
          quantity: { gt: 0 },
        },
        select: { skuId: true, quantity: true, reservedQuantity: true },
      });

    const validPolicies = policies.filter((policy) => {
      if (!policy.inboundProfile.isActive || !policy.nodeGroup.isActive) return false;
      if (policy.inboundProfile.nodeGroupId !== policy.nodeGroupId) return false;
      if (
        policy.targetReplicaCount < 1
        || policy.minReadyReplicaCount < 1
        || policy.minReadyReplicaCount > policy.targetReplicaCount
        || policy.maxUnitsPerNode < 1
      ) return false;
      const availableNodes = policy.allowedNodes.filter(({ node }) =>
        node.nodeGroupId === policy.nodeGroupId
        && node.status === 'ACTIVE'
        && node.allocatedUnits < Math.min(node.capacityUnits, policy.maxUnitsPerNode),
      );
      return availableNodes.length >= policy.targetReplicaCount;
    });
    const placementSkuIds = new Set<string>();
    for (const policy of validPolicies) {
      if (policy.skuId) placementSkuIds.add(policy.skuId);
      else activeSkuIds.forEach((skuId) => placementSkuIds.add(skuId));
    }
    const availableNodeIds = new Set(
      validPolicies.flatMap((policy) => policy.allowedNodes
        .filter(({ node }) =>
          node.nodeGroupId === policy.nodeGroupId
          && node.status === 'ACTIVE'
          && node.allocatedUnits < Math.min(node.capacityUnits, policy.maxUnitsPerNode),
        )
        .map(({ node }) => node.id)),
    );
    const activeInboundProfileIds = new Set(validPolicies.map((policy) => policy.inboundProfile.id));
    const completeRoutes = routes.filter((route) =>
      route.domains.length > 0
      && route.targets.length > 0
      && route.targets.every((target) => target.node.status === 'ACTIVE'),
    );
    const routesWithPrimaryAndBackupDomains = completeRoutes.filter((route) =>
      route.domains.filter((domain) => domain.isPrimary).length === 1
      && route.domains.some((domain) => !domain.isPrimary),
    ).length;

    return {
      activeSkuIds,
      pricedSkuIds: unique([...priceRules, ...priceOverrides].map((price) => price.skuId)),
      inventorySkuIds: unique(inventory.filter((row) => row.quantity > row.reservedQuantity).map((row) => row.skuId)),
      placementSkuIds: [...placementSkuIds],
      readyProviderAccounts: readyProviderIds.length,
      availableControlNodes: availableNodeIds.size,
      activeInboundProfiles: activeInboundProfileIds.size,
      completeCurrentRoutes: completeRoutes.length,
      routesWithPrimaryAndBackupDomains,
    };
  }

  private async listAllowlistedProviderAccounts(input: {
    siteId: string;
    providerAllowlist: Set<string>;
    providerAccountAllowlist: Set<string>;
  }): Promise<Array<{ id: string }>> {
    const allowedProviders = [...input.providerAllowlist];
    const allowedAccounts = [...input.providerAccountAllowlist];
    if (allowedProviders.length === 0 && allowedAccounts.length === 0) return [];
    return prisma.provider_accounts.findMany({
      where: {
        siteId: input.siteId,
        status: 'ACTIVE',
        inventorySyncEnabled: true,
        OR: [
          ...(allowedProviders.length > 0 ? [{ providerCode: { in: allowedProviders } }] : []),
          ...(allowedAccounts.length > 0 ? [{ id: { in: allowedAccounts } }] : []),
        ],
      },
      select: { id: true },
    });
  }

  private async filterRecentlyHealthyProviders(siteId: string, accountIds: string[], now: Date): Promise<string[]> {
    if (accountIds.length === 0) return [];
    const observations = await prisma.audit_logs.findMany({
      where: {
        siteId,
        targetType: 'provider_account',
        targetId: { in: accountIds },
        action: 'provider.health_check',
        createdAt: { gt: new Date(now.getTime() - PROVIDER_HEALTH_TTL_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { targetId: true, meta: true },
    });
    const latest = new Map<string, boolean>();
    for (const observation of observations) {
      if (!observation.targetId || latest.has(observation.targetId)) continue;
      latest.set(observation.targetId, isReachableMeta(observation.meta));
    }
    return accountIds.filter((id) => latest.get(id) === true);
  }
}

function isReachableMeta(meta: unknown): boolean {
  return Boolean(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>)['reachable'] === true);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyDatabaseSnapshot(): DatabaseReadinessSnapshot {
  return {
    activeSkuIds: [],
    pricedSkuIds: [],
    inventorySkuIds: [],
    placementSkuIds: [],
    readyProviderAccounts: 0,
    availableControlNodes: 0,
    activeInboundProfiles: 0,
    completeCurrentRoutes: 0,
    routesWithPrimaryAndBackupDomains: 0,
  };
}
