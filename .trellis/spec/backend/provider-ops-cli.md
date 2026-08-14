# Provider Ops CLI Guidelines

## Scenario: Provider Ops CLI Secret And Tenant Boundary

### 1. Scope / Trigger

- Trigger: code adds or changes provider operations scripts that read/write `provider_accounts`, run health checks, sync inventory, or perform dry-run/real provider buys.
- Applies to `apps/api/scripts/provider-credential.ts`, `providers-health-check.ts`, `providers-sync-inventory.ts`, `providers-test-buy.ts`, and shared provider CLI validation helpers.

### 2. Signatures

- `pnpm --filter @ipeasy/api provider:set-credential -- --provider <IPIPD|NINE_EIGHT_FIVE|PR> --site <siteId> [--tenant <tenantId>] --base-url <httpsUrl> [--status ACTIVE|DISABLED] [--timeout-ms <ms>] [--inventory-sync]`
- Credential input source: `PROVIDER_CREDENTIAL_JSON` preferred, otherwise `--credential <json>`.
- `pnpm --filter @ipeasy/api providers:health-check -- [--provider <nativeProvider>] [--site <siteId>] [--tenant <tenantId>]`
- `pnpm --filter @ipeasy/api providers:sync-inventory -- --provider <nativeProvider> --site <siteId> [--tenant <tenantId>] [--account-id <providerAccountId>]`
- `pnpm --filter @ipeasy/api providers:test-buy -- --provider <nativeProvider> --site <siteId> [--tenant <tenantId>] --country <CC> [--currency <ISO3>] [--execute|--no-dry-run --confirm]`
- `pnpm --filter @ipeasy/api resources:apply-sale-policy -- --site <siteId> [--execute]`
- `pnpm --filter @ipeasy/api resources:replay-provider-country-selection -- --site <siteId> [--provider <nativeProvider>] [--execute]`

### 3. Contracts

- Provider ops CLI accepts native providers only: `IPIPD`, `NINE_EIGHT_FIVE`, and `PR`. `UPSTREAM_API` is not a native provider credential and must stay in `upstream_api_accounts`.
- `provider_accounts.tenantId = null` means site-global account. Non-null `tenantId` means tenant override. CLI must include the tenant value in all lookup/update paths when `--tenant` is provided.
- The table has an index, not a uniqueness constraint, for `(siteId, tenantId, providerCode)`. Runtime registry, CLI list/check behavior, and provider ops scripts must treat the most recently saved row (`updatedAt desc`, then `createdAt desc`) per `(siteId, tenantId, providerCode)` as the current account, so editing an older row can intentionally switch the active upstream supply chain without creating a new row.
- Credential JSON must be narrowed before encryption:
  - `IPIPD`: `{ "appId": "...", "appSecret": "..." }`
  - `NINE_EIGHT_FIVE`: `{ "apikey": "...", "zoneId": "..." }`; `zoneId` is optional but should be stored with the provider account when operators need to switch the 985 static zone/supply chain.
  - `PR`: `{ "apikey": "..." }` or `{ "username": "...", "password": "..." }`
- IPIPD sandbox accounts should store `--base-url https://api.sandbox.ipipd.cn`.
  Legacy `https://sandbox.ipipd.cn`, `https://sandbox.ipipd.cn/api`, and base
  URLs that already include `/openapi/v2` must normalize to the canonical
  sandbox API origin. The adapter sends requests to
  `https://api.sandbox.ipipd.cn/openapi/v2/...` while signing the canonical
  `/openapi/v2/...` URI. Do not store `/openapi/v2` itself in the base URL.
- `provider:set-credential` must encrypt with `APP_ENCRYPTION_KEY`, validate `--base-url` through the SSRF guard, and write an audit log without plaintext or ciphertext credentials.
- Health, sync, and buy CLIs must load runtime provider configuration through `ProviderRegistryService.getConfig(providerCode, siteId, tenantId?)`.
- Health-check must judge the effective runtime config returned by the registry, not only the raw row status. A disabled tenant account can fall back to an active site-global account.
- Inventory sync must delegate DB writes to `SyncInventoryUseCase`; scripts must not duplicate `platform_resources`, `inventory_snapshots`, or `resource_mappings` write logic. When `--account-id` is supplied, `providers:sync-inventory` must pass that exact provider account id to `SyncInventoryUseCase` so a switched supply chain can be verified without relying on implicit current-account ordering.
- `resources:apply-sale-policy` is the repair/ops script for existing resource rows and native provider account country coverage. It may update `provider_accounts.enabledCountryCodes`, resource saleability, and `price_overrides`, but the policy itself must live in `provider-saleability-policy.ts` so normal inventory sync and the repair script share the same source of truth.
- `resources:replay-provider-country-selection` is the repair/ops script for already-saved native provider country selections. It reads the most recently saved active site-global `provider_accounts.enabledCountryCodes` and projects that selection to same-site `platform_resources` through `ProvidersRepository.planEnabledCountrySelectionToResources()` / `applyEnabledCountrySelectionToResources()`. It must not update provider accounts, prices, inventory snapshots, mappings, credentials, or tenant-scoped provider accounts.
- `resources:replay-provider-country-selection` follows the same saleability contract as a live provider-account save: it may restore rows hidden by `provider_country_disabled` or `provider_country_not_supported`, but it must preserve operator-manually closed rows with `provider_sale_disabled`.
- `providers:test-buy` dry-run must use adapter `buildBuyRequest(input)` and must not call upstream. Real buy requires both an execution flag and `--confirm`.

