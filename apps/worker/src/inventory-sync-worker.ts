import type { ProviderAccountSyncRecord, SyncInventorySummary } from '@ipeasy/api/worker';

export interface ProviderAccountSource {
  listInventorySyncEnabled(): Promise<ProviderAccountSyncRecord[]>;
}

export interface InventorySyncExecutor {
  execute(siteId: string, providerCode: ProviderAccountSyncRecord['providerCode'], tenantId?: string | null, accountId?: string | null): Promise<SyncInventorySummary>;
}

export interface InventorySyncWorkerOptions {
  enabled: boolean;
  logger?: InventorySyncWorkerLogger;
}

export interface InventorySyncWorkerLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const defaultLogger: InventorySyncWorkerLogger = {
  info(message, context) {
    console.info(formatWorkerLog(message, context));
  },
  error(message, context) {
    console.error(formatWorkerLog(message, context));
  },
};

export class InventorySyncWorker {
  private running = false;
  private disabledLogged = false;

  constructor(
    private readonly providers: ProviderAccountSource,
    private readonly syncInventory: InventorySyncExecutor,
    private readonly options: InventorySyncWorkerOptions,
  ) {}

  async poll(): Promise<number> {
    if (this.running) return 0;
    if (!this.options.enabled) {
      if (!this.disabledLogged) {
        this.logger.info('inventory_sync_worker_disabled');
        this.disabledLogged = true;
      }
      return 0;
    }
    this.running = true;
    let syncedAccounts = 0;
    try {
      const accounts = await this.providers.listInventorySyncEnabled();
      for (const account of accounts) {
        if (!shouldSyncAccount(account)) continue;
        try {
          const result = await this.syncInventory.execute(
            account.siteId,
            account.providerCode,
            account.tenantId,
            account.id,
          );
          syncedAccounts += 1;
          this.logger.info('inventory_sync_account_success', {
            accountId: account.id,
            siteId: account.siteId,
            tenantId: account.tenantId,
            providerCode: account.providerCode,
            attempted: result.attempted,
            created: result.created,
            updated: result.updated,
            synced: result.synced,
            failed: result.failed,
            countries: result.countries,
          });
        } catch (err: unknown) {
          this.logger.error('inventory_sync_account_failed', {
            accountId: account.id,
            siteId: account.siteId,
            tenantId: account.tenantId,
            providerCode: account.providerCode,
            ...errorContext(err),
          });
        }
      }
      return syncedAccounts;
    } finally {
      this.running = false;
    }
  }

  private get logger(): InventorySyncWorkerLogger {
    return this.options.logger ?? defaultLogger;
  }
}

function shouldSyncAccount(account: ProviderAccountSyncRecord): boolean {
  return account.status === 'ACTIVE' && account.inventorySyncEnabled;
}

function errorContext(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { error: String(err) };
  const record = err as Record<string, unknown>;
  return {
    error: err instanceof Error ? err.message : String(err),
    ...(typeof record['code'] === 'string' ? { code: record['code'] } : {}),
    ...(typeof record['reasonKey'] === 'string' ? { reasonKey: record['reasonKey'] } : {}),
    ...(typeof record['httpStatus'] === 'number' ? { httpStatus: record['httpStatus'] } : {}),
    ...(record['details'] !== undefined ? { details: record['details'] } : {}),
  };
}

function formatWorkerLog(message: string, context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return message;
  return `${message} ${JSON.stringify(context)}`;
}
