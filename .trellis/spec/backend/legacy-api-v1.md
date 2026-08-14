# Frozen Frontend Legacy API

## Scenario: Frozen May Frontend Compatibility

### 1. Scope / Trigger

- Trigger: the recovered May frontend is immutable and calls the hard-coded origin `https://backend-test-0dcb.up.railway.app/api/v1`.
- Applies to `apps/api/src/modules/api-v1-compat`, the raw `/api/v1` response/error boundary, the dedicated-line legacy database projection, and `infra/legacy-api-proxy`.
- The compatibility layer translates transport shapes only. Catalog, pricing, wallet debit, inventory reservation, placement, renewal, and Bark alert rules remain owned by their canonical use cases.
- `apps/web/**` and `frozen/frontend-railway-6f71aaa1/**` must remain byte-for-byte unchanged for this rollout.

### 2. Signatures

- Public unauthenticated:
  - `GET /api/v1/health`
  - `GET /api/v1/settings/capabilities`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/admin-login`
  - `POST /api/v1/auth/refresh`
- Authenticated:
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/users/profile`
- Customer dedicated-line:
  - `GET /api/v1/dedicated-skus`
  - `GET /api/v1/dedicated/locations`
  - `POST /api/v1/dedicated/preview`
  - `POST /api/v1/dedicated/purchase-v2`
  - `GET /api/v1/dedicated/my`
  - `POST /api/v1/dedicated/:legacyId/renew`
  - `POST /api/v1/dedicated/:legacyId/lock`
  - `GET /api/v1/dedicated/:legacyId/qrcode`
  - `PATCH /api/v1/dedicated/:legacyId/remark`
- Database migration: `20260815030000_add_legacy_dedicated_line_fields` adds `dedicated_lines.legacyId SERIAL UNIQUE` and nullable `legacyRemark`.
- Proxy runtime: `LEGACY_PROXY_TARGET=https://backend-production-43893.up.railway.app node infra/legacy-api-proxy/server.mjs`.

### 3. Contracts

- Environment:
  - `LEGACY_API_V1_ENABLED` defaults to `false` and must be exactly `true` to expose compatibility behavior.
  - `LEGACY_API_SITE_ID` is required when the compatibility API is enabled in production. Hostname inference and a default site are forbidden.
  - `LEGACY_PROXY_TARGET` is required by the old-host proxy and must use HTTPS in production.
- `/api/v1` successful responses are raw JSON, never the platform `{code,msg,data,requestId}` envelope.
- `/api/v1` errors are `{statusCode,message,errorCode,timestamp,path}`.
- Legacy login accepts `{email,password}` only. The configured site ID supplies tenant scope.
- Login returns `{access_token,refresh_token,user}`. Refresh tokens start with `rt_`, are stored only as SHA-256 hashes, rotate on refresh, and are rejected by bearer authentication.
- Dedicated preview delegates to `SkuQuoteUseCase` with authenticated `siteId`, `tenantId`, `userId`, `quantity=1`, and the wallet currency.
- Dedicated purchase delegates to `CreateDedicatedLineOrderUseCase`. It must not call a provider adapter directly or duplicate stock, pricing, wallet, placement, or Bark logic.
- SKU protocol values are lowercase (`vless`, `vmess`, `shadowsocks`, `socks5`, `http`) because the frozen frontend filters by lowercase values.
- Legacy line routes accept only the scoped numeric `legacyId`; UUID-to-number coercion is forbidden. Resolution always includes `siteId + tenantId + userId`.
- Provider/order/projection workers remain disabled during compatibility smoke checks. Enabling them is a separate production gate.

### 4. Validation & Error Matrix

- Compatibility disabled -> `404 NOT_FOUND`, `legacy_api_disabled`.
- Enabled without production site ID -> process configuration guard fails before listening.
- Invalid/expired/replayed refresh token -> `401 AUTH_REQUIRED`.
- `rt_` token used as bearer access token -> `401 AUTH_REQUIRED`, `refresh_token_not_allowed`.
- Missing buyer tenant -> `403 PERMISSION_DENIED`, `tenant_required`.
- Invalid country/protocol/duration/legacy ID -> `400 VALIDATION_ERROR`.
- No fresh dedicated inventory -> `422 UPSTREAM_OUT_OF_STOCK`; no order, debit, reservation, or provider job; one deduplicated Bark outbox event.
- Lock request while no canonical upstream lock use case exists -> `409 UNSUPPORTED_CAPABILITY`; never report a fake success.
- Ready line without a deliverable URI -> `422 DEDICATED_LINE_CONFIG_INVALID`.
- Proxy body over 2 MiB -> `413 request_body_too_large`; unavailable target -> `502 legacy_proxy_upstream_unavailable`.

### 5. Good/Base/Bad Cases

- Good: frozen frontend -> old backend hostname proxy -> current backend `/api/v1` adapter -> canonical use case -> PostgreSQL.
- Good: a missing fresh SK5 route creates only the inventory-low outbox event and returns a typed legacy error.
- Base: a newly reserved order returns `pending=true`; delivery workers stay disabled until external smoke tests pass.
- Bad: changing the frozen bundle API base URL or rebuilding the frontend to avoid the hard-coded hostname.
- Bad: implementing stock checks, prices, wallet debit, or provider ordering directly in the compatibility controller.
- Bad: allowing refresh tokens through `JwtStrategy`, guessing a site from the request host, or returning a successful lock response without a real control-plane operation.

### 6. Tests Required

- Unit: raw `/api/v1` success/error boundary, capability flags, lowercase SKU protocols, numeric line mapping, connection URI, refresh-token bearer rejection, controller quote/order delegation.
- Real PostgreSQL integration: login without `siteId`, hashed access/refresh sessions, refresh rotation/replay rejection, real catalog quote, and out-of-stock Bark behavior with zero external jobs.
- Migration: apply the full migration chain to an isolated PostgreSQL schema and verify `legacyId` generation.
- Proxy: preserve method, path, query, body, authorization, upstream status, and response headers; verify `/healthz`, 413, and 502 behavior.
- Production smoke: current backend `/health`, `/ready`, `/api/v1/health`, raw capabilities, legacy unauthenticated 401, old-host proxy health, CORS preflight from the frozen frontend origin, and frozen frontend login/catalog/preview.
- Static guard: `git diff --name-only -- apps/web frozen/frontend-railway-6f71aaa1` must be empty.

### 7. Wrong vs Correct

#### Wrong

```ts
const siteId = request.hostname === oldHost ? DEFAULT_SITE_ID : request.hostname;
const stock = await provider.getStock(body.country);
if (stock > 0) await provider.buy(body);
return { status: 'active' };
```

#### Correct

```ts
const siteId = config.get('LEGACY_API_SITE_ID');
const result = await createDedicatedLineOrder.execute(context, {
  skuCode,
  countryCode,
  quantity: 1,
  durationDays,
  currency: wallet.currency,
  idempotencyKey,
});
return { ...result, status: 'reserved', pending: true };
```