### 4. Validation & Error Matrix

- `--provider UPSTREAM_API` -> `VALIDATION_ERROR / cli_invalid_argument`, exit `2`.
- Missing required CLI argument -> `VALIDATION_ERROR / cli_invalid_argument`, exit `2`.
- Unsafe/non-HTTPS `--base-url` -> `VALIDATION_ERROR / cli_invalid_argument`, exit `2`.
- Invalid credential shape -> `VALIDATION_ERROR / cli_invalid_argument`, exit `2`.
- Disabled provider or `inventorySyncEnabled=false` during sync -> fail loudly, no fake inventory.
- Upstream buy without `--confirm` -> dry-run refusal, no upstream call.
- Upstream/provider failure -> exit `1`; do not convert failure to empty rows or fake success.
- `resources:apply-sale-policy` without `--execute` -> dry-run only; no DB writes.
- `resources:replay-provider-country-selection` without `--execute` -> dry-run only; no DB writes.
- `resources:replay-provider-country-selection --tenant <tenantId>` -> `VALIDATION_ERROR / cli_invalid_argument`, because `platform_resources` is site-scoped and tenant provider selections must not be projected onto the whole site's customer catalog.

### 5. Good/Base/Bad Cases

- Good: `provider:set-credential --tenant tenant_a` updates only `(siteId, tenantId=tenant_a, providerCode)`.
- Good: health-check for a disabled tenant override reports the effective site-global account if registry fallback selects one.
- Good: dry-run prints provider/site/tenant/request preview with secret-like values redacted.
- Good: applying a new operator saleability policy updates synced historical rows through `resources:apply-sale-policy`, while future syncs use the same policy automatically.
- Good: replaying provider country selection restores historical resources hidden as `provider_country_disabled` or `provider_country_not_supported` when the active site-global provider account now enables their country and the operator saleability policy allows the concrete line.
- Good: replaying provider country selection leaves rows with `provider_sale_disabled` hidden so a repair run does not silently undo a manual operator close.
- Good: `resources:replay-provider-country-selection` prints resource/saleable/hidden/changed counts in dry-run and requires `--execute` before writing.
- Base: health-check with a site and no matching account prints disabled rows and exits successfully.
- Bad: updating newest `(siteId, providerCode)` without tenant filter, accidentally rotating a tenant credential.
- Bad: stopping health-check at `account.status === DISABLED` before calling the registry, which hides site-global fallback behavior.
- Bad: logging `credentialEncrypted`, plaintext API keys, PR full signed URLs, or proxy passwords.
- Bad: script writes inventory rows directly instead of calling `SyncInventoryUseCase`.
- Bad: hard-coding saleable country arrays in both seed scripts and sync code, causing existing rows and newly synced rows to diverge.
- Bad: using `resources:apply-sale-policy` to replay an operator's saved provider selection, because that script can overwrite `enabledCountryCodes` and price rows instead of preserving current management configuration.

### 6. Tests Required

- Unit: provider CLI validation narrows credential fields and rejects invalid JSON/shape as `cli_invalid_argument`.
- Unit: secret redaction covers `credential`, `credentialEncrypted`, `apiKey`/`apikey`, `appId`, `appSecret`, `authorization`, `token`, `username`, `password`, and `secret`.
- Unit: provider resource selection projection must cover historical `provider_country_not_supported` rows, preservation of `provider_sale_disabled`, and IPIPD resources without a `Recommended` marker.
- Type gate: because `apps/api/tsconfig.json` includes `src/**/*` only, provider scripts must be checked with a dedicated `tsc --noEmit` command that names the script entry files.
- Type gate: `resources:replay-provider-country-selection` must be checked with a dedicated `tsc --noEmit` command that names the script entry file.
- Integration with real Postgres when credentials are available: `provider:set-credential` stores encrypted credential, `ProviderRegistryService` decrypts it, and CLI audit rows omit secrets.

