# Logging Guidelines

> How logging is done in this project.

---

## Overview

<!--
Document your project's logging conventions here.

Questions to answer:
- What logging library do you use?
- What are the log levels and when to use each?
- What should be logged?
- What should NOT be logged (PII, secrets)?
-->

(To be filled by the team)

---

## Log Levels

<!-- When to use each level: debug, info, warn, error -->

(To be filled by the team)

---

## Structured Logging

<!-- Log format, required fields -->

(To be filled by the team)

---

## What to Log

<!-- Important events to log -->

(To be filled by the team)

---

## What NOT to Log

<!-- Sensitive data, PII, secrets -->

(To be filled by the team)

## Scenario: Static Proxy Audit Logs

### 1. Scope / Trigger

- Trigger: backend code exports static proxies, renews a proxy, changes proxy auth, switches proxy IP, or adds a new customer-visible proxy delivery action.
- Applies to `ProxiesController`, `ProxyLifecycleService`, OpenAPI `/res_static/*` lifecycle endpoints, and any future batch proxy lifecycle use case.

### 2. Signatures

- DB table: `audit_logs(siteId, tenantId, actorType, actorId, targetType, targetId, action, reason, requestId, meta)`.
- Export action: `proxy.export`.
- Lifecycle success actions:
  - `proxy.renew.success`
  - `proxy.change_password.success`
  - `proxy.switch_ip.success`
- Lifecycle failure actions:
  - `proxy.renew.failed`
  - `proxy.change_password.failed`
  - `proxy.switch_ip.failed`

### 3. Contracts

- Lifecycle audit belongs in `ProxyLifecycleService` so UI API and `/res_static/*` OpenAPI paths cannot drift.
- Batch lifecycle endpoints must not write an aggregate batch audit row. They call the single-item lifecycle use cases, and those use cases own per-proxy success/failure audit rows.
- Export audit belongs at the response boundary after export lines are built, with `meta={ format, count }` only.
- Audit `targetType` for proxy operations is `proxy_instances`; `targetId` is the local `proxy_instances.id` when a specific proxy is known.
- Failure lifecycle audit must include stable `code`, `reasonKey`, and `httpStatus` when the error is an `AppError`, then rethrow the original business error if audit succeeds.
- Audit write failures must remain visible. Do not wrap audit writes in silent `catch`.
- Current `AuthenticatedContext` does not preserve apiKey id; until that changes, OpenAPI requests are audited against the resolved owner user.

### 4. Validation & Error Matrix

- Successful export -> `proxy.export`, `targetId=null`, meta has format/count and no proxy lines.
- Successful renew without returned proxy payload -> `proxy.renew.success`, `deliveryUpdated=false`.
- Successful change-password or switch-ip with returned proxy payload -> success action with `deliveryUpdated=true`.
- Missing upstream proxy id -> `proxy.<action>.failed`, reason `upstream_proxy_id_missing`, then `UNSUPPORTED_CAPABILITY` response.
- Adapter unsupported -> `proxy.<action>.failed`, reason `<action>_not_supported`, then `UNSUPPORTED_CAPABILITY` response.
- Proxy not found or owned by another user -> return `proxy_not_found`; do not write an audit row that could reveal another user's proxy id.

### 5. Good/Base/Bad Cases

- Good: `/api/proxies/:id/switch-ip` and `/res_static/switch_ip` both call the same use case and produce the same audit action.
- Good: export audit records `count: 12`, not the 12 proxy strings.
- Base: renew succeeds but upstream returns no delivery payload; audit still records success and no local proxy update is required.
- Bad: controller-level lifecycle audit only for `/api/proxies/*`, leaving `/res_static/*` unaudited.
- Bad: audit meta includes plaintext proxy password, full proxy export lines, provider credentials, `apikey`, or encrypted credential blobs.
- Bad: `catch {}` around audit writes; DB/audit failures must not disappear.

### 6. Tests Required

- Unit: `ProxiesController.export` calls audit with format/count and the audit call does not contain plaintext proxy passwords.
- Unit: `ProxyLifecycleService` writes success audit for renew, change-password, and switch-ip.
- Unit: `ProxyLifecycleService` writes failure audit for missing upstream proxy id and unsupported adapter capability.
- Unit: cross-user proxy access returns `proxy_not_found` and writes no audit row.
- Regression: tests assert plaintext changed passwords are not present in lifecycle audit meta.

### 7. Wrong vs Correct

#### Wrong

```ts
await prisma.audit_logs.create({
  data: { action: 'proxy.switch_ip', meta: { proxyLine: `${ip}:${port}:${user}:${password}` } },
});
```

