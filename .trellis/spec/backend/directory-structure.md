# Directory Structure

> How backend code is organized in this project.

---

## Overview

<!--
Document your project's backend directory structure here.

Questions to answer:
- How are modules/packages organized?
- Where does business logic live?
- Where are API endpoints defined?
- How are utilities and helpers organized?
-->

(To be filled by the team)

---

## Directory Layout

```
<!-- Replace with your actual structure -->
src/
├── ...
└── ...
```

---

## Module Organization

<!-- How should new features/modules be organized? -->

(To be filled by the team)

---

## Naming Conventions

<!-- File and folder naming rules -->

(To be filled by the team)

---

## Examples

<!-- Link to well-organized modules as examples -->

(To be filled by the team)

## Scenario: Provider Adapter Module Ownership

### 1. Scope / Trigger

- Trigger: a backend module needs to call a `ProviderAdapter` directly or through `ProviderRegistryService`.
- Applies to native providers (`IPIPD`, `NINE_EIGHT_FIVE`, `PR`) and the reseller `UPSTREAM_API` adapter.

### 2. Signatures

- Owner module: `ProvidersModule`.
- Exported providers: `ProviderRegistryService`, `ProvidersRepository`, `UpstreamLogRepository`, `UpstreamApiAdapter`.
- Consumer modules import `ProvidersModule`; they must not re-declare provider adapters in their own `providers` arrays.

### 3. Contracts

- Provider adapters are constructed by `ProvidersModule` so their shared dependencies, especially `UpstreamLogRepository`, are resolved in one place.
- Consumer modules such as `ResourcesModule`, `FulfillmentModule`, `ProxiesModule`, and `UpstreamAccountsModule` import `ProvidersModule` and inject the exported provider they need.
- Consumer modules that need to project native provider resource saleability, such as tenant provider account management, reuse `ProvidersRepository` from `ProvidersModule` instead of duplicating provider-country and resource-saleability rules.
- Do not create a second adapter instance with `new UpstreamApiAdapter()` in production Nest modules; direct construction is only acceptable in pure unit tests where upstream logging is intentionally absent.

### 4. Validation & Error Matrix

- Missing `ProvidersModule` import in a consumer module -> Nest application creation fails with `UnknownDependenciesException`.
- Re-declaring an adapter in a consumer module without its dependencies -> OpenAPI export and app bootstrap fail before routes are available.
- Adapter constructed by `ProvidersModule` -> upstream request logging dependencies are available and site-scoped logs can be written.

### 5. Good/Base/Bad Cases

- Good: `UpstreamAccountsModule` imports `ProvidersModule` and injects `UpstreamApiAdapter`.
- Base: a provider adapter unit test calls `new UpstreamApiAdapter()` without a log repository, and logging is skipped by design.
- Bad: `providers: [UpstreamAccountsRepository, UpstreamApiAdapter]` inside `UpstreamAccountsModule`, which bypasses the module that owns adapter dependencies.

### 6. Tests Required

- Build gate: `pnpm --filter @ipeasy/api build` must create the Nest application successfully.
- OpenAPI gate: `pnpm --filter @ipeasy/api export:openapi` must run without a real database and without provider DI errors.

### 7. Wrong vs Correct

#### Wrong

```ts
@Module({
  providers: [UpstreamAccountsRepository, UpstreamApiAdapter],
})
export class UpstreamAccountsModule {}
```

## Scenario: Fulfillment Worker Boundary

### 1. Scope / Trigger

- Trigger: background workers need to process static proxy fulfillment jobs.

### 2. Signatures

- API package export: `@ipeasy/api/worker`.
- Exported symbols: `ConfigGuard`, `env`, `FulfillmentModule`, `FulfillmentRepository`, `FulfillStaticProxyUseCase`.
- Worker runtime: `apps/worker/src/main.ts`.
- Testable worker class: `apps/worker/src/fulfillment-worker.ts`.

### 3. Contracts

