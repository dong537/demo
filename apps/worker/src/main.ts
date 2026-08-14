import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ConfigGuard,
  FulfillmentModule,
  FulfillmentRepository,
  FulfillStaticProxyUseCase,
  ProvidersRepository,
  ResourcesModule,
  SyncInventoryUseCase,
  DedicatedLineOrdersModule,
  DedicatedLineOrderRepository,
  ProcessDedicatedLineOrderUseCase,
  AlertsModule,
  BarkAlertOutboxRepository,
  ProcessBarkInventoryAlertUseCase,
  DedicatedLineProjectionsModule,
  DedicatedLineProjectionRepository,
  ProcessDedicatedLineProjectionUseCase,
  DedicatedLineHealthModule,
  ProcessControlNodeHealthUseCase,
  DedicatedLineMigrationsModule,
  DedicatedLineMigrationJobRepository,
  ProcessMigrationJobUseCase,
  env,
} from '@ipeasy/api/worker';
import { FulfillmentWorker } from './fulfillment-worker';
import { InventorySyncWorker } from './inventory-sync-worker';
import { DedicatedLineOrderWorker } from './dedicated-line-order-worker';
import { BarkOutboxWorker } from './bark-outbox-worker';
import { DedicatedLineProjectionWorker } from './dedicated-line-projection-worker';
import { randomUUID } from 'node:crypto';
import { DedicatedLineMigrationWorker } from './dedicated-line-migration-worker';

@Module({
  imports: [FulfillmentModule, ResourcesModule, DedicatedLineOrdersModule, DedicatedLineProjectionsModule, DedicatedLineHealthModule, DedicatedLineMigrationsModule, AlertsModule],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  ConfigGuard.verify();
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true });
  const worker = new FulfillmentWorker(
    app.get(FulfillmentRepository),
    app.get(FulfillStaticProxyUseCase),
    {
      executionEnabled: env.PROVIDER_FULFILLMENT_EXECUTION_ENABLED === 'true',
      batchSize: env.WORKER_FULFILLMENT_BATCH_SIZE,
    },
  );
  const inventoryWorker = new InventorySyncWorker(
    app.get(ProvidersRepository),
    app.get(SyncInventoryUseCase),
    { enabled: env.PROVIDER_INVENTORY_SYNC_ENABLED === 'true' },
  );
  const dedicatedLineOrderWorker = new DedicatedLineOrderWorker(
    app.get(DedicatedLineOrderRepository),
    app.get(ProcessDedicatedLineOrderUseCase),
    {
      executionEnabled: env.DEDICATED_LINE_ORDER_EXECUTION_ENABLED === 'true',
      batchSize: env.WORKER_DEDICATED_LINE_ORDER_BATCH_SIZE,
      workerId: `dedicated-line-${randomUUID()}`,
    },
  );
  const barkOutboxWorker = new BarkOutboxWorker(
    app.get(BarkAlertOutboxRepository),
    app.get(ProcessBarkInventoryAlertUseCase),
    {
      enabled: env.BARK_ALERTS_ENABLED === 'true',
      batchSize: env.WORKER_BARK_OUTBOX_BATCH_SIZE,
      workerId: `bark-${randomUUID()}`,
    },
  );
  const dedicatedLineProjectionWorker = new DedicatedLineProjectionWorker(
    app.get(DedicatedLineProjectionRepository),
    app.get(ProcessDedicatedLineProjectionUseCase),
    {
      enabled: env.DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED === 'true',
      batchSize: env.WORKER_DEDICATED_LINE_PROJECTION_BATCH_SIZE,
      workerId: `dedicated-line-projection-${randomUUID()}`,
    },
  );
  const dedicatedLineMigrationWorker = new DedicatedLineMigrationWorker(
    app.get(DedicatedLineMigrationJobRepository),
    app.get(ProcessMigrationJobUseCase),
    {
      enabled: env.DEDICATED_LINE_MIGRATION_EXECUTION_ENABLED === 'true',
      batchSize: env.WORKER_DEDICATED_LINE_MIGRATION_BATCH_SIZE,
      workerId: `dedicated-line-migration-${randomUUID()}`,
    },
  );
  const controlNodeHealth = app.get(ProcessControlNodeHealthUseCase);

  console.info(`Fulfillment worker started with interval ${env.WORKER_FULFILLMENT_POLL_INTERVAL_MS}ms`);
  console.info(`Inventory sync worker started with interval ${env.WORKER_INVENTORY_SYNC_INTERVAL_MS}ms`);
  console.info(`Dedicated-line order worker started with interval ${env.WORKER_DEDICATED_LINE_ORDER_POLL_INTERVAL_MS}ms`);
  console.info(`Bark outbox worker started with interval ${env.WORKER_BARK_OUTBOX_POLL_INTERVAL_MS}ms`);
  console.info(`Dedicated-line projection worker started with interval ${env.WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS}ms`);
  console.info(`Dedicated-line migration worker started with interval ${env.WORKER_DEDICATED_LINE_MIGRATION_POLL_INTERVAL_MS}ms`);
  console.info('Dedicated-line control-node health probe started');
  await worker.poll();
  await inventoryWorker.poll();
  await dedicatedLineOrderWorker.poll();
  await barkOutboxWorker.poll();
  await dedicatedLineProjectionWorker.poll();
  await dedicatedLineMigrationWorker.poll();
  if (env.DEDICATED_LINE_HEALTH_EXECUTION_ENABLED === 'true') await controlNodeHealth.execute();
  const timer = setInterval(() => {
    void worker.poll();
  }, env.WORKER_FULFILLMENT_POLL_INTERVAL_MS);
  const inventoryTimer = setInterval(() => {
    void inventoryWorker.poll();
  }, env.WORKER_INVENTORY_SYNC_INTERVAL_MS);
  const dedicatedLineOrderTimer = setInterval(() => {
    void dedicatedLineOrderWorker.poll();
  }, env.WORKER_DEDICATED_LINE_ORDER_POLL_INTERVAL_MS);
  const barkOutboxTimer = setInterval(() => {
    void barkOutboxWorker.poll();
  }, env.WORKER_BARK_OUTBOX_POLL_INTERVAL_MS);
  const dedicatedLineProjectionTimer = setInterval(() => {
    void dedicatedLineProjectionWorker.poll();
  }, env.WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS);
  const dedicatedLineMigrationTimer = setInterval(() => {
    void dedicatedLineMigrationWorker.poll();
  }, env.WORKER_DEDICATED_LINE_MIGRATION_POLL_INTERVAL_MS);
  const controlNodeHealthTimer = setInterval(() => { if (env.DEDICATED_LINE_HEALTH_EXECUTION_ENABLED === 'true') void controlNodeHealth.execute(); }, env.WORKER_DEDICATED_LINE_PROJECTION_POLL_INTERVAL_MS);

  const shutdown = async (): Promise<void> => {
    globalThis.clearInterval(timer);
    globalThis.clearInterval(inventoryTimer);
    globalThis.clearInterval(dedicatedLineOrderTimer);
    globalThis.clearInterval(barkOutboxTimer);
    globalThis.clearInterval(dedicatedLineProjectionTimer);
    globalThis.clearInterval(dedicatedLineMigrationTimer);
    globalThis.clearInterval(controlNodeHealthTimer);
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

void bootstrap();
