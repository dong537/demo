import { describe, expect, it } from 'vitest';
import {
  mergeInventorySourceCapabilities,
  normalizeInventorySource,
  parseOptionalInventorySource,
  parseSeedLineSkuCliArgs,
  parseSetLineSkuInventorySourceCliArgs,
  readInventorySource,
} from './sku-inventory-source';

describe('dedicated-line SKU inventory source', () => {
  it('normalizes an explicit provider and resource mapping without inventing values', () => {
    expect(normalizeInventorySource({
      providerCode: ' nine_eight_five ',
      providerResourceIds: [' HK:premium ', 'TW:premium', 'HK:premium'],
    })).toEqual({
      providerCode: 'NINE_EIGHT_FIVE',
      providerResourceIds: ['HK:premium', 'TW:premium'],
    });
  });

  it('allows the default SKU seed to have no inventory source', () => {
    expect(parseOptionalInventorySource(undefined, undefined)).toBeNull();
    expect(mergeInventorySourceCapabilities({
      delivery: 'dedicated-line',
      supportedProtocols: ['VLESS'],
    }, undefined)).toEqual({
      delivery: 'dedicated-line',
      supportedProtocols: ['VLESS'],
    });
  });

  it.each([
    [undefined, ['HK:premium'], 'inventory_source_incomplete'],
    ['NINE_EIGHT_FIVE', undefined, 'inventory_source_incomplete'],
    ['', ['HK:premium'], 'provider_code_required'],
    ['NINE_EIGHT_FIVE', [], 'provider_resource_ids_required'],
    ['NINE_EIGHT_FIVE', [''], 'provider_resource_id_invalid'],
    ['NINE_EIGHT_FIVE', ['HK:premium', ''], 'provider_resource_id_invalid'],
    ['UPSTREAM_API', ['HK:premium'], 'provider_code_invalid'],
  ])('rejects incomplete or unsupported mapping (%s, %s)', (providerCode, providerResourceIds, reasonKey) => {
    expect(() => parseOptionalInventorySource(providerCode, providerResourceIds)).toThrow(reasonKey);
  });

  it('rejects malformed persisted mappings instead of silently preserving them', () => {
    expect(() => readInventorySource({ inventorySource: { providerCode: 'PR', providerResourceIds: [] } })).toThrow('provider_resource_ids_required');
    expect(() => readInventorySource({ inventorySource: { providerResourceIds: ['HK'] } })).toThrow('inventory_source_incomplete');
  });

  it('replaces only inventorySource while retaining other SKU capabilities', () => {
    expect(mergeInventorySourceCapabilities({
      delivery: 'dedicated-line',
      supportsMultiNodePlacement: true,
    }, {
      providerCode: 'PR',
      providerResourceIds: ['SG:6928'],
    })).toEqual({
      delivery: 'dedicated-line',
      supportsMultiNodePlacement: true,
      inventorySource: { providerCode: 'PR', providerResourceIds: ['SG:6928'] },
    });
  });

  it('parses seed and per-SKU commands without adding an implicit mapping', () => {
    expect(parseSeedLineSkuCliArgs(['--site', 'site-1'])).toEqual({
      siteId: 'site-1',
      inventorySource: undefined,
    });
    expect(parseSetLineSkuInventorySourceCliArgs([
      '--site', 'site-1',
      '--code', 'sv',
      '--provider-code', 'pr',
      '--provider-resource-ids', ' SG:6928,SG:6928 ',
    ])).toEqual({
      siteId: 'site-1',
      code: 'SV',
      providerCode: 'PR',
      providerResourceIds: ['SG:6928'],
    });
  });

  it.each([
    [['--site', 'site-1', '--unknown', 'value'], 'cli_argument_unknown'],
    [['site-1'], 'cli_argument_unexpected'],
    [['--site', 'site-1', '--site', 'site-2'], 'cli_argument_duplicate'],
    [['--site'], 'cli_argument_value_required'],
  ])('rejects invalid seed CLI arguments (%s)', (argv, reasonKey) => {
    expect(() => parseSeedLineSkuCliArgs(argv)).toThrow(reasonKey);
  });

  it('rejects a partially supplied seed mapping', () => {
    expect(() => parseSeedLineSkuCliArgs([
      '--site', 'site-1', '--provider-code', 'PR',
    ])).toThrow('inventory_source_incomplete');
  });
});
