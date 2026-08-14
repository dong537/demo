# Error Handling

> How errors are handled in this project.

---

## Overview

Backend domain and infrastructure failures are represented with `AppError`.
Unexpected Prisma, provider, and runtime failures must propagate to the global
exception filter unless a use case can convert them into a more specific
business error without hiding the failure.

The platform is transaction-sensitive. Order creation, wallet movement,
fulfillment, refund, provider health, and inventory sync must fail loudly when
the real source of truth is unavailable. Returning an empty array, `synced: 0`,
or `healthy: true` after an upstream/DB failure is forbidden.

---

## Error Types

Use `AppError` with `ErrorCode` for expected business and upstream failures.
The stable client-facing fields are:

* `code`: machine-readable high-level category from `ErrorCode`.
* `reasonKey`: stable reason such as `inventory_empty`,
  `wallet_concurrent_update`, or `provider_disabled`.
* `httpStatus`: status selected by the throwing layer.
* optional message/details for operator diagnostics.

Prisma unique errors are mapped through `isUniqueConstraintError` only at the
use-case boundary that owns the idempotency contract. Do not match raw error
strings in controllers.

---

## Error Handling Patterns

Catch only when the current module owns a real state transition or typed result:

* Provider adapters catch transport/envelope failures and rethrow `AppError`
  with `UPSTREAM_ERROR`, `UPSTREAM_TIMEOUT`, or a provider-specific reason.
* `FulfillStaticProxyUseCase` catches provider failures because it owns retry,
  final failure, and refund state transitions. It must return a typed result:
  `NOOP`, `COMPLETED`, `RETRYING`, or `FAILED_REFUNDED`.
* Worker classes catch per-job/per-account failures only to log and continue
  the next item. They must not mark the failed item successful.
* Worker logs for caught `AppError`-like failures must preserve structured
  fields: `code`, `reasonKey`, `httpStatus`, and `details` when present. A
  plain message alone is not enough for fulfillment or inventory-sync audits.
* Repository methods do not catch DB failures to return default values.

If a catch block writes a compensating state such as a refund, that write and
the status/audit update must be in one transaction. If compensation cannot be
completed, let the error remain visible.

---

## API Error Responses

Controllers should throw `AppError` or let lower-layer `AppError`s propagate.
Controller code should not wrap known `reasonKey`s into generic messages.

Admin/provider operation surfaces must show the real backend reason for:

* disabled provider/account;
* missing or stale inventory;
* zero upstream inventory;
* upstream credential or tariff failure;
* wallet insufficient balance or concurrent update;
* idempotency conflict.

---

## Scenario: Global Exception Filter Response Compatibility

### 1. Scope / Trigger

- Trigger: `AppExceptionFilter` writes an HTTP error response after a Prisma,
  provider, auth, or runtime failure.
- Applies to `apps/api/src/common/errors/exception-filter.ts`, normal `/api/*`
  routes, and legacy `/res_static/*` routes.

### 2. Signatures

- Filter entry: `AppExceptionFilter.catch(exception, host)`
- HTTP response sinks may arrive as one of:
  - `status(statusCode).send(payload)`
  - `code(statusCode).send(payload)`
  - raw node response methods `statusCode`, `setHeader(name, value)`, `end(body)`

### 3. Contracts

- Normal API errors must keep the stable envelope
  `{ code, msg, data, requestId }`.
- `res_static` errors must keep `{ code, msg, data: null }` and must not add
  `requestId`.
- The filter must not assume `reply.status()` exists just because the app uses
  Fastify. It must try framework helpers first, then fall back to the raw
  response shape without throwing a second exception.
- If headers were already sent, the filter should stop instead of raising a new
  `INTERNAL_ERROR` while handling the original failure.

### 4. Validation & Error Matrix

- `AppError` + `status().send()` response -> use `httpStatus`, `reasonKey`,
  and stable envelope.
- `AppError` + `code().send()` response -> same envelope, no secondary throw.
- `AppError` + raw `statusCode/end` response -> same envelope serialized to
  JSON with `content-type: application/json; charset=utf-8`.
- Response already ended / headers already sent -> no second write attempt.

### 5. Good/Base/Bad Cases

- Good: database outage on `/api/sites/current` returns a platform JSON error
  body and keeps the backend process alive.
- Base: `/res_static/inventory` still returns `data: null` for upstream errors.
- Bad: exception filter assumes `reply.status` exists and crashes with
  `TypeError: reply.status is not a function`.

### 6. Tests Required

- `exception-filter.spec.ts` must cover the `code().send()` path and the raw
  node-response fallback path.
- `res-static-envelope.spec.ts` must stay green so the compatibility envelope
  contract does not drift.

### 7. Wrong vs Correct

#### Wrong

```ts
const reply = ctx.getResponse<FastifyReply>();
reply.status(status).send(body);
```

#### Correct

```ts
const reply = ctx.getResponse<unknown>();
sendJsonResponse(reply, status, body);
```

---

## Scenario: Provider Connectivity Probe Contract

### 1. Scope / Trigger

- Trigger: provider health checks and upstream account connectivity tests.
- Applies to `POST /api/providers/:id/health-check`,
  `POST /api/upstream-accounts/:id/test`, `HealthCheckProviderUseCase`, and
  `UpstreamAccountsController.test()`.

### 2. Signatures

- Provider health check input: `siteId`, `ownerType`, `ownerId`, `providerId`.
- Upstream account test input: `siteId`, `ownerType`, `ownerId`, `accountId`.
- Runtime config resolution:
  - `ProviderRegistryService.getConfigForProviderAccount(providerCode, siteId, accountId)`
  - `ProviderRegistryService.getConfigForUpstreamAccountById(siteId, accountId)`

