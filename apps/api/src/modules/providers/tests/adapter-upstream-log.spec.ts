import { afterEach, describe, expect, it, vi } from 'vitest';
import { NineEightFiveAdapter } from '../adapters/nine-eight-five.adapter';
import { ProviderRuntimeConfig } from '../provider.types';
import { CreateUpstreamLogInput, UpstreamLogRepository } from '../upstream-log.repository';

class InMemoryLogRepo {
  readonly logs: CreateUpstreamLogInput[] = [];

  async create(data: CreateUpstreamLogInput): Promise<void> {
    this.logs.push(data);
  }
}

function asRepo(repo: InMemoryLogRepo): UpstreamLogRepository {
  return repo as unknown as UpstreamLogRepository;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider adapter upstream request logging', () => {
  it('logs real health check request summaries without credential headers', async () => {
    const logRepo = new InMemoryLogRepo();
    const adapter = new NineEightFiveAdapter(asRepo(logRepo));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: 'success', data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await adapter.healthCheck(runtimeConfig());

    expect(result.healthy).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(logRepo.logs).toHaveLength(1);
    expect(logRepo.logs[0]).toMatchObject({
      siteId: 'site-provider-log',
      providerCode: 'NINE_EIGHT_FIVE',
      upstreamAccountId: 'provider-account-log',
      operation: 'healthCheck',
      status: 'SUCCESS',
      requestSummary: {
        method: 'POST',
        path: '/res_static/inventory',
        body: { static_proxy_type: 'premium' },
      },
    });
    expect(JSON.stringify(logRepo.logs[0])).not.toContain('plain-api-key');
  });
});

function runtimeConfig(): ProviderRuntimeConfig {
  return {
    code: 'NINE_EIGHT_FIVE',
    status: 'ACTIVE',
    siteId: 'site-provider-log',
    upstreamAccountId: 'provider-account-log',
    baseUrl: 'https://provider.example.com',
    timeoutMs: 1000,
    inventorySyncEnabled: true,
    enabledCountryCodes: [],
    credential: { apikey: 'plain-api-key' },
  };
}
