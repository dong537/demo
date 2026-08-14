import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from './env.schema';
import { ConfigGuard } from './config-guard';

vi.mock('./env.schema', () => ({
  env: {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@example.com/db',
    REDIS_URL: 'redis://example.com:6379',
    APP_ENCRYPTION_KEY: '01'.repeat(32),
    JWT_SECRET: 'jwt-secret-with-length',
    RELEASE_GIT_SHA: 'a'.repeat(40),
    PROVIDER_FULFILLMENT_EXECUTION_ENABLED: 'false',
    PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST: '',
    PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST: '',
    DEDICATED_LINE_ORDER_EXECUTION_ENABLED: 'false',
    DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST: '',
    DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST: '',
    DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED: 'false',
    DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED: 'false',
    DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL: 'http://127.0.0.1:18080/health',
    BARK_ALERTS_ENABLED: 'false',
    BARK_DEVICE_KEYS: '',
    PROVIDER_INVENTORY_SYNC_ENABLED: 'true',
    DATABASE_INVENTORY_FRESHNESS_MS: 3_600_000,
    WORKER_INVENTORY_SYNC_INTERVAL_MS: 300_000,
  },
}));

describe('ConfigGuard', () => {
  beforeEach(() => {
    env.NODE_ENV = 'production';
    env.DATABASE_URL = 'postgresql://user:pass@example.com/db';
    env.REDIS_URL = 'redis://example.com:6379';
    env.APP_ENCRYPTION_KEY = '01'.repeat(32);
    env.JWT_SECRET = 'jwt-secret-with-length';
    env.RELEASE_GIT_SHA = 'a'.repeat(40);
    env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED = 'false';
    env.PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST = '';
    env.PROVIDER_FULFILLMENT_UPSTREAM_ACCOUNT_ALLOWLIST = '';
    env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED = 'false';
    env.DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST = '';
    env.DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST = '';
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'false';
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'false';
    env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL = 'http://127.0.0.1:18080/health';
    env.BARK_ALERTS_ENABLED = 'false';
    env.BARK_DEVICE_KEYS = '';
    env.PROVIDER_INVENTORY_SYNC_ENABLED = 'true';
    env.DATABASE_INVENTORY_FRESHNESS_MS = 3_600_000;
    env.WORKER_INVENTORY_SYNC_INTERVAL_MS = 300_000;
    vi.restoreAllMocks();
  });

  it('allows production startup when provider fulfillment execution is disabled', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fails production startup when provider fulfillment is enabled without allowlists', () => {
    env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED = 'true';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Provider fulfillment execution requires at least one allowlist');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('allows production startup when provider fulfillment is enabled with an allowlist', () => {
    env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED = 'true';
    env.PROVIDER_FULFILLMENT_PROVIDER_ALLOWLIST = 'IPIPD';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    ConfigGuard.verify();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails production startup without an immutable release commit', () => {
    env.RELEASE_GIT_SHA = '';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] RELEASE_GIT_SHA must be a full Git commit SHA');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when dedicated-line ordering is enabled without allowlists', () => {
    env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED = 'true';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line order execution requires at least one allowlist');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('fails production startup when dedicated-line ordering is enabled without projection execution', () => {
    enableDedicatedLineOrderExecution();
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'false';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ConfigGuard] Dedicated-line order execution requires projection execution, provider inventory sync, and Bark alerts',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when dedicated-line ordering is enabled without provider inventory sync', () => {
    enableDedicatedLineOrderExecution();
    env.PROVIDER_INVENTORY_SYNC_ENABLED = 'false';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ConfigGuard] Dedicated-line order execution requires projection execution, provider inventory sync, and Bark alerts',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when dedicated-line ordering is enabled without Bark alerts', () => {
    enableDedicatedLineOrderExecution();
    env.BARK_ALERTS_ENABLED = 'false';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ConfigGuard] Dedicated-line order execution requires projection execution, provider inventory sync, and Bark alerts',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('allows production startup when dedicated-line ordering and all required execution paths are enabled', () => {
    enableDedicatedLineOrderExecution();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails production startup when inventory sync interval reaches the snapshot freshness ttl', () => {
    env.PROVIDER_INVENTORY_SYNC_ENABLED = 'true';
    env.DATABASE_INVENTORY_FRESHNESS_MS = 300_000;
    env.WORKER_INVENTORY_SYNC_INTERVAL_MS = 300_000;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Inventory sync interval must be lower than inventory freshness TTL');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when Bark alerts are enabled without a device key', () => {
    env.BARK_ALERTS_ENABLED = 'true';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Bark alerts require at least one device key');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('allows production startup with a long inventory interval when inventory sync is disabled', () => {
    env.PROVIDER_INVENTORY_SYNC_ENABLED = 'false';
    env.DATABASE_INVENTORY_FRESHNESS_MS = 300_000;
    env.WORKER_INVENTORY_SYNC_INTERVAL_MS = 300_000;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    ConfigGuard.verify();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('fails production startup when migration execution is enabled without projection execution', () => {
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL = 'https://smoke.example.com/verify';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line migration execution requires projection execution');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when migration execution uses a loopback smoke runner', () => {
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'true';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line migration execution requires an HTTPS non-loopback smoke runner');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup for any address in the IPv4 loopback range', () => {
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL = 'https://127.0.0.2/verify';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line migration execution requires an HTTPS non-loopback smoke runner');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup for an IPv4-mapped IPv6 loopback address', () => {
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL = 'https://[::ffff:127.0.0.1]/verify';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line migration execution requires an HTTPS non-loopback smoke runner');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('fails production startup when migration execution uses public HTTP', () => {
    env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'true';
    env.DEDICATED_LINE_MIGRATION_SMOKE_TARGET_URL = 'http://smoke.example.com/verify';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    ConfigGuard.verify();

    expect(errorSpy).toHaveBeenCalledWith('[ConfigGuard] Dedicated-line migration execution requires an HTTPS non-loopback smoke runner');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

function enableDedicatedLineOrderExecution(): void {
  env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED = 'true';
  env.DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST = 'IPIPD';
  env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED = 'true';
  env.PROVIDER_INVENTORY_SYNC_ENABLED = 'true';
  env.BARK_ALERTS_ENABLED = 'true';
  env.BARK_DEVICE_KEYS = 'test-device-key';
}
