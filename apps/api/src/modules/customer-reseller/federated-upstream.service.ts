import { Injectable } from '@nestjs/common';
import { decryptAesGcm, encryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ConfigService } from '../../common/config/config.service';
import { isUniqueConstraintError } from '../../common/errors/prisma-errors';
import { FederatedUpstreamAdapter } from './federated-upstream.adapter';
import {
  assertFederatedKind,
  credentialFingerprint,
  normalizeFederatedBaseUrl,
  normalizeFederatedCredentials,
  normalizeTimeoutMs,
} from './federated-upstream.domain';
import { decryptFederatedCredentials, FederatedConnectionDto, FederatedUpstreamRepository } from './federated-upstream.repository';

@Injectable()
export class FederatedUpstreamService {
  constructor(
    private readonly repo: FederatedUpstreamRepository,
    private readonly adapter: FederatedUpstreamAdapter,
    private readonly config: ConfigService,
  ) {}

  async list(siteId: string, tenantId: string, query: { page?: number; pageSize?: number }): Promise<unknown> {
    return this.repo.list(siteId, tenantId, query);
  }

  async create(input: {
    siteId: string;
    tenantId: string;
    kind: unknown;
    name: unknown;
    baseUrl: unknown;
    credentials: unknown;
    timeoutMs?: unknown;
  }): Promise<FederatedConnectionDto> {
    const kind = assertFederatedKind(input.kind);
    const name = requireName(input.name);
    const baseUrl = normalizeFederatedBaseUrl(input.baseUrl);
    const credentials = normalizeFederatedCredentials(kind, input.credentials);
    let created: { id: string };
    try {
      created = await this.repo.create({
        siteId: input.siteId,
        tenantId: input.tenantId,
        kind,
        name,
        baseUrl,
        credentialEncrypted: encryptAesGcm(JSON.stringify(credentials), this.config.get('APP_ENCRYPTION_KEY')),
        credentialFingerprint: credentialFingerprint(credentials),
        timeoutMs: normalizeTimeoutMs(input.timeoutMs),
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_name_taken', 409);
      }
      throw error;
    }
    return this.repo.findDtoForTenant(input.siteId, input.tenantId, created.id);
  }

  async update(siteId: string, tenantId: string, id: string, input: Record<string, unknown>): Promise<FederatedConnectionDto> {
    const current = await this.repo.findForTenant(siteId, tenantId, id);
    const kind = current.kind;
    if (input.kind !== undefined && assertFederatedKind(input.kind) !== current.kind) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_kind_immutable', 400);
    }
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = requireName(input.name);
    if (input.baseUrl !== undefined) data.baseUrl = normalizeFederatedBaseUrl(input.baseUrl);
    if (input.timeoutMs !== undefined) data.timeoutMs = normalizeTimeoutMs(input.timeoutMs);
    if (input.status !== undefined) {
      if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_status_invalid', 400);
      data.status = input.status;
    }
    if (input.credentials !== undefined) {
      const credentials = normalizeFederatedCredentials(kind, input.credentials);
      data.credentialEncrypted = encryptAesGcm(JSON.stringify(credentials), this.config.get('APP_ENCRYPTION_KEY'));
      data.credentialFingerprint = credentialFingerprint(credentials);
    }
    if (Object.keys(data).length === 0) throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_update_empty', 400);
    try {
      await this.repo.update(id, data as never);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_name_taken', 409);
      }
      throw error;
    }
    return this.repo.findDtoForTenant(siteId, tenantId, id);
  }

  async disable(siteId: string, tenantId: string, id: string): Promise<FederatedConnectionDto> {
    await this.repo.findForTenant(siteId, tenantId, id);
    await this.repo.update(id, { status: 'DISABLED' });
    return this.repo.findDtoForTenant(siteId, tenantId, id);
  }

  async scan(siteId: string, tenantId: string, id: string) {
    const row = await this.repo.findForTenant(siteId, tenantId, id);
    if (row.status !== 'ACTIVE') throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'federated_upstream_disabled', 503);
    const credentials = decryptFederatedCredentials(row, (value) => decryptAesGcm(value, this.config.get('APP_ENCRYPTION_KEY')));
    try {
      const result = await this.adapter.scan({ kind: row.kind, baseUrl: row.baseUrl, credentials, timeoutMs: row.timeoutMs, siteId });
      await this.repo.recordScan(row, result);
      return { connectionId: row.id, ...result };
    } catch (error: unknown) {
      const appError = error instanceof AppError ? error : new AppError(ErrorCode.UPSTREAM_ERROR, 'federated_upstream_error', 502, String(error));
      await this.repo.recordFailedScan(row, appError.reasonKey, appError.message);
      throw appError;
    }
  }
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 80) throw new AppError(ErrorCode.VALIDATION_ERROR, 'federated_upstream_name_invalid', 400);
  return value.trim();
}
