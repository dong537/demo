export type CompatSku = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  capabilities: Record<string, unknown>;
  contractVersion: number;
  isActive: boolean;
  isVisible: boolean;
};

export type CompatLine = {
  id: string;
  legacyId: number;
  status: string;
  countryCode: string;
  protocol: string;
  expiresAt: Date | null;
  clientEmail: string;
  client: { email: string; id?: string; user?: string; password?: string } | null;
  domains: Array<{ hostname: string; port: number; isPrimary: boolean }>;
  sku?: { code: string; name: string } | null;
  legacyRemark?: string | null;
};

export function toCapabilitiesResponse() {
  return {
    smtpConfigured: false,
    otpLoginEnabled: false,
    residentialUiEnabled: false,
    residentialPurchaseEnabled: false,
    dedicatedUiEnabled: true,
    dedicatedPurchaseEnabled: true,
    selfServiceRechargeEnabled: false,
  } as const;
}

export function toLegacySkuDto(sku: CompatSku) {
  return {
    id: sku.id,
    code: sku.code,
    name: sku.name,
    description: sku.description,
    protocols: readProtocols(sku.capabilities),
    capabilities: sku.capabilities,
    contractVersion: sku.contractVersion,
    isActive: sku.isActive,
    isVisible: sku.isVisible,
  };
}

export function toLegacyLineDto(line: CompatLine) {
  const connectionUri = makeConnectionUri(line);
  return {
    id: line.legacyId,
    proxyId: line.legacyId,
    proxyCode: line.clientEmail || `DL-${line.legacyId}`,
    orderNo: line.id,
    skuCode: line.sku?.code ?? '',
    skuName: line.sku?.name ?? line.sku?.code ?? '',
    plan: line.sku ? { code: line.sku.code, name: line.sku.name } : undefined,
    country: line.countryCode,
    protocol: line.protocol.toLowerCase(),
    status: toLegacyStatus(line.status),
    expiresAt: line.expiresAt,
    clientEmail: line.clientEmail,
    clientUuid: line.client?.id,
    clientPassword: line.client?.password,
    client: line.client,
    domains: line.domains,
    remark: line.legacyRemark ?? null,
    connectionUri,
    qrcodeData: connectionUri,
  };
}

function toLegacyStatus(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'active';
    case 'DEGRADED': return 'switching';
    case 'SUSPENDED':
    case 'EXPIRED':
    case 'CANCELLED': return 'disabled';
    case 'FAILED': return 'failed';
    case 'QUEUED':
    case 'PENDING_PAYMENT':
    case 'PROVISIONING': return 'pending_pool_wait';
    default: return status.toLowerCase();
  }
}

function makeConnectionUri(line: CompatLine): string {
  const domain = line.domains.find((item) => item.isPrimary) ?? line.domains[0];
  const client = line.client;
  if (!domain || !client) return '';
  if (client.user && client.password) {
    return `socks5://${encodeURIComponent(client.user)}:${encodeURIComponent(client.password)}@${domain.hostname}:${domain.port}`;
  }
  if (!client.id || !['VLESS', 'VMESS'].includes(line.protocol.toUpperCase())) return '';
  return `${line.protocol.toLowerCase()}://${client.id}@${domain.hostname}:${domain.port}?type=tcp#${encodeURIComponent(line.sku?.code ?? line.clientEmail)}`;
}

function readProtocols(capabilities: Record<string, unknown>): string[] {
  const value = capabilities['supportedProtocols'];
  return Array.isArray(value)
    ? value
      .filter((protocol): protocol is string => typeof protocol === 'string' && protocol.trim().length > 0)
      .map((protocol) => protocol.trim().toLowerCase())
    : [];
}
