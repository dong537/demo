import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import type { Prisma } from '@ipeasy/db';
import { UpstreamRequestStatus } from './provider.types';
import { PageQueryDto, PageResult, normalizePageQuery } from '../../common/pagination/pagination.dto';

const SENSITIVE_KEYS = new Set([
  'apikey',
  'appid',
  'appsecret',
  'authorization',
  'credential',
  'credentialencrypted',
  'password',
  'secret',
  'token',
  'username',
]);

export type JsonSummary = string | number | boolean | null | JsonSummary[] | { [key: string]: JsonSummary };

export interface CreateUpstreamLogInput {
  siteId: string;
  providerCode: string;
  upstreamAccountId?: string;
  operation: string;
  requestId: string;
  durationMs: number;
  status: UpstreamRequestStatus;
  errorCode?: string;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
}

export interface UpstreamLogListItem {
  id: string;
  siteId: string;
  providerCode: string;
  upstreamAccountId: string | null;
  operation: string;
  requestId: string;
  durationMs: number;
  status: UpstreamRequestStatus;
  errorCode: string | null;
  requestSummary: JsonSummary | null;
  responseSummary: JsonSummary | null;
  createdAt: Date;
}

export interface ListUpstreamLogsQuery extends PageQueryDto {
  providerCode?: string;
  status?: string;
}

export function redactSensitiveSummary(value: unknown): JsonSummary {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveSummary(item));
  }
  if (typeof value !== 'object') {
    return null;
  }

  const output: { [key: string]: JsonSummary } = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveSummary(item);
  }
  return output;
}

function jsonSummary(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  return value ? (redactSensitiveSummary(value) as Prisma.InputJsonValue) : undefined;
}

const UPSTREAM_REQUEST_STATUSES = new Set<UpstreamRequestStatus>(['SUCCESS', 'ERROR', 'TIMEOUT']);

@Injectable()
export class UpstreamLogRepository {
  async create(data: CreateUpstreamLogInput): Promise<void> {
    await prisma.upstream_request_logs.create({
      data: {
        siteId: data.siteId,
        providerCode: data.providerCode,
        upstreamAccountId: data.upstreamAccountId,
        operation: data.operation,
        requestId: data.requestId,
        durationMs: data.durationMs,
        status: data.status,
        errorCode: data.errorCode,
        requestSummary: jsonSummary(data.requestSummary),
        responseSummary: jsonSummary(data.responseSummary),
      },
    });
  }

  async listForSite(
    siteId: string,
    query: ListUpstreamLogsQuery,
  ): Promise<PageResult<UpstreamLogListItem>> {
    const { page, pageSize } = normalizePageQuery(query);

    const where: Prisma.upstream_request_logsWhereInput = { siteId };
    if (query.providerCode) where.providerCode = query.providerCode;
    if (query.status && UPSTREAM_REQUEST_STATUSES.has(query.status as UpstreamRequestStatus)) {
      where.status = query.status as UpstreamRequestStatus;
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      prisma.upstream_request_logs.count({ where }),
      prisma.upstream_request_logs.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        siteId: row.siteId,
        providerCode: row.providerCode,
        upstreamAccountId: row.upstreamAccountId,
        operation: row.operation,
        requestId: row.requestId,
        durationMs: row.durationMs,
        status: row.status,
        errorCode: row.errorCode,
        requestSummary: (row.requestSummary as JsonSummary | null) ?? null,
        responseSummary: (row.responseSummary as JsonSummary | null) ?? null,
        createdAt: row.createdAt,
      })),
    };
  }
}