- Worker imports fulfillment dependencies through `@ipeasy/api/worker`; it must not duplicate Prisma fulfillment logic or hand-write wallet/refund behavior.
- `FulfillmentModule` should import `ProvidersModule` and provide only the repositories/use cases needed by fulfillment. It must not import customer Controller modules just to obtain a repository.
- `ProvidersModule` has HTTP controllers protected by auth guards and is also imported by `FulfillmentModule`; it must import `AuthModule` so a standalone worker application context can resolve `JwtStrategy`, `ApiKeyStrategy`, and guard dependencies.
- `apps/worker` is the only production worker runtime. Do not add `apps/api/src/worker-main.ts` or an API-package `worker:prod` script for fulfillment polling.
- `apps/worker` imports `../api/src` through `@ipeasy/api/worker`, so TypeScript computes a shared source root and emits the worker entry at `dist/worker/src/main.js`. Production start commands must point at that compiled path or explicitly change `rootDir`; do not assume `dist/main.js` exists after a clean build.
- Worker `main.ts` may validate env and create a Nest application context. Unit-testable polling logic must live in a side-effect-free module so tests do not parse runtime env.
- Worker polling must read `PROVIDER_FULFILLMENT_EXECUTION_ENABLED`, `WORKER_FULFILLMENT_BATCH_SIZE`, and `WORKER_FULFILLMENT_POLL_INTERVAL_MS` from the API worker export, not from hard-coded constants.
- `@ipeasy/api` package must expose a `./worker` subpath and a `typesVersions` mapping so the worker can typecheck under the current TypeScript `moduleResolution: "node"`.

### 4. Validation & Error Matrix

- Missing API worker export -> worker typecheck fails on `@ipeasy/api/worker`.
- Worker imports API `src/main.ts` or app module -> env/HTTP bootstrap side effects leak into worker/tests.
- Provider controllers without auth dependencies in the worker graph -> `Nest can't resolve dependencies of the AuthGuard (?, ApiKeyStrategy)` during worker startup.
- Worker execution disabled -> worker logs `fulfillment_worker_disabled` and does not scan queued jobs.
- Worker duplicates refund SQL -> violates ledger and audit source of truth.

### 5. Good/Base/Bad Cases

- Good: `new FulfillmentWorker(repo, useCase, { executionEnabled, batchSize }).poll()` delegates each queued job id.
- Good: `ProvidersModule` imports `AuthModule` once, so both the HTTP app and standalone worker context resolve provider controller guards consistently.
- Base: worker has no HTTP server and only creates a Nest application context.
- Bad: worker parses provider credentials, calls adapters, updates wallets, and writes proxies itself.
- Bad: API package starts a second fulfillment worker entrypoint.

### 6. Tests Required

- `pnpm --filter @ipeasy/worker typecheck`.
- `pnpm --filter @ipeasy/worker test` for poll delegation and no-overlap behavior.
- `pnpm --filter @ipeasy/api build` before worker build so `dist/worker.d.ts` exists.
- `pnpm --filter @ipeasy/worker build`.
- Clean-output gate: delete `apps/worker/dist`, run `pnpm --filter @ipeasy/worker build`, and assert `apps/worker/dist/worker/src/main.js` exists before deploying worker start-command changes.
- Smoke: create a standalone Nest application context from `FulfillmentModule` after provider module changes; it must not fail with guard dependency resolution errors.

### 7. Wrong vs Correct

#### Wrong

```ts
// apps/worker/src/main.ts
await tx.wallets.update(...);
await tx.proxy_instances.createMany(...);
```

#### Correct

```ts
const worker = new FulfillmentWorker(
  app.get(FulfillmentRepository),
  app.get(FulfillStaticProxyUseCase),
  { executionEnabled, batchSize },
);
await worker.poll();
```

## Scenario: Inventory Sync Worker Boundary

### 1. Scope / Trigger

- Trigger: background workers need to keep upstream inventory snapshots fresh for customer purchasing.
- Applies to `apps/worker/src/main.ts`, `apps/worker/src/inventory-sync-worker.ts`, `@ipeasy/api/worker`, `ResourcesModule`, `SyncInventoryUseCase`, and `ProvidersRepository`.

### 2. Signatures

- API package export: `@ipeasy/api/worker`.
- Exported symbols for inventory sync: `ResourcesModule`, `SyncInventoryUseCase`, `ProvidersRepository`, `ProviderAccountSyncRecord`.
- Worker runtime: `apps/worker/src/main.ts`.
- Testable worker class: `apps/worker/src/inventory-sync-worker.ts`.
- Environment:
  - `PROVIDER_INVENTORY_SYNC_ENABLED=true|false` (defaults to `true`; set `false` only to intentionally disable upstream inventory refresh)
  - `WORKER_INVENTORY_SYNC_INTERVAL_MS=<milliseconds>`
  - `DATABASE_INVENTORY_FRESHNESS_MS=<milliseconds>`

### 3. Contracts

