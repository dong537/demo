import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertSafeUrl } from '../../common/utils/ssrf';
import { fetchWithTimeout } from '../providers/provider-http';

export type MigrationSmokeResult = { verified: boolean; observedIp: string | null; observedCountry: string | null; latencyMs: number | null; stabilitySamples: number; failureCode: string | null; detail: Record<string, unknown> };

@Injectable()
export class MigrationSmokeAdapter {
  constructor(private readonly config: ConfigService, @Inject('MIGRATION_SMOKE_FETCH') private readonly fetchImpl: typeof fetch) {}

  async verify(hostname: string, port: number): Promise<MigrationSmokeResult> {
    const targetUrl = this.config.get('DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL');
    assertSafeUrl(targetUrl);
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(`${targetUrl}?hostname=${encodeURIComponent(hostname)}&port=${port}`, { headers: { accept: 'application/json' } }, this.config.get('DEDICATED_LINE_MIGRATION_SMOKE_TIMEOUT_MS'), this.fetchImpl);
      const latencyMs = Date.now() - started;
      if (!response.ok) return { verified: false, observedIp: null, observedCountry: null, latencyMs, stabilitySamples: 1, failureCode: `HTTP_${response.status}`, detail: { stage: 'protocol' } };
      const payload = await response.json() as Record<string, unknown>;
      const observedIp = typeof payload.ip === 'string' ? payload.ip : null;
      const observedCountry = typeof payload.country === 'string' ? payload.country : null;
      if (!observedIp || !observedCountry) return { verified: false, observedIp, observedCountry, latencyMs, stabilitySamples: 1, failureCode: 'TARGET_RESPONSE_INVALID', detail: { stage: 'protocol' } };
      return { verified: true, observedIp, observedCountry, latencyMs, stabilitySamples: 1, failureCode: null, detail: { stage: 'protocol' } };
    } catch {
      throw new AppError(ErrorCode.UPSTREAM_TIMEOUT, 'dedicated_line_migration_smoke_timeout', 504);
    }
  }
}
