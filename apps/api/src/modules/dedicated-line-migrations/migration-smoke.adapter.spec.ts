import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../common/errors/error-codes';
import { MigrationSmokeAdapter } from './migration-smoke.adapter';

const config = {
  get(key: string) {
    if (key === 'DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL') return 'https://smoke.example.com/verify';
    if (key === 'DEDICATED_LINE_MIGRATION_SMOKE_TIMEOUT_MS') return 1_000;
    throw new Error(`unexpected_config:${key}`);
  },
};

describe('MigrationSmokeAdapter', () => {
  it('returns a deterministic protocol failure for an invalid JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{invalid', { status: 200 }));
    const adapter = new MigrationSmokeAdapter(config as never, fetchImpl as never);

    await expect(adapter.verify('line.example.com', 443)).resolves.toMatchObject({
      verified: false,
      failureCode: 'TARGET_RESPONSE_INVALID',
    });
  });

  it('classifies a network failure separately from a timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    const adapter = new MigrationSmokeAdapter(config as never, fetchImpl as never);

    await expect(adapter.verify('line.example.com', 443)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_ERROR,
      reasonKey: 'dedicated_line_migration_smoke_network_error',
    });
  });
});