### 7. Wrong vs Correct

#### Wrong

```ts
await prisma.provider_accounts.findFirst({
  where: { siteId, providerCode },
});
```

This can rotate or read the wrong tenant account.

#### Correct

```ts
await registry.getConfig(providerCode, siteId, tenantId);
```

The registry owns tenant-first native provider credential selection and disabled-account behavior.

## Scenario: 985Proxy Static Zone Payload Contract

### 1. Scope / Trigger

- Trigger: code changes 985Proxy static proxy buy request construction, dry-run previews, or upstream fulfillment for `NINE_EIGHT_FIVE`.
- Applies to `NineEightFiveAdapter.buildBuyRequest`, `buyStaticProxy`, and `providers:test-buy` dry-run output.

### 2. Signatures

- Provider account credential key: optional `zoneId`.
- Legacy env fallback: `UPSTREAM_985PROXY_STATIC_ZONE=<zoneId>`.
- Buy preview: `pnpm --filter @ipeasy/api providers:test-buy -- --provider NINE_EIGHT_FIVE --site <siteId> --country <CC> [--business-type <CC:type>]`.
- Upstream endpoint: `POST /res_static/buy`.

### 3. Contracts

- The 985Proxy static buy payload must include `zone` when the selected provider account credential has `zoneId`; if the account has no `zoneId`, the adapter may fall back to `UPSTREAM_985PROXY_STATIC_ZONE` for existing deployments.
- `NineEightFiveAdapter.buildBuyRequest(input, config)` performs no network call, but may read non-secret routing options from the runtime config. Dry-run previews and real buys must use the same helper so request bodies cannot drift.
- `providerResourceId` or `businessType` can encode `<country>:<static_proxy_type>` such as `TW:premium`; `providerResourceId` wins when both are present.
- The official static buy body shape is:

```ts
{
  static_proxy_type: 'premium',
  time_period: input.durationDays,
  pay_type: 'balance',
  zone: config.credential.zoneId ?? process.env.UPSTREAM_985PROXY_STATIC_ZONE,
  buy_data: [{ country, city, count: input.quantity }],
}
```

### 4. Validation & Error Matrix

- Missing country after parsing input -> `VALIDATION_ERROR / nine_eight_five_requires_country`.
- Empty account `zoneId` and empty `UPSTREAM_985PROXY_STATIC_ZONE` -> omit `zone`; do not send an empty string.
- Upstream rejects the zone/country/stock -> preserve upstream failure, let fulfillment retry/refund; do not fake proxies or mark the order complete.

### 5. Good/Base/Bad Cases

- Good: dry-run for 985 passes the registry-loaded runtime config into `buildBuyRequest`, so it shows the same `zone` field the real worker buy will send.
- Good: editing only `zoneId` on an existing provider account merges with the existing encrypted `apikey` before saving.
- Good: tests clear `UPSTREAM_985PROXY_STATIC_ZONE` around unrelated payload assertions so local env cannot make unit tests flaky.
- Base: a provider account and env both have no zone in a non-985 dev setup; payload stays compatible by omitting `zone`.
- Bad: editing a partial credential patch such as `{ "zoneId": "new" }` by replacing the whole encrypted credential and losing the saved `apikey`.
- Bad: adding zone only to `providers:test-buy` output while `buyStaticProxy` sends a different body.

### 6. Tests Required

- Unit: 985 adapter payload uses provider account `zoneId` before the legacy environment zone.
- Unit: provider account update merges partial credential edits with the existing encrypted credential before saving.
- Unit: 985 adapter payload includes `zone` when only `UPSTREAM_985PROXY_STATIC_ZONE` is set.
- Unit: existing 985 payload tests must isolate `process.env.UPSTREAM_985PROXY_STATIC_ZONE`.
- Smoke: `providers:test-buy` dry-run for `NINE_EIGHT_FIVE` must print `zone` before enabling real fulfillment.

### 7. Wrong vs Correct

#### Wrong

```ts
const body = {
  static_proxy_type: proxyType,
  time_period: input.durationDays,
  pay_type: 'balance',
  buy_data: [{ country, city, count }],
};
```

This omits the operator-provided 985 static zone, so the upstream can reject otherwise valid static buys.

#### Correct

```ts
const zone = config.credential['zoneId']?.trim() || process.env['UPSTREAM_985PROXY_STATIC_ZONE']?.trim();
const body = {
  static_proxy_type: proxyType,
  time_period: input.durationDays,
  pay_type: 'balance',
  buy_data: [{ country, city, count }],
  ...(zone ? { zone } : {}),
};
```