This leaks customer proxy credentials into audit metadata.

#### Correct

```ts
await proxyAudit.recordLifecycle(ctx, proxy, 'switchIp', 'success', {
  deliveryUpdated: true,
});
```

The audit row identifies the action and target while keeping deliverable secrets out of logs.

## Scenario: Res Static Proxy Export Contract

### 1. Scope / Trigger

- Trigger: backend code adds or changes a 985Proxy-compatible static proxy export endpoint under `/res_static/*`.
- Applies to `ResStaticController`, `IpExportDto`, `ProxiesRepository.findByUserId`, `formatProxyExport`, and `ProxyAuditService.recordExport`.

### 2. Signatures

- API: `POST /res_static/ip_export`.
- Body: `{ format?: ProxyExportFormat; status?: ProxyStatus; country_code?: string; search?: string; from?: string; to?: string }`.
- Response data: `{ format: ProxyExportFormat; count: number; lines: string[] }`.
- Supported formats: `IP_PORT`, `IP_PORT_AUTH`, `AUTH_AT_IP_PORT`, `HTTP_URL`, `SOCKS5_URL`.

### 3. Contracts

- Export scope is always `ctx.ownerId + ctx.siteId + requireTenantId(ctx)`. The request body must not accept `userId`, `tenantId`, or `siteId`.
- Default `format` is `IP_PORT_AUTH`; default `status` is `ACTIVE`.
- `country_code` maps to repository `countryCode`; `from/to` map to `proxy_instances.expiresAt`.
- Passwords are decrypted only while building response `lines`; stored `proxy_instances.password` remains AES-GCM ciphertext.
- Export audit action is `proxy.export` with `meta={ format, count }` only. Audit metadata must not include plaintext passwords, full proxy lines, API keys, or provider credentials.
- Use a bounded page size for synchronous OpenAPI export until a dedicated async/file export path exists.

### 4. Validation & Error Matrix

- Missing `format` -> default `IP_PORT_AUTH`.
- Invalid `format` -> `VALIDATION_ERROR / proxy_export_format_invalid` before repository access.
- Invalid `from` -> `VALIDATION_ERROR / from_invalid`.
- Invalid `to` -> `VALIDATION_ERROR / to_invalid`.
- Missing tenant in user context -> `PERMISSION_DENIED / tenant_required`.
- DB outage/table missing -> propagate to global exception handling; do not return an empty export.

### 5. Good/Base/Bad Cases

- Good: API customer exports active HK proxies as HTTP URLs and audit records only `{ format: 'HTTP_URL', count: 3 }`.
- Good: search and expiry filters reuse repository proxy list semantics instead of building a second query contract.
- Base: no body returns active proxies in `IP:PORT:USERNAME:PASSWORD` format.
- Bad: audit meta stores `http://username:password@ip:port`.
- Bad: accepting `tenantId` from the body for export scoping.
- Bad: unbounded `findMany()` for a synchronous OpenAPI export endpoint.

### 6. Tests Required

- Unit: `ResStaticController.ipExport` asserts repository is called with current user/site/tenant and mapped filters.
- Unit: default body returns `IP_PORT_AUTH` active export.
- Unit: invalid format throws `VALIDATION_ERROR` before repository/audit calls.
- Unit: audit call contains `format/count` and does not contain plaintext proxy passwords or complete proxy lines.

### 7. Wrong vs Correct

#### Wrong

```ts
await audit.recordExport(ctx, { format, lines });
```

This leaks customer proxy credentials into audit storage.

#### Correct

```ts
await audit.recordExport(ctx, { format, count: lines.length });
```

The response may contain the requested export lines, but audit keeps only the non-secret summary.

## Scenario: Provider Upstream Request Logs

### 1. Scope / Trigger

- Trigger: code calls an external provider through `ProviderAdapter` (`IPIPD`, `NINE_EIGHT_FIVE`, `PR`, or `UPSTREAM_API`).
- Applies to provider health checks, inventory sync, static proxy purchase, and order query.

### 2. Signatures

- Runtime config: `ProviderRuntimeConfig` must carry `siteId?: string` and `upstreamAccountId?: string` when loaded from `provider_accounts` or `upstream_api_accounts`.
- Adapter helper: `recordUpstreamRequest({ logRepo, config, operation, requestSummary, run })`.
- DB table: `upstream_request_logs(siteId, providerCode, upstreamAccountId, operation, requestId, durationMs, status, errorCode, requestSummary, responseSummary)`.

### 3. Contracts

