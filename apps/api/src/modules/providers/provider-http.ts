import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requestIdStorage } from '../../common/logging/request-id.context';
import { ProviderRuntimeConfig, UpstreamRequestStatus } from './provider.types';
import { UpstreamLogRepository } from './upstream-log.repository';

export async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...opts, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'upstream_timeout', 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function assertProviderActive(config: ProviderRuntimeConfig): void {
  if (config.status === 'DISABLED') {
    throw new AppError(ErrorCode.UPSTREAM_DISABLED, 'provider_disabled', 503);
  }
}

export function upstreamUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

interface RecordUpstreamRequestInput<T> {
  logRepo?: UpstreamLogRepository;
  config: ProviderRuntimeConfig;
  operation: string;
  requestSummary?: Record<string, unknown>;
  run: () => Promise<{
    value: T;
    status?: UpstreamRequestStatus;
    errorCode?: string;
    responseSummary?: Record<string, unknown>;
  }>;
}

export async function recordUpstreamRequest<T>(input: RecordUpstreamRequestInput<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await input.run();
    await writeLog(input.logRepo, input.config, {
      operation: input.operation,
      durationMs: Date.now() - startedAt,
      status: result.status ?? 'SUCCESS',
      errorCode: result.errorCode,
      requestSummary: input.requestSummary,
      responseSummary: result.responseSummary,
    });
    return result.value;
  } catch (err: unknown) {
    await writeLog(input.logRepo, input.config, {
      operation: input.operation,
      durationMs: Date.now() - startedAt,
      status: statusFromError(err),
      errorCode: errorCodeFromError(err),
      requestSummary: input.requestSummary,
    });
    throw err;
  }
}

function statusFromError(err: unknown): UpstreamRequestStatus {
  if (err instanceof AppError && err.code === ErrorCode.UPSTREAM_TIMEOUT) return 'TIMEOUT';
  return 'ERROR';
}

function errorCodeFromError(err: unknown): string {
  if (err instanceof AppError) return err.code;
  return 'UPSTREAM_ERROR';
}

async function writeLog(
  logRepo: UpstreamLogRepository | undefined,
  config: ProviderRuntimeConfig,
  data: {
    operation: string;
    durationMs: number;
    status: UpstreamRequestStatus;
    errorCode?: string;
    requestSummary?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
  },
): Promise<void> {
  if (!logRepo || !config.siteId) return;
  try {
    await logRepo.create({
      siteId: config.siteId,
      providerCode: config.code,
      upstreamAccountId: config.upstreamAccountId,
      operation: data.operation,
      requestId: requestIdStorage.getStore() ?? randomUUID(),
      durationMs: data.durationMs,
      status: data.status,
      errorCode: data.errorCode,
      requestSummary: data.requestSummary,
      responseSummary: data.responseSummary,
    });
  } catch (err: unknown) {
    // Observability failures must be visible, but should not mask the upstream result.
    console.error('upstream_request_log_failed', err instanceof Error ? err.message : String(err));
  }
}