## Scenario: Proxy-Seller SOCKS5 And Zipped Geo Contract

### 1. Scope / Trigger

- Trigger: code changes Proxy-Seller (`PR`) adapter HTTP transport, health checks, inventory sync, or live provider verification.
- Applies to `PrAdapter`, `providers:health-check`, and `providers:sync-inventory`.

### 2. Signatures

- Env key: `UPSTREAM_PROXY_SELLER_SOCKS5_URL=socks5h://<username>:<password>@<host>:<port>`.
- Health check: `pnpm --filter @ipeasy/api providers:health-check -- --provider PR --site <siteId>`.
- Inventory sync: `pnpm --filter @ipeasy/api providers:sync-inventory -- --provider PR --site <siteId>`.
- Upstream endpoints:
  - `GET /personal/api/v1/<apikey>/reference/list/resident`
  - `GET /personal/api/v1/<apikey>/resident/geo`
  - `POST /personal/api/v1/<apikey>/order/make`
  - `POST /personal/api/v1/<apikey>/resident/list/add`
  - `GET /personal/api/v1/<apikey>/resident/lists`

### 3. Contracts

- `UPSTREAM_PROXY_SELLER_SOCKS5_URL` is transport configuration, not provider credential JSON. Do not store it in `provider_accounts.credentialEncrypted`.
- The PR adapter must route all Proxy-Seller upstream HTTP calls through `SocksProxyAgent` when the env key is configured.
- Prefer `socks5h://` for Proxy-Seller because target DNS resolution can fail locally; `socks5h` delegates hostname resolution through the proxy.
- `reference/list/resident` is the PR health-check endpoint because it validates credentials and resident tariff availability without requiring an existing package.
- `resident/geo` can return a ZIP file whose first entry is `geo.json`; inventory sync must parse that ZIP response and then read the JSON array.
- `resident/geo` may return only country/region/city/ISP metadata such as `{ code, name, regions }` and no numeric stock field. Missing stock fields for PR are not a sync failure.
- `reference/list/resident` returns resident tariffs under `data.items.tarifs[]`; PR `order/make` requires a real `tarifId`, so inventory sync must not store the country code alone as `providerResourceId`.
- `resident/package` returns `Make order with resident first` when the account has no current resident package. Do not use it as the health-check or inventory source.
- PR fulfillment is two-step: call `order/make` with the selected `tarifId`, then call `resident/list/add` to create the export list and deliver `res.proxy-seller.com` ports.
- Because PR resident tariffs are traffic-package scoped rather than country scoped, PR inventory mappings encode `<countryCode>:<tarifId>` and `PrAdapter.buildBuyRequest` extracts only the tariff segment for `order/make`.
- PR inventory sync may write resources and snapshots with `stock=0` when upstream omits numeric stock. Quote and customer purchase visibility must treat that as unavailable until a later sync writes a positive stock value.
- Error envelopes still use Proxy-Seller's JSON error shape and must remain loud failures.

### 4. Validation & Error Matrix

- Empty `UPSTREAM_PROXY_SELLER_SOCKS5_URL` -> direct fetch path.
- Invalid SOCKS URL -> health-check reports unhealthy with `proxy_seller_socks_url_invalid`; no direct-fetch fallback.
- `resident/geo` returns ZIP with unsupported compression -> `UPSTREAM_ERROR / proxy_seller_zip_unsupported`.
- `resident/geo` returns malformed ZIP -> `UPSTREAM_ERROR / proxy_seller_zip_invalid`.
- `reference/list/resident` has no usable resident tariff id -> `UPSTREAM_ERROR / proxy_seller_tarifs_empty`.
- `resident/package` reports `Make order with resident first` -> `UPSTREAM_ERROR / proxy_seller_resident_package_missing`; this indicates no package is active yet, not a SOCKS/IP allowlist failure.
- Proxy-Seller error envelope -> `UPSTREAM_ERROR / upstream_error`; do not return empty inventory.

### 5. Good/Base/Bad Cases

- Good: PR health-check succeeds through the configured SOCKS5 proxy while IPIPD and 985 remain direct.
- Good: inventory sync accepts both raw JSON arrays and ZIP-wrapped `geo.json` arrays from Proxy-Seller.
- Good: provider resource mappings for PR are stored as `SG:6928`, dry-run previews send `{ "tarifId": "6928" }`, and real fulfillment creates the resident list after `order/make`.
- Base: no SOCKS URL in local dev, PR adapter behaves as before and uses direct fetch.
- Bad: assuming `resident/geo` always returns JSON and calling `res.json()` on ZIP bytes.
- Bad: storing `providerResourceId: "SG"` for PR and letting `providers:test-buy` preview `tarifId: "SG"`.
- Bad: catching Proxy-Seller sync failures and returning `[]`, which would fake zero inventory.

