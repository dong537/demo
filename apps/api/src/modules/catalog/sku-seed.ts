export interface DefaultLineSku {
  code: string;
  name: string;
  description: string;
  isActive: true;
  isVisible: true;
  contractVersion: 1;
  sortOrder: number;
  capabilities: {
    delivery: 'dedicated-line';
    supportedProtocols: readonly ['VLESS', 'VMESS', 'MIXED'];
    supportsMultiNodePlacement: true;
  };
}

const BASE_CAPABILITIES: DefaultLineSku['capabilities'] = Object.freeze({
  delivery: 'dedicated-line',
  supportedProtocols: Object.freeze(['VLESS', 'VMESS', 'MIXED'] as const),
  supportsMultiNodePlacement: true,
});

export const DEFAULT_LINE_SKUS: readonly DefaultLineSku[] = Object.freeze([
  Object.freeze({
    code: 'SV',
    name: 'Short Video Dedicated Line',
    description: 'Dedicated line service for cross-border short video workloads.',
    isActive: true,
    isVisible: true,
    contractVersion: 1,
    sortOrder: 10,
    capabilities: BASE_CAPABILITIES,
  }),
  Object.freeze({
    code: 'ZB',
    name: 'Live Streaming Dedicated Line',
    description: 'Dedicated line service for cross-border live streaming workloads.',
    isActive: true,
    isVisible: true,
    contractVersion: 1,
    sortOrder: 20,
    capabilities: BASE_CAPABILITIES,
  }),
]);