### 3. Contracts

- Connectivity probes must resolve the effective runtime config through the
  registry and use the exact clicked account id. Controllers must not decrypt
  secrets inline when a registry seam already owns that responsibility.
- A `200 OK` response with a logical upstream failure envelope must still be
  reported as `reachable: false` / `healthy: false`.
- Probe results must preserve stable reason keys when the adapter provides
  them, instead of collapsing every failure into a generic reachability label.

### 4. Validation & Error Matrix

- Missing account for the current site -> `NOT_FOUND / provider_account_not_found`
  or `NOT_FOUND / account_not_found`.
- Disabled provider/account -> probe returns a handled failure result with
  `provider_disabled`.
- `200 OK` with `code != 0` in the upstream envelope -> unhealthy result with a
  stable reason key such as `price_missing`, `inventory_empty`, or
  `upstream_error`.
- Registry resolution failure -> handled probe failure; do not surface a 500 to
  the UI.

### 5. Good/Base/Bad Cases

- Good: clicking the exact row probes the exact account id that was clicked.
- Good: a logical upstream failure remains visible as an unhealthy probe result
  with a stable reason key.
- Bad: decrypting the upstream API key directly inside a controller and
  bypassing the registry seam.
- Bad: treating a non-zero upstream envelope as success because HTTP status is
  200.

### 6. Tests Required

- Provider health use-case unit test must assert registry lookup uses the exact
  `providerAccountId`.
- Upstream account controller unit test must assert
  `getConfigForUpstreamAccountById(siteId, accountId)` is used.
- Adapter unit test must assert a `200` response with a failure envelope still
  yields `healthy: false`.

### 7. Wrong vs Correct

#### Wrong

```ts
const apiKey = decryptAesGcm(account.apiKeyEncrypted, encKey);
return this.adapter.healthCheck({
  code: 'UPSTREAM_API',
  status: account.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
  credential: { apiKey },
  // ...
});
```

#### Correct

```ts
const runtimeConfig = await this.registry.getConfigForUpstreamAccountById(account.siteId, account.id);
return this.adapter.healthCheck(runtimeConfig);
```

---

## Common Mistakes

Forbidden mistakes:

* broad `catch` returning `[]`, `{ synced: 0 }`, or success text;
* health checks that call a non-authoritative endpoint and report reachable
  while the real sync/buy prerequisite is unavailable;
* swallowing fulfillment failure so the worker cannot log a typed outcome;
* treating provider `PENDING` as delivered;
* returning fake proxy rows or fake stock after upstream failure.

---

## Scenario: Static Proxy Quote Inventory Gate

### 1. Scope / Trigger

- Trigger: `/api/pricing/quote` evaluates a static proxy resource quote for a
  customer or order flow.
- Applies to `QuoteUseCase`, `ResourcesRepository.getLatestInventory()`, and
  `SyncInventoryUseCase.execute()`.

### 2. Signatures

- Quote input: `siteId`, `tenantId`, `userId`, `resourceId`, `durationDays`,
  `quantity`, `currency`.
- Inventory sync call: `SyncInventoryUseCase.execute(siteId, providerCode,
  tenantId)`.

### 3. Contracts

- A fresh inventory snapshot with `stock = 0` is a real out-of-stock state and
  must not trigger an upstream sync.
- Only a missing or stale snapshot may trigger one sync attempt before the
  quote is resolved.
- Managed static proxy providers (`PR`, `IPIPD`, `NINE_EIGHT_FIVE`) use the
  canonical public price path and do not fall back to legacy override rows.
- Managed static proxy quotes only support `CNY`; any other currency must fail
  with `CURRENCY_NOT_SUPPORTED / currency_not_supported` before inventory sync.

### 4. Validation & Error Matrix

- Fresh snapshot + `stock = 0` -> `UPSTREAM_OUT_OF_STOCK / out_of_stock`.
- Missing or stale snapshot + sync succeeds with fresh stock -> continue quote.
- Missing or stale snapshot + sync still missing/stale -> `UPSTREAM_ERROR /
  inventory_stale`.
- Managed provider + non-CNY currency -> `CURRENCY_NOT_SUPPORTED /
  currency_not_supported`.
- Native provider sync must ignore upstream rows outside the account's
  selected country set, then disable any previously synced resources outside
  that set so stale rows do not remain purchasable.
- IPIPD sync failures caused by pagination or country-code normalization are
  upstream data problems, not empty inventory success. A page that exists but
  is not fetched is a sync bug that later surfaces as `inventory_stale`.

### 5. Good/Base/Bad Cases

- Good: fresh zero stock returns a readable out-of-stock error with no
  upstream refresh.
- Base: stale inventory refreshes once, then uses the latest snapshot.
- Bad: re-syncing every zero-stock quote and turning ordinary sell-out into a
  slow upstream dependency.
- Bad: treating an upstream page boundary or alpha-2 country code as "no
  inventory" and silently dropping the resource.

### 6. Tests Required

- Quote unit tests: fresh zero inventory does not call `SyncInventoryUseCase`.
- Quote unit tests: managed provider CNY quote returns the canonical 39 CNY
  price and bypasses pricing rows.
- Quote unit tests: managed provider non-CNY quote returns
  `CURRENCY_NOT_SUPPORTED`.

### 7. Wrong vs Correct

#### Wrong

```ts
if (latest && !latest.isStale && latest.stock === 0) {
  await syncInventory.execute(siteId, providerCode, tenantId);
}
```

#### Correct

```ts
if (latest && !latest.isStale) return latest;
await syncInventory.execute(siteId, providerCode, tenantId);
```
