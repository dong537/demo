import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';
import { FederatedCredential, FederatedScanResult, FederatedUpstreamKind } from './federated-upstream.domain';

type ConnectionRow = Prisma.federated_upstream_connectionsGetPayload<{
  include: { scans: { orderBy: { capturedAt: 'desc' }; take: 1 } };
}>;

export type FederatedConnectionDto = {
  id: string;
  kind: FederatedUpstreamKind;
  name: string;
  baseUrl: string;
  status: string;
  timeoutMs: number;
  credentialConfigured: boolean;
  credentialFingerprint: string;
  lastScan: {
    status: string;
    capturedAt: Date;
    expiresAt: Date;
    errorCode: string | null;
    balanceAmount: string | null;
    balanceUnit: string | null;
    inventoryCount: number;
    priceCount: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class FederatedUpstreamRepository {
  async list(siteId: string, tenantId: string, query: PageQueryDto = {}): Promise<PageResult<FederatedConnectionDto>> {
    const { page, pageSize } = normalizePageQuery(query);
    const where = { siteId, tenantId };
    const [total, rows] = await Promise.all([
      prisma.federated_upstream_connections.count({ where }),
      prisma.federated_upstream_connections.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { scans: { orderBy: { capturedAt: 'desc' }, take: 1 } },
      }),
    ]);
    return { page, pageSize, total, items: rows.map(toConnectionDto) };
  }

  async findForTenant(siteId: string, tenantId: string, id: string): Promise<ConnectionRow> {
    const row = await prisma.federated_upstream_connections.findFirst({
      where: { id, siteId, tenantId },
      include: { scans: { orderBy: { capturedAt: 'desc' }, take: 1 } },
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'federated_upstream_not_found', 404);
    return row;
  }

  async findDtoForTenant(siteId: string, tenantId: string, id: string): Promise<FederatedConnectionDto> {
    return toConnectionDto(await this.findForTenant(siteId, tenantId, id));
  }

  async create(data: {
    siteId: string;
    tenantId: string;
    kind: FederatedUpstreamKind;
    name: string;
    baseUrl: string;
    credentialEncrypted: string;
    credentialFingerprint: string;
    timeoutMs: number;
  }) {
    return prisma.federated_upstream_connections.create({ data });
  }

  async update(id: string, data: Prisma.federated_upstream_connectionsUpdateInput) {
    return prisma.federated_upstream_connections.update({ where: { id }, data });
  }

  async recordScan(connection: ConnectionRow, result: FederatedScanResult): Promise<void> {
    await prisma.$transaction([
      prisma.federated_upstream_scans.create({
        data: {
          siteId: connection.siteId,
          tenantId: connection.tenantId,
          connectionId: connection.id,
          status: 'SUCCESS',
          balanceAmount: result.balanceAmount,
          balanceUnit: result.balanceUnit,
          inventory: result.inventory as Prisma.InputJsonValue,
          prices: result.prices as Prisma.InputJsonValue,
          capturedAt: result.capturedAt,
          expiresAt: result.expiresAt,
        },
      }),
      prisma.federated_upstream_connections.update({
        where: { id: connection.id },
        data: { lastScannedAt: result.capturedAt, lastScanStatus: 'SUCCESS', lastScanErrorCode: null },
      }),
    ]);
  }

  async recordFailedScan(connection: ConnectionRow, errorCode: string, detail: string): Promise<void> {
    const capturedAt = new Date();
    await prisma.$transaction([
      prisma.federated_upstream_scans.create({
        data: {
          siteId: connection.siteId,
          tenantId: connection.tenantId,
          connectionId: connection.id,
          status: 'FAILED',
          inventory: [],
          prices: [],
          errorCode,
          errorDetail: detail.slice(0, 500),
          capturedAt,
          expiresAt: capturedAt,
        },
      }),
      prisma.federated_upstream_connections.update({
        where: { id: connection.id },
        data: { lastScannedAt: capturedAt, lastScanStatus: 'FAILED', lastScanErrorCode: errorCode },
      }),
    ]);
  }
}

function toConnectionDto(row: ConnectionRow): FederatedConnectionDto {
  const scan = row.scans[0];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    status: row.status,
    timeoutMs: row.timeoutMs,
    credentialConfigured: row.credentialEncrypted.length > 0,
    credentialFingerprint: row.credentialFingerprint,
    lastScan: scan
      ? {
        status: scan.status,
        capturedAt: scan.capturedAt,
        expiresAt: scan.expiresAt,
        errorCode: scan.errorCode,
        balanceAmount: scan.balanceAmount?.toString() ?? null,
        balanceUnit: scan.balanceUnit,
        inventoryCount: Array.isArray(scan.inventory) ? scan.inventory.length : 0,
        priceCount: Array.isArray(scan.prices) ? scan.prices.length : 0,
      }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function decryptFederatedCredentials(row: { credentialEncrypted: string }, decrypt: (value: string) => string): FederatedCredential {
  try {
    return JSON.parse(decrypt(row.credentialEncrypted)) as FederatedCredential;
  } catch {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'credential_decrypt_failed', 500);
  }
}
