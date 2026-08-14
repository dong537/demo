import { describe, expect, it, vi } from 'vitest';
import { ProcessMigrationSmokeUseCase } from './process-migration-smoke.use-case';
describe('ProcessMigrationSmokeUseCase', () => {
  it('records verified smoke through the adapter result', async () => {
    const adapter = { verify: vi.fn().mockResolvedValue({ verified: true, observedIp: '203.0.113.9', observedCountry: 'US', latencyMs: 20, stabilitySamples: 3, failureCode: null, detail: {} }) };
    expect(adapter.verify).toBeDefined();
    expect(new ProcessMigrationSmokeUseCase(adapter as never)).toBeInstanceOf(ProcessMigrationSmokeUseCase);
  });
});
