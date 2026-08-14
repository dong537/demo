import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { decryptAesGcm } from '../../common/crypto/aes-gcm';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertSafeUrl } from '../../common/utils/ssrf';
import { fetchWithTimeout } from '../providers/provider-http';

export type ManagedLineProjectionNode = {
  baseUrl: string;
  apiCredentialCiphertext: string;
};

export type ManagedLineProjectionRequest = {
  desiredVersion: number;
  inboundTag: string;
  protocol: 'VLESS' | 'VMESS' | 'MIXED';
  client: { email: string; id?: string; flow?: string; user?: string; password?: string };
  egress: { host: string; port: number; username: string; password: string };
  lifecycle: {
    enabled: boolean;
    expiresAtMs: number;
    trafficLimitBytes: number;
    ipLimit: number;
    uplinkLimitBps: number;
    downlinkLimitBps: number;
    maxConnections: number;
  };
};

export type ManagedLineProjectionResponse = {
  projectionKey: string;
  desiredVersion: number;
  observedVersion: number;
  desiredHash: string;
  observedHash: string;
  inboundId: number;
  inboundTag: string;
  protocol: string;
  clientEmail: string;
  outboundTag: string;
  ruleTag: string;
  status: string;
  lastErrorCode?: string;
  lastErrorDetail?: string;
  lastAppliedAt: number;
  lastObservedAt: number;
};

type FetchLike = typeof fetch;

@Injectable()
export class ManagedLineProjectionAdapter {
  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async upsert(node: ManagedLineProjectionNode, projectionKey: string, request: ManagedLineProjectionRequest): Promise<ManagedLineProjectionResponse> {
    const response = await this.request(node, 'PUT', projectionKey, request);
    if (!response) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_response_invalid', 502);
    return response;
  }

  async get(node: ManagedLineProjectionNode, projectionKey: string): Promise<ManagedLineProjectionResponse> {
    const response = await this.request(node, 'GET', projectionKey);
    if (!response) throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_response_invalid', 502);
    return response;
  }

  async delete(node: ManagedLineProjectionNode, projectionKey: string, desiredVersion: number): Promise<void> {
    if (!Number.isInteger(desiredVersion) || desiredVersion < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'managed_line_desired_version_invalid', 400);
    }
    let deleteConflict: AppError | null = null;
    try {
      await this.request(node, 'DELETE', projectionKey, undefined, { desiredVersion: String(desiredVersion) });
    } catch (error: unknown) {
      if (isProjectionNotFound(error)) return;
      if (!isProjectionConflict(error)) throw error;
      deleteConflict = error;
    }
    try {
      const observed = await this.get(node, projectionKey);
      if (
        observed.status === 'DELETED'
        && observed.desiredVersion === desiredVersion
        && observed.observedVersion === desiredVersion
      ) return;
    } catch (error: unknown) {
      if (isProjectionNotFound(error)) {
        if (deleteConflict) throw deleteConflict;
        return;
      }
      throw error;
    }
    if (deleteConflict) throw deleteConflict;
    throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_projection_delete_not_confirmed', 502);
  }

  private async request(
    node: ManagedLineProjectionNode,
    method: 'GET' | 'PUT' | 'DELETE',
    projectionKey: string,
    body?: ManagedLineProjectionRequest,
    query?: Record<string, string>,
  ): Promise<ManagedLineProjectionResponse | undefined> {
    validateProjectionKey(projectionKey);
    const baseUrl = normalizeBaseUrl(node.baseUrl);
    assertSafeUrl(baseUrl);
    const token = this.decryptToken(node.apiCredentialCiphertext);
    const suffix = query ? `?${new URLSearchParams(query).toString()}` : '';
    const url = `${baseUrl}/panel/api/managed-line-projections/${encodeURIComponent(projectionKey)}${suffix}`;
    const timeoutMs = this.config.get('CONTROL_NODE_REQUEST_TIMEOUT_MS');
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, timeoutMs, this.fetchImpl);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_request_failed', 502);
    }
    if (!response.ok) throw mapRemoteError(response);
    if (method === 'DELETE' && response.status === 204) return undefined;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_response_invalid', 502);
    }
    if (!isProjectionResponse(payload)) {
      throw new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_response_invalid', 502);
    }
    return payload;
  }

  private decryptToken(ciphertext: string): string {
    if (!ciphertext.trim()) {
      throw new AppError(ErrorCode.CONTROL_NODE_CONFIG_INVALID, 'control_node_credential_missing', 500);
    }
    try {
      const token = decryptAesGcm(ciphertext, this.config.get('APP_ENCRYPTION_KEY')).trim();
      if (!token) throw new Error('empty_token');
      return token;
    } catch {
      throw new AppError(ErrorCode.CONTROL_NODE_CONFIG_INVALID, 'control_node_credential_invalid', 500);
    }
  }
}

function isProjectionNotFound(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCode.NOT_FOUND && error.reasonKey === 'managed_line_projection_not_found';
}

function isProjectionConflict(error: unknown): error is AppError {
  return error instanceof AppError && error.code === ErrorCode.IDEMPOTENCY_CONFLICT && error.reasonKey === 'managed_line_projection_conflict';
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new AppError(ErrorCode.CONTROL_NODE_CONFIG_INVALID, 'control_node_base_url_missing', 500);
  return trimmed;
}

function validateProjectionKey(value: string): void {
  if (value.length < 1 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'managed_line_projection_key_invalid', 400);
  }
}

function mapRemoteError(response: Response): AppError {
  switch (response.status) {
    case 404:
      return new AppError(ErrorCode.NOT_FOUND, 'managed_line_projection_not_found', 404);
    case 409:
      return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, 'managed_line_projection_conflict', 409);
    case 401:
    case 403:
      return new AppError(ErrorCode.UPSTREAM_DISABLED, 'managed_line_control_node_unauthorized', 502);
    case 408:
    case 429:
      return new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'managed_line_control_node_busy', 504);
    case 400:
    case 422:
      return new AppError(ErrorCode.VALIDATION_ERROR, 'managed_line_projection_request_invalid', 422);
    default:
      return new AppError(ErrorCode.UPSTREAM_ERROR, 'managed_line_control_node_error', 502);
  }
}

function isProjectionResponse(value: unknown): value is ManagedLineProjectionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['projectionKey'] === 'string'
    && Number.isInteger(record['desiredVersion'])
    && typeof record['status'] === 'string';
}