- `ProviderRegistryService.getConfig(providerCode, siteId?)` is the source of truth for native provider credentials. Pass `siteId` from use cases and CLI commands whenever the caller is site-scoped.
- Provider adapters log the real upstream HTTP request, not a business-level approximation from fulfillment or resource use cases.
- `requestSummary` may contain method, path, and request body shape. It must not include credential headers, signed headers, full PR URLs containing API keys, or plaintext proxy passwords.
- `UpstreamLogRepository` recursively redacts credential-like keys before writing JSON: `credential`, `credentialEncrypted`, `apiKey`/`apikey`, `appId`, `appSecret`, `authorization`, `token`, `username`, `password`, `secret`.
- Logging failure should be visible (`upstream_request_log_failed`) but must not hide the upstream call result.

### 4. Validation & Error Matrix

- Upstream success -> log `SUCCESS` with request and response summaries.
- Upstream timeout -> log `TIMEOUT` with `errorCode=UPSTREAM_TIMEOUT`, then propagate `AppError`.
- Upstream HTTP/envelope error -> log `ERROR` with provider error code, then propagate `AppError`.
- Missing/disabled provider account -> no upstream HTTP call; caller receives `UPSTREAM_DISABLED`.
- Missing `siteId` in config -> helper skips DB log; registry-loaded active configs must include `siteId`.

### 5. Good/Base/Bad Cases

- Good: `NineEightFiveAdapter.healthCheck()` logs `{ method: 'POST', path: '/res_static/ip_list', body: ... }` and keeps `apikey` only in the actual HTTP header.
- Good: `PrAdapter` logs `path: 'order/make'`, not the full URL containing the API key.
- Base: direct unit tests may instantiate adapters without a repository; logging is skipped.
- Bad: fulfillment use cases writing their own upstream log around `buyStaticProxy`; that duplicates and misrepresents the real HTTP request.
- Bad: broad `catch { return [] }` in inventory sync; upstream outages must fail loudly.

### 6. Tests Required

- Unit: adapter request logging writes one log entry for a successful health check and does not contain plaintext credentials.
- Unit: `buildBuyRequest` reconstructs provider request from `providerResourceId` when resource mappings exist.
- Integration: registry reads the site-specific `provider_accounts` row, decrypts credentials with `APP_ENCRYPTION_KEY`, and writes recursively redacted logs to Postgres.

### 7. Wrong vs Correct

#### Wrong

```ts
await registry.logUpstreamRequest({
  siteId: order.siteId,
  providerCode,
  operation: 'buyStaticProxy',
  requestSummary: { orderId: order.id },
});
```

## Scenario: Tenant-Scoped Native Provider Accounts

### 1. Scope / Trigger

- Trigger: code creates, updates, lists, disables, or reads native provider credentials from `provider_accounts`.
- Applies to tenant provider account APIs, `ProviderRegistryService`, fulfillment, proxy capability use cases, provider CLI scripts, OpenAPI export, and upstream request logs.

### 2. Signatures

- DB table: `provider_accounts(siteId, tenantId?, providerCode, status, credentialEncrypted, baseUrl, timeoutMs, inventorySyncEnabled)`.
- Tenant API:
  - `GET /api/tenants/:tenantId/provider-accounts`
  - `POST /api/tenants/:tenantId/provider-accounts`
  - `PUT /api/tenants/:tenantId/provider-accounts/:accountId`
  - `DELETE /api/tenants/:tenantId/provider-accounts/:accountId`
- Registry: `ProviderRegistryService.getConfig(providerCode, siteId?, tenantId?)`.
- Reseller-compatible upstream accounts stay in `upstream_api_accounts` and are read through `getConfigForUpstreamAccount(siteId, tenantId)`.

### 3. Contracts

- `provider_accounts.tenantId = null` means the site-global native provider account; non-null means a tenant override for that provider.
- Tenant provider account APIs only accept native provider codes: `IPIPD`, `NINE_EIGHT_FIVE`, and `PR`. `UPSTREAM_API` belongs to `upstream_api_accounts`.
- `TENANT_ADMIN` can only access `ctx.tenantId`; `PLATFORM_ADMIN` can manage any tenant inside `ctx.siteId`.
- API responses must never include `credentialEncrypted` or plaintext credential values.
- Create/update must encrypt plaintext credential with `APP_ENCRYPTION_KEY` before DB write and must validate `baseUrl` with SSRF protection.
- Registry selection for native providers is:
  1. latest tenant-scoped account for `(siteId, tenantId, providerCode)` if it exists and is `ACTIVE`;
  2. otherwise latest site-global account for `(siteId, tenantId=null, providerCode)`;
  3. if the selected account is missing or `DISABLED`, return a disabled runtime config without making upstream HTTP calls.
