import { describe, expect, it } from 'vitest';
import {
  buildCreateNodeBody,
  buildCreatePolicyBody,
  parseRouteImportPayload,
} from './control-plane.feature';

describe('admin control plane request contracts', () => {
  it('normalizes node registration values without returning credentials', () => {
    expect(buildCreateNodeBody({
      code: ' hk-01 ',
      name: ' Hong Kong 01 ',
      regionCode: ' hk ',
      baseUrl: ' https://node.example.com ',
      nodeGroupId: 'group-1',
      apiToken: 'secret-token',
      capacityUnits: 50,
    })).toEqual({
      code: 'hk-01',
      name: 'Hong Kong 01',
      regionCode: 'HK',
      baseUrl: 'https://node.example.com',
      nodeGroupId: 'group-1',
      apiToken: 'secret-token',
      capacityUnits: 50,
    });
  });

  it('builds a bounded placement policy request', () => {
    expect(buildCreatePolicyBody({
      nodeGroupId: 'group-1',
      inboundProfileId: 'inbound-1',
      mode: 'HOT_STANDBY',
      targetReplicaCount: 2,
      minReadyReplicaCount: 1,
      maxUnitsPerNode: 100,
      allowedNodeIds: ['node-a', 'node-b'],
    })).toEqual({
      nodeGroupId: 'group-1',
      inboundProfileId: 'inbound-1',
      mode: 'HOT_STANDBY',
      targetReplicaCount: 2,
      minReadyReplicaCount: 1,
      maxUnitsPerNode: 100,
      priority: 100,
      allowedNodeIds: ['node-a', 'node-b'],
    });
  });

  it('accepts only JSON objects for route snapshots', () => {
    expect(parseRouteImportPayload('{"sourceName":"ny-panel","routes":[]}')).toEqual({
      sourceName: 'ny-panel',
      routes: [],
    });
    expect(() => parseRouteImportPayload('[]')).toThrow('route_import_payload_invalid');
    expect(() => parseRouteImportPayload('{')).toThrow();
  });
});
