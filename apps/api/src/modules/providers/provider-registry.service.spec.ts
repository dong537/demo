import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@ipeasy/db';
import { ConfigService } from '../../common/config/config.service';
import { ProviderRegistryService } from './provider-registry.service';
import { CURRENT_PROVIDER_ACCOUNT_ORDER_BY, CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY } from './provider-account-order';
import { UpstreamLogRepository } from './upstream-log.repository';

vi.mock('@ipeasy/db', () => ({
  prisma: {
    provider_accounts: {
      findFirst: vi.fn(),
    },
    upstream_api_accounts: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../common/crypto/aes-gcm', () => ({
  decryptAesGcm: vi.fn((value: string) => value),
}));

describe('ProviderRegistryService account selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects native provider accounts by most recently saved order', async () => {
    vi.mocked(prisma.provider_accounts.findFirst).mockResolvedValue(providerAccountRow() as never);
    const registry = createRegistry();

    const result = await registry.getConfig('IPIPD', 'site-1', null);

    expect(prisma.provider_accounts.findFirst).toHaveBeenCalledWith({
      where: { providerCode: 'IPIPD', tenantId: null, siteId: 'site-1' },
      orderBy: CURRENT_PROVIDER_ACCOUNT_ORDER_BY,
    });
    expect(result).toMatchObject({
      code: 'IPIPD',
      status: 'ACTIVE',
      upstreamAccountId: 'pa-1',
      baseUrl: 'https://operator-switched-provider.example.com',
      credential: { appId: 'app-1', appSecret: 'secret-1' },
    });
  });

  it('selects upstream API accounts by most recently saved order', async () => {
    vi.mocked(prisma.upstream_api_accounts.findFirst).mockResolvedValue(upstreamAccountRow() as never);
    const registry = createRegistry();

    const result = await registry.getConfig('UPSTREAM_API', 'site-1', null);

    expect(prisma.upstream_api_accounts.findFirst).toHaveBeenCalledWith({
      where: { siteId: 'site-1', tenantId: null, status: 'ACTIVE' },
      orderBy: CURRENT_UPSTREAM_API_ACCOUNT_ORDER_BY,
    });
    expect(result).toMatchObject({
      code: 'UPSTREAM_API',
      status: 'ACTIVE',
      upstreamAccountId: 'ua-1',
      baseUrl: 'https://operator-switched-upstream.example.com',
      credential: { apiKey: 'upstream-key' },
    });
  });
});

function createRegistry(): ProviderRegistryService {
  return new ProviderRegistryService(
    { get: vi.fn(() => 'test-key') } as unknown as ConfigService,
    { create: vi.fn() } as unknown as UpstreamLogRepository,
    [],
  );
}

function providerAccountRow() {
  return {
    id: 'pa-1',
    siteId: 'site-1',
    tenantId: null,
    providerCode: 'IPIPD',
    status: 'ACTIVE',
    credentialEncrypted: JSON.stringify({ appId: 'app-1', appSecret: 'secret-1' }),
    baseUrl: 'https://operator-switched-provider.example.com',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
    enabledCountryCodes: ['GB'],
  };
}

function upstreamAccountRow() {
  return {
    id: 'ua-1',
    siteId: 'site-1',
    tenantId: null,
    status: 'ACTIVE',
    apiKeyEncrypted: 'upstream-key',
    baseUrl: 'https://operator-switched-upstream.example.com',
    timeoutMs: 15000,
    inventorySyncEnabled: true,
  };
}