- Fulfillment and proxy capability use cases must pass the order/proxy `tenantId` into `getConfig`. Site-level CLI commands must explicitly query `tenantId: null`.

### 4. Validation & Error Matrix

- `USER` calling tenant provider account APIs -> `PERMISSION_DENIED / insufficient_permissions`.
- `TENANT_ADMIN` targeting another tenant -> `TENANT_SCOPE_VIOLATION / tenant_access_denied`.
- `PLATFORM_ADMIN` targeting a tenant outside `ctx.siteId` -> `NOT_FOUND / tenant_not_found`.
- `providerCode=UPSTREAM_API` -> `VALIDATION_ERROR / provider_code_invalid`.
- Unsafe or non-HTTPS `baseUrl` -> `VALIDATION_ERROR / unsafe_upstream_url`.
- Empty update body -> `VALIDATION_ERROR / provider_account_update_empty`.
- Missing account id inside the target tenant -> `NOT_FOUND / provider_account_not_found`.

### 5. Good/Base/Bad Cases

- Good: tenant admin rotates their `IPIPD` credential; API response returns account metadata only, audit meta omits credential.
- Good: fulfillment for a tenant order calls `getConfig(providerCode, order.siteId, order.tenantId)` and uses the tenant account before the site-global one.
- Base: tenant account is disabled and a site-global account exists; registry falls back to the site-global account.
- Bad: returning `credentialEncrypted` in a DTO or generated OpenAPI schema.
- Bad: provider CLI updates the newest `(siteId, providerCode)` row without `tenantId: null`, accidentally rotating a tenant account.

### 6. Tests Required

- Integration: tenant admin create/list returns no plaintext credential or `credentialEncrypted` and stores encrypted DB value.
- Integration: tenant admin cross-tenant denial and platform admin cross-site 404.
- Integration: platform admin update/delete writes audit logs under the target tenant and does not log credential.
- Integration: registry prefers tenant active account and falls back to site-global when tenant account is disabled.
- OpenAPI/contracts: export and regenerate after adding or changing tenant provider account DTOs.

### 7. Wrong vs Correct

#### Wrong

```ts
await registry.getConfig(providerCode, order.siteId);
```

This ignores the order's tenant override and may charge or fulfill through the wrong upstream account.

#### Correct

```ts
await registry.getConfig(providerCode, order.siteId, order.tenantId);
```

The registry owns native provider credential selection and applies tenant-first, site-global fallback semantics.

This is a fulfillment event, not the actual upstream HTTP request.

#### Correct

```ts
return recordUpstreamRequest({
  logRepo: this.upstreamLogRepo,
  config,
  operation: 'buyStaticProxy',
  requestSummary: { method: req.method, path: req.path, body: req.body },
  run: async () => ({ value: await callProvider(), responseSummary }),
});
```

## Scenario: Request ID Context Outside HTTP

### 1. Scope / Trigger

- Trigger: shared backend code needs `requestIdStorage` from HTTP handlers, provider adapters, worker use cases, or unit tests.

### 2. Signatures

- Source of truth: `common/logging/request-id.context.ts`.
- HTTP middleware: `common/logging/request-id.middleware.ts` imports and re-exports the context for backwards compatibility.
- Provider logging helper: reads `requestIdStorage.getStore() ?? randomUUID()`.

### 3. Contracts

- Non-HTTP modules must import `requestIdStorage` from `request-id.context`, not from the middleware file.
- Middleware owns Fastify request/response behavior only: create/read `x-request-id`, set response header, and run the async context.
- Worker/provider code may run without an HTTP request; logs must still get a generated request id instead of failing.

### 4. Validation & Error Matrix

- HTTP request with `x-request-id` -> response envelope/logs reuse it.
- Worker fulfillment attempt -> provider log uses generated UUID if no async context exists.
- Importing middleware from worker dependency graph -> avoid, because it drags HTTP types and middleware concerns into background code.

### 5. Good/Base/Bad Cases

- Good: provider-http imports `../../common/logging/request-id.context`.
- Base: old HTTP-only modules may temporarily import from middleware re-export.
- Bad: a background worker imports `request-id.middleware` only to access storage.

### 6. Tests Required

- Build/typecheck gates for API and worker.
- Provider upstream log tests should not require Fastify middleware to exist.

### 7. Wrong vs Correct

#### Wrong

```ts
import { requestIdStorage } from '../logging/request-id.middleware';
```

#### Correct

```ts
import { requestIdStorage } from '../logging/request-id.context';
```