- Worker imports inventory-sync dependencies through `@ipeasy/api/worker`; it must not duplicate provider credential selection, adapter calls, or inventory DB writes.
- `InventorySyncWorker` only queries non-secret provider account fields through `ProvidersRepository.listInventorySyncEnabled()`.
- Actual upstream calls and writes remain owned by `SyncInventoryUseCase`, which resolves runtime provider config by `accountId` and writes `platform_resources`, `inventory_snapshots`, and `resource_mappings`.
- The worker must continue syncing other provider accounts if one upstream account fails; each failure is logged with account id, site id, tenant id, provider code, and error message only.
- `ResourcesRepository` controls snapshot freshness TTL from `DATABASE_INVENTORY_FRESHNESS_MS`; synced snapshots should not hard-code the old 300 second TTL.
- Public resource lists must use the latest inventory snapshot and `isInventorySnapshotStale()` semantics before exposing a resource as buyable.
- `WORKER_INVENTORY_SYNC_INTERVAL_MS` must be lower than `DATABASE_INVENTORY_FRESHNESS_MS` in production so public buyable resources do not disappear between syncs. `ConfigGuard` must fail production startup when inventory sync is enabled and the interval is greater than or equal to the freshness TTL.
- `QuoteUseCase` is the purchase-time inventory freshness gate. If the latest snapshot is missing or stale, it must trigger one real `SyncInventoryUseCase.execute(siteId, providerCode, tenantId)` call, then re-read the latest snapshot. If the snapshot is still missing/stale or upstream sync fails, it must return a visible upstream error rather than treating stale inventory as buyable.

### 4. Validation & Error Matrix

- `PROVIDER_INVENTORY_SYNC_ENABLED=false` -> worker logs `inventory_sync_worker_disabled` and does not scan provider accounts.
- No provider accounts with `status=ACTIVE` and `inventorySyncEnabled=true` -> poll returns `0`, no fake inventory is written.
- A provider sync throws `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, or `UPSTREAM_DISABLED` -> worker logs `inventory_sync_account_failed` and continues to the next account.
- A provider sync succeeds -> worker logs `inventory_sync_account_success` with the synced row count.
- Snapshot age exceeds `DATABASE_INVENTORY_FRESHNESS_MS` -> public resource list and quote treat inventory as stale.

### 5. Good/Base/Bad Cases

- Good: `InventorySyncWorker` calls `syncInventory.execute(siteId, providerCode, tenantId, accountId)` for each enabled account.
- Good: `ProvidersRepository.listInventorySyncEnabled()` selects only id/site/tenant/provider/status/sync fields and never returns encrypted credentials.
- Base: inventory sync is disabled in local development, and manual admin sync still works through `POST /api/resources/sync-inventory`.
- Bad: worker reads `credentialEncrypted`, decrypts credentials, calls provider adapters directly, or inserts `inventory_snapshots` itself.
- Bad: public resources are filtered using any historical positive-stock snapshot instead of the latest snapshot freshness calculation.

### 6. Tests Required

- `pnpm --filter @ipeasy/worker test -- inventory-sync-worker main`.
- `pnpm --filter @ipeasy/worker typecheck`.
- `pnpm --filter @ipeasy/worker build`.
- Clean-output gate: delete `apps/worker/dist`, run `pnpm --filter @ipeasy/worker build`, and assert `apps/worker/dist/worker/src/main.js` exists before deploying worker start-command changes.
- `pnpm --filter @ipeasy/api test -- src/modules/resources/use-cases/sync-inventory.use-case.spec.ts src/modules/resources/tests/resources-domain.spec.ts`.
- `pnpm --filter @ipeasy/api typecheck`.
- `pnpm --filter @ipeasy/api build`.

### 7. Wrong vs Correct

#### Wrong

```ts
const account = await prisma.provider_accounts.findFirst();
const credential = decryptAesGcm(account.credentialEncrypted, key);
await prisma.inventory_snapshots.create({ data: fakeOrDirectProviderData });
```

This leaks provider credential ownership into the worker and bypasses the inventory use case.

#### Correct

```ts
const accounts = await providersRepository.listInventorySyncEnabled();
for (const account of accounts) {
  await syncInventory.execute(account.siteId, account.providerCode, account.tenantId, account.id);
}
```

The worker owns scheduling only; provider config, adapter behavior, and DB writes stay behind the existing backend use case.

#### Correct

```ts
@Module({
  imports: [ProvidersModule],
  providers: [UpstreamAccountsRepository],
})
export class UpstreamAccountsModule {}
```

#### Wrong

```ts
@Module({
  controllers: [ProvidersController],
  providers: [AuthGuard, ProviderRegistryService],
})
export class ProvidersModule {}
```

This leaves guard strategy dependencies outside the worker's standalone module graph.

#### Correct

```ts
@Module({
  imports: [AuthModule],
  controllers: [ProvidersController],
  providers: [ProviderRegistryService],
})
export class ProvidersModule {}
```
