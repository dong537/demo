import { prisma } from '@ipeasy/db';
import type { IpType } from '@ipeasy/db/generated/client';
import { resourceCountryCode } from './base-price';

type PricingScopeResource = {
  id: string;
  parentId: string | null;
  code: string;
  providerCode: string;
  upstreamAccountId: string | null;
  ipType: IpType;
  type: string;
};

const MAX_RESOURCE_SCOPE_DEPTH = 8;

export async function resolvePricingResourceIds(siteId: string, resourceId: string): Promise<string[]> {
  const resource = await findPricingScopeResource(siteId, resourceId);
  if (!resource) return [resourceId];

  const scopeIds = [resource.id];
  const seen = new Set(scopeIds);
  let parentId = resource.parentId;
  let depth = 0;

  while (parentId && depth < MAX_RESOURCE_SCOPE_DEPTH) {
    if (seen.has(parentId)) break;
    const parent = await findPricingScopeResource(siteId, parentId);
    if (!parent) break;

    if (
      parent.providerCode === resource.providerCode
      && parent.ipType === resource.ipType
      && parent.upstreamAccountId === resource.upstreamAccountId
    ) {
      scopeIds.push(parent.id);
      seen.add(parent.id);
    }
    parentId = parent.parentId;
    depth += 1;
  }

  const countryCode = resourceCountryCode(resource.code);
  const countryResource = await prisma.platform_resources.findFirst({
    where: {
      siteId,
      providerCode: resource.providerCode,
      upstreamAccountId: resource.upstreamAccountId,
      ipType: resource.ipType,
      type: 'COUNTRY',
      code: countryCode,
    },
    select: { id: true },
  });
  if (countryResource && !seen.has(countryResource.id)) {
    scopeIds.push(countryResource.id);
  }

  return scopeIds;
}

export async function resolvePricingScopesForResources(
  siteId: string,
  resources: Array<{ id: string }>,
): Promise<Map<string, string[]>> {
  const entries = await Promise.all(
    resources.map(async (resource) => [resource.id, await resolvePricingResourceIds(siteId, resource.id)] as const),
  );
  return new Map(entries);
}

function findPricingScopeResource(siteId: string, resourceId: string): Promise<PricingScopeResource | null> {
  return prisma.platform_resources.findFirst({
    where: { id: resourceId, siteId },
    select: {
      id: true,
      parentId: true,
      code: true,
      providerCode: true,
      upstreamAccountId: true,
      ipType: true,
      type: true,
    },
  });
}
