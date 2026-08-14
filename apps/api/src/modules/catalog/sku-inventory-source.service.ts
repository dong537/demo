import { prisma } from '@ipeasy/db';
import { Prisma } from '@ipeasy/db/generated/client';
import { DEFAULT_LINE_SKUS } from './sku-seed';
import {
  type DedicatedLineInventorySource,
  mergeInventorySourceCapabilities,
  normalizeInventorySource,
  readInventorySource,
  SkuInventorySourceValidationError,
} from './sku-inventory-source';

export async function seedLineSkus(
  siteId: string,
  inventorySource?: DedicatedLineInventorySource,
): Promise<{ upserted: number; codes: string[] }> {
  const normalizedSiteId = requiredIdentifier(siteId, 'site_id_required');
  const explicitSource = inventorySource ? normalizeInventorySource(inventorySource) : null;
  await prisma.$transaction(async (tx) => {
    for (const sku of DEFAULT_LINE_SKUS) {
      const existing = await tx.service_skus.findUnique({
        where: { siteId_code: { siteId: normalizedSiteId, code: sku.code } },
        select: { capabilities: true },
      });
      const persistedCapabilities = existing
        ? mergeInventorySourceCapabilities(existing.capabilities, undefined)
        : {};
      const defaultCapabilities = mergeInventorySourceCapabilities({
        ...sku.capabilities,
        supportedProtocols: [...sku.capabilities.supportedProtocols],
      }, undefined);
      const inventorySourceToPersist = explicitSource
        ?? (existing ? readInventorySource(existing.capabilities) : null);
      const capabilities = mergeInventorySourceCapabilities(
        { ...persistedCapabilities, ...defaultCapabilities },
        inventorySourceToPersist ?? undefined,
      );
      await tx.service_skus.upsert({
        where: { siteId_code: { siteId: normalizedSiteId, code: sku.code } },
        create: { siteId: normalizedSiteId, ...sku, capabilities },
        update: {
          name: sku.name,
          description: sku.description,
          capabilities,
          contractVersion: sku.contractVersion,
          isActive: sku.isActive,
          isVisible: sku.isVisible,
          sortOrder: sku.sortOrder,
        },
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { upserted: DEFAULT_LINE_SKUS.length, codes: DEFAULT_LINE_SKUS.map((sku) => sku.code) };
}

export async function setLineSkuInventorySource(input: {
  siteId: string;
  code: string;
  providerCode: string;
  providerResourceIds: string[];
}): Promise<{ updated: boolean }> {
  const siteId = requiredIdentifier(input.siteId, 'site_id_required');
  const code = requiredIdentifier(input.code, 'sku_code_required').toUpperCase();
  const inventorySource = normalizeInventorySource(input);
  return prisma.$transaction(async (tx) => {
    const sku = await tx.service_skus.findUnique({
      where: { siteId_code: { siteId, code } },
      select: { id: true, capabilities: true },
    });
    if (!sku) throw new Error(`SKU not found: ${code}`);
    if (!isJsonObject(sku.capabilities) || sku.capabilities['delivery'] !== 'dedicated-line') {
      throw new SkuInventorySourceValidationError('sku_not_dedicated_line');
    }
    const currentCapabilities = mergeInventorySourceCapabilities(sku.capabilities, undefined);
    if (sameInventorySource(readInventorySource(currentCapabilities), inventorySource)) {
      return { updated: false };
    }
    const result = await tx.service_skus.updateMany({
      where: { id: sku.id, capabilities: { equals: currentCapabilities } },
      data: { capabilities: mergeInventorySourceCapabilities(currentCapabilities, inventorySource) },
    });
    if (result.count !== 1) throw new Error('sku_capabilities_changed');
    return { updated: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredIdentifier(value: string, reasonKey: string): string {
  if (!value.trim()) throw new SkuInventorySourceValidationError(reasonKey);
  return value.trim();
}

function sameInventorySource(
  left: DedicatedLineInventorySource | null,
  right: DedicatedLineInventorySource,
): boolean {
  return left?.providerCode === right.providerCode
    && left.providerResourceIds.length === right.providerResourceIds.length
    && left.providerResourceIds.every((resourceId, index) => resourceId === right.providerResourceIds[index]);
}