### 6. Tests Required

- Unit: PR health-check uses direct `fetch` to `reference/list/resident` when no SOCKS URL is configured.
- Unit: invalid SOCKS URL does not fall back to direct fetch.
- Unit: PR inventory sync parses raw array responses.
- Unit: PR inventory sync parses ZIP-wrapped `geo.json` responses.
- Unit: PR inventory sync accepts geo rows without stock fields, stores `stock=0`, and downstream quote/purchase eligibility rejects those rows until stock is positive.
- Unit: PR inventory sync fails when `reference/list/resident` has no tariff id.
- Unit: PR buy preview parses encoded `<countryCode>:<tarifId>` resource ids and sends the real tariff id.
- Unit: PR buy fulfillment calls `order/make` and then `resident/list/add` without fabricating proxy delivery.
- Smoke: PR health-check and inventory sync with live `.env` must be run when changing Proxy-Seller transport.

### 7. Wrong vs Correct

#### Wrong

```ts
const raw = await res.json();
const items = extractGeoRows(raw);
```

This fails when Proxy-Seller returns `geo.json` inside a ZIP payload.

#### Correct

```ts
const body = await response.readBody();
const raw = isZip(body) ? JSON.parse(extractFirstZipEntry(body).toString('utf8')) : JSON.parse(body.toString('utf8'));
const items = extractGeoRows(raw);
```

## Scenario: Native Provider Resource Coverage Contract

### 1. Scope / Trigger

- Trigger: code changes native provider inventory sync, resource seeding, provider-country routing, or adapter resource allowlists.
- Applies to `apps/api/src/modules/providers/provider-country-coverage.ts`, native provider adapters, and `apps/api/scripts/seed-resources.ts`.

### 2. Signatures

- Source of truth: live upstream resources returned by each native provider adapter, filtered only by explicit operator saleability settings where that feature is active.
- Provider keys: `PR`, `IPIPD`, `NINE_EIGHT_FIVE`.
- IPIPD upstream country conversion: `IPIPD_ALPHA3_TO_ALPHA2` and `IPIPD_ALPHA2_TO_ALPHA3`.

### 3. Contracts

- Earlier fixed country coverage lists are obsolete. Operators asked to integrate all resources exposed by each platform into its provider view, then decide saleability and pricing from the provider/pricing surfaces.
- `seed-resources` must not hard-code stale country lists as the authority for live provider resources.
- Native provider inventory sync should normalize upstream country codes/names and store all real upstream resources that the adapter can map safely.
- IPIPD upstream alpha-3 values are converted through `IPIPD_ALPHA3_TO_ALPHA2` where needed before storing platform resources.

### 4. Validation & Error Matrix

- Upstream returns a new valid country/resource -> store it as a provider resource, then let saleability/pricing decide whether users can buy it.
- IPIPD upstream returns alpha-3 not in `IPIPD_ALPHA3_TO_ALPHA2` -> skip that row.
- Adapter cannot normalize a country/resource id -> skip loudly in sync details; do not create fake resources.

### 5. Good/Base/Bad Cases

- Good: PR resources include every upstream country returned by `resident/geo` that can be paired with a resident tariff id.
- Good: 985 inventory sync stores all valid upstream countries returned by the upstream API instead of the old five-country allowlist.
- Base: a provider returns zero valid rows; sync fails visibly through `inventory_empty` and does not fabricate inventory.
- Bad: keeping the old fixed PR/IPIPD/985 country arrays as filtering authority after operators requested full provider resource integration.
- Bad: duplicating provider country arrays in seed scripts and adapters.

### 6. Tests Required

- Unit: adapters normalize representative upstream country/resource shapes and preserve newly returned valid countries.
- Unit: each native adapter skips malformed rows that cannot be safely mapped.
- Type gate: `seed-resources.ts` needs an explicit no-emit TypeScript check because `apps/api/tsconfig.json` only includes `src/**/*`.

### 7. Wrong vs Correct

#### Wrong

```ts
const COUNTRY_NAMES = { HK: 'Hong Kong', TW: 'Taiwan' };
```

This stale local allowlist can hide valid upstream resources or assign resource availability by code instead of by live provider data.

#### Correct

```ts
const countryCode = normalizeCountryCode(row);
const providerResourceId = normalizeProviderResourceId(row);
if (!countryCode || !providerResourceId) recordSkipped(row);
```
