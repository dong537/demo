import { Injectable } from '@nestjs/common';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { ProvidersRepository, ProviderAccountRecord } from '../providers.repository';
import { ProviderRegistryService } from '../provider-registry.service';
import { ProviderAccountListItemDto } from '../dto';
import { requireProviderAdmin, deriveCapabilities } from '../admin-access';

/**
 * Lists provider accounts for the caller's site (PLATFORM_ADMIN only). The
 * response is a read model that excludes the encrypted credential; the secret
 * never leaves the backend. Capabilities are derived from the matching adapter.
 */
@Injectable()
export class ListProvidersUseCase {
  constructor(
    private readonly repo: ProvidersRepository,
    private readonly registry: ProviderRegistryService,
  ) {}

  async execute(ctx: AuthenticatedContext): Promise<ProviderAccountListItemDto[]> {
    requireProviderAdmin(ctx);
    const records = await this.repo.listForSite(ctx.siteId);
    return records.map((record) => this.toListItem(record));
  }

  private toListItem(record: ProviderAccountRecord): ProviderAccountListItemDto {
    const adapter = this.registry.getAdapter(record.providerCode);
    return {
      id: record.id,
      providerCode: record.providerCode,
      tenantId: record.tenantId,
      status: record.status,
      baseUrl: record.baseUrl,
      timeoutMs: record.timeoutMs,
      inventorySyncEnabled: record.inventorySyncEnabled,
      enabledCountryCodes: record.enabledCountryCodes,
      availableCountries: [],
      capabilities: deriveCapabilities(adapter, record.inventorySyncEnabled),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
