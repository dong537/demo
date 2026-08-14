import type { Prisma } from '@ipeasy/db/generated/client';
import {
  isNativeProviderCode,
  type NativeProviderCode,
} from '../providers/provider-ops.validation';

export type DedicatedLineInventorySource = {
  providerCode: NativeProviderCode;
  providerResourceIds: string[];
};

export class SkuInventorySourceValidationError extends Error {
  constructor(readonly reasonKey: string) {
    super(reasonKey);
    this.name = 'SkuInventorySourceValidationError';
  }
}

export function normalizeInventorySource(input: {
  providerCode: unknown;
  providerResourceIds: unknown;
}): DedicatedLineInventorySource {
  if (input.providerCode === undefined || input.providerCode === null
    || input.providerResourceIds === undefined || input.providerResourceIds === null) {
    invalid('inventory_source_incomplete');
  }
  if (typeof input.providerCode !== 'string' || !input.providerCode.trim()) {
    invalid('provider_code_required');
  }
  const providerCode = input.providerCode.trim().toUpperCase();
  if (!isNativeProviderCode(providerCode)) invalid('provider_code_invalid');
  if (!Array.isArray(input.providerResourceIds)) invalid('provider_resource_ids_invalid');
  if (input.providerResourceIds.length === 0) invalid('provider_resource_ids_required');

  const resourceIds: string[] = [];
  for (const raw of input.providerResourceIds) {
    if (typeof raw !== 'string') invalid('provider_resource_id_invalid');
    const values = raw.split(',').map((value) => value.trim());
    if (values.length === 0 || values.some((value) => !value)) invalid('provider_resource_id_invalid');
    resourceIds.push(...values);
  }
  const providerResourceIds = [...new Set(resourceIds)];
  if (providerResourceIds.length === 0) invalid('provider_resource_ids_required');
  return { providerCode, providerResourceIds };
}

export function parseOptionalInventorySource(
  providerCode: unknown,
  providerResourceIds: unknown,
): DedicatedLineInventorySource | null {
  const providerMissing = providerCode === undefined || providerCode === null;
  const resourcesMissing = providerResourceIds === undefined || providerResourceIds === null;
  if (providerMissing && resourcesMissing) return null;
  if (providerMissing || resourcesMissing) invalid('inventory_source_incomplete');
  return normalizeInventorySource({ providerCode, providerResourceIds });
}

export function readInventorySource(capabilities: unknown): DedicatedLineInventorySource | null {
  if (!isJsonObject(capabilities)) invalid('sku_capabilities_invalid');
  if (capabilities['inventorySource'] === undefined) return null;
  const source = capabilities['inventorySource'];
  if (!isJsonObject(source)) invalid('inventory_source_invalid');
  return normalizeInventorySource({
    providerCode: source['providerCode'],
    providerResourceIds: source['providerResourceIds'],
  });
}

export function mergeInventorySourceCapabilities(
  capabilities: unknown,
  source: DedicatedLineInventorySource | undefined,
): Prisma.InputJsonObject {
  if (!isJsonObject(capabilities)) invalid('sku_capabilities_invalid');
  const base = toInputJsonObject(capabilities);
  if (source === undefined) return base;
  return { ...base, inventorySource: normalizeInventorySource(source) };
}

export function parseSeedLineSkuCliArgs(argv: string[]): {
  siteId: string;
  inventorySource: DedicatedLineInventorySource | undefined;
} {
  const values = parseStrictValueArgs(argv, new Set([
    'site',
    'provider-code',
    'provider-resource-ids',
  ]));
  const siteId = requireCliValue(values, 'site');
  const resources = values.get('provider-resource-ids');
  const inventorySource = parseOptionalInventorySource(
    values.get('provider-code'),
    resources === undefined ? undefined : [resources],
  );
  return { siteId, inventorySource: inventorySource ?? undefined };
}

export function parseSetLineSkuInventorySourceCliArgs(argv: string[]): {
  siteId: string;
  code: string;
  providerCode: NativeProviderCode;
  providerResourceIds: string[];
} {
  const values = parseStrictValueArgs(argv, new Set([
    'site',
    'code',
    'provider-code',
    'provider-resource-ids',
  ]));
  const inventorySource = normalizeInventorySource({
    providerCode: requireCliValue(values, 'provider-code'),
    providerResourceIds: [requireCliValue(values, 'provider-resource-ids')],
  });
  return {
    siteId: requireCliValue(values, 'site'),
    code: requireCliValue(values, 'code').toUpperCase(),
    ...inventorySource,
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) result[key] = toInputJsonValue(item);
  return result;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toInputJsonValue);
  if (isJsonObject(value)) return toInputJsonObject(value);
  invalid('sku_capabilities_invalid');
}

function parseStrictValueArgs(argv: string[], allowed: ReadonlySet<string>): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith('--')) invalid('cli_argument_unexpected');
    const key = token.slice(2);
    if (!allowed.has(key)) invalid('cli_argument_unknown');
    if (values.has(key)) invalid('cli_argument_duplicate');
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--') || !value.trim()) {
      invalid('cli_argument_value_required');
    }
    values.set(key, value.trim());
  }
  return values;
}

function requireCliValue(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) invalid(`${key.replaceAll('-', '_')}_required`);
  return value;
}

function invalid(reasonKey: string): never {
  throw new SkuInventorySourceValidationError(reasonKey);
}
