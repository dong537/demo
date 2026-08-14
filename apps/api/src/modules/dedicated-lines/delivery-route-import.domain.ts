import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type DeliveryRouteImportRoute = {
  sourceRouteId: string;
  dedicatedLineId: string;
  entranceGroupCode: string;
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
  listenPort: number;
  sourceVersion: string;
  validFrom: Date;
  validUntil: Date | null;
  domains: Array<{ hostname: string; port: number; isPrimary: boolean }>;
  targets: Array<{ nodeId: string; targetPort: number; targetVersion: string }>;
};

export type NormalizedDeliveryRouteImport = {
  sourceName: string;
  sourceVersion: string;
  capturedAt: Date;
  expiresAt: Date | null;
  routes: DeliveryRouteImportRoute[];
  sourceFingerprint: string;
};

export function normalizeDeliveryRouteImport(input: {
  sourceName: unknown;
  sourceVersion: unknown;
  capturedAt: unknown;
  expiresAt?: unknown;
  routes: unknown;
  allowCanaryDomains?: boolean;
}): NormalizedDeliveryRouteImport {
  const sourceName = requiredToken(input.sourceName, 'route_import_source_name_invalid');
  const sourceVersion = requiredToken(input.sourceVersion, 'route_import_source_version_invalid');
  const capturedAt = parseDate(input.capturedAt, 'route_import_captured_at_invalid');
  const expiresAt = input.expiresAt === undefined || input.expiresAt === null || input.expiresAt === ''
    ? null
    : parseDate(input.expiresAt, 'route_import_expires_at_invalid');
  if (!Array.isArray(input.routes) || input.routes.length === 0 || input.routes.length > 500) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_routes_invalid', 400);
  }
  const routes = input.routes.map((raw) => normalizeRoute(raw, input.allowCanaryDomains === true));
  const sourceRouteIds = new Set<string>();
  const lineIds = new Set<string>();
  for (const route of routes) {
    if (sourceRouteIds.has(route.sourceRouteId)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_source_route_duplicate', 400);
    if (lineIds.has(route.dedicatedLineId)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_line_duplicate', 400);
    sourceRouteIds.add(route.sourceRouteId);
    lineIds.add(route.dedicatedLineId);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ sourceName, sourceVersion, capturedAt, expiresAt, routes })).digest('hex');
  return { sourceName, sourceVersion, capturedAt, expiresAt, routes, sourceFingerprint: fingerprint };
}

function normalizeRoute(raw: unknown, allowCanaryDomains: boolean): DeliveryRouteImportRoute {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_route_invalid', 400);
  const value = raw as Record<string, unknown>;
  const domains = normalizeDomains(value['domains']);
  const targets = normalizeTargets(value['targets']);
  const primaryCount = domains.filter((domain) => domain.isPrimary).length;
  if ((!allowCanaryDomains && primaryCount !== 1) || (allowCanaryDomains && primaryCount > 1)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_primary_domain_invalid', 400);
  return {
    sourceRouteId: requiredToken(value['sourceRouteId'], 'route_import_source_route_id_invalid'),
    dedicatedLineId: requiredToken(value['dedicatedLineId'], 'route_import_line_id_invalid'),
    entranceGroupCode: requiredToken(value['entranceGroupCode'], 'route_import_entrance_group_invalid'),
    protocol: requiredProtocol(value['protocol']),
    listenPort: port(value['listenPort'], 'route_import_listen_port_invalid'),
    sourceVersion: requiredToken(value['sourceVersion'], 'route_import_route_version_invalid'),
    validFrom: parseDate(value['validFrom'], 'route_import_valid_from_invalid'),
    validUntil: value['validUntil'] === undefined || value['validUntil'] === null ? null : parseDate(value['validUntil'], 'route_import_valid_until_invalid'),
    domains,
    targets,
  };
}

function normalizeDomains(raw: unknown): Array<{ hostname: string; port: number; isPrimary: boolean }> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_domains_invalid', 400);
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_domain_invalid', 400);
    const value = item as Record<string, unknown>;
    const hostname = requiredToken(value['hostname'], 'route_import_hostname_invalid').toLowerCase();
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_hostname_invalid', 400);
    }
    const itemKey = `${hostname}:${port(value['port'], 'route_import_domain_port_invalid')}`;
    if (seen.has(itemKey)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_domain_duplicate', 400);
    seen.add(itemKey);
    return { hostname, port: Number(itemKey.split(':').pop()), isPrimary: value['isPrimary'] === true };
  });
}

function normalizeTargets(raw: unknown): Array<{ nodeId: string; targetPort: number; targetVersion: string }> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_targets_invalid', 400);
  const seen = new Set<string>();
  const seenNodes = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_invalid', 400);
    const value = item as Record<string, unknown>;
    const nodeId = requiredToken(value['nodeId'], 'route_import_target_node_invalid');
    if (seenNodes.has(nodeId)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_node_duplicate', 400);
    seenNodes.add(nodeId);
    const targetPort = port(value['targetPort'], 'route_import_target_port_invalid');
    const targetVersion = requiredToken(value['targetVersion'], 'route_import_target_version_invalid');
    const key = `${nodeId}:${targetPort}:${targetVersion}`;
    if (seen.has(key)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_target_duplicate', 400);
    seen.add(key);
    return { nodeId, targetPort, targetVersion };
  });
}

function requiredProtocol(value: unknown): 'VLESS' | 'VMESS' | 'MIXED' {
  const protocol = requiredToken(value, 'route_import_protocol_invalid');
  if (protocol !== 'VLESS' && protocol !== 'VMESS' && protocol !== 'MIXED') throw new AppError(ErrorCode.VALIDATION_ERROR, 'route_import_protocol_invalid', 400);
  return protocol;
}

function requiredToken(value: unknown, reasonKey: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256 || /[\r\n\t]/.test(value)) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value.trim();
}

function port(value: unknown, reasonKey: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return value as number;
}

function parseDate(value: unknown, reasonKey: string): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(ErrorCode.VALIDATION_ERROR, reasonKey, 400);
  return parsed;
}
