# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

Backend changes must preserve real domain source-of-truth boundaries. Business
logic belongs in use cases and repositories, not controllers, React components,
scripts, or provider DTO mappers. Provider adapters own upstream request shape
and response parsing; use cases own platform state transitions.

The codebase is a real money/order system. "Looks successful" is not enough:
every purchase, wallet mutation, inventory sync, and fulfillment path needs a
clear success/failure state that can be tested and audited.

---

## Forbidden Patterns

* Mock/stub/fake provider behavior in production paths.
* Empty `catch`, broad `catch` followed by success/empty/default state, or
  logging-only catch around a required DB write.
* Direct wallet balance updates outside `WalletRepository` transaction helpers.
* Direct provider HTTP calls outside provider adapters or approved provider CLI
  scripts.
* Creating `proxy_instances` before a real provider response contains the exact
  ordered proxy count.
* Duplicating provider-country allowlists outside `provider-country-coverage`.
* Re-declaring provider adapters in consumer modules instead of importing the
  owning `ProvidersModule`.

---

## Required Patterns

* Use case methods own domain state transitions and should expose typed results
  when a worker or caller needs to distinguish handled failure from success.
* Wallet debit/credit must write ledger rows and balance changes in the same
  transaction, with idempotency keys scoped to the business owner and operation.
* Wallet debits must use an atomic update predicate that prevents negative
  balances at the database write boundary.
* Inventory sync results must include attempted/created/updated/skipped/failed,
  synced countries, and visible upstream failure reasons.
* Native provider country coverage must come from
  `provider-country-coverage.ts`. Inventory adapters, resource seeding, and
  sync cleanup must not keep separate country allowlists.
* IPIPD v2 inventory/order queries use zero-based paging (`current: 0`) for
  `/openapi/v2/static/lines` and `/openapi/v2/static/orders`; do not copy the
  platform's one-based pagination defaults into upstream requests.
* IPIPD inventory sync should map stored human-readable country names through
  `providerCountryName('IPIPD', alpha2)` instead of reusing the alpha-2 code as
  the label. This keeps synced resources readable in admin and customer views.
* IPIPD inventory sync must keep paginating until the upstream page is
  exhausted and must accept both alpha-2 and alpha-3 country codes before
  writing resources. Dropping a page because the code is already alpha-2
  creates a silent inventory gap that later shows up as quote 502s.
* Operator-selected native provider countries are stored on
  `provider_accounts.enabledCountryCodes`. Provider account create/update APIs
  normalize the selected codes; inventory sync must still write real upstream
  resources for unselected countries so operators can see a switched supply
  chain, then hide those rows with `provider_country_disabled`. Pricing remains
  downstream: the price center prices only real `platform_resources` created by
  sync.
* Resource-level provider saleability saves must update resource rows and rebuild
  `provider_accounts.enabledCountryCodes` in one backend-owned transaction from
  the final same-provider saleable resource set. Do not trust a frontend page or
  preserve a stale country list after the operator enables a new country/region.
* Cleanup after a successful native provider sync must use the exact current
  resource codes in addition to the country coverage codes. Detailed resources
  are keyed as `CC:<upstream id>` / `CC:<tarifId>:<path>`; country codes alone
  will match nothing and can disable the fresh detailed rows you just synced.
* After a native provider inventory sync succeeds, resources for the same
  provider that are no longer returned by the current upstream account must be
  hidden/disabled so old synced rows cannot remain purchasable.
* Multi-account native provider cleanup must preserve all current active
  accounts for the same site/provider scope. Do not let the last synced tenant
  account hide the site-global account or another tenant's current resources.
* Native provider inventory sync must write the final saleability state in the
  same `upsertSyncedResource()` call. Do not upsert a disabled-country or
  manually closed resource as `ACTIVE` and then hide it with a second update.
* Provider health checks must exercise an endpoint that validates the same
  credential/account prerequisite required by sync or buy.
* Provider health-check probes should resolve the effective runtime config
  through `ProviderRegistryService` and preserve stable adapter-reported reason
  keys such as `internal_error`, `upstream_error`, and `network_error` when the
  probe is unhealthy. Do not collapse every failed probe into
  `provider_unreachable` if the adapter already supplied a concrete reason.
* Provider health-check audit writes are best-effort observability only: after a
  probe result has been produced, an audit insert failure must be logged without
  converting the completed probe into a 500. This exception does not apply to
  wallet, order, fulfillment, or configuration state transitions.
* Static-proxy fulfillment must resolve runtime provider configuration from the
  fulfillment job/resource provider code. A native `IPIPD`, `PR`, or
  `NINE_EIGHT_FIVE` order must not be routed through an unrelated active
  `UPSTREAM_API` account; `UPSTREAM_API` is used only for resources whose
  provider code is `UPSTREAM_API`.
* Public reseller-site context must come from `GET /api/sites/current`.
  Resolution reads `x-public-host` first, then `Host`; main sites are resolved
  by `sites.domain`, reseller sites by active `tenants.brandConfig.customDomain`.
  The response must include both `site` and `tenant` when a reseller domain is
  matched.
* Any public-site context request header used by frontend login, registration,
  public home, or public buy pages must be included in API CORS
  `allowedHeaders`. `x-public-host` is part of the executable reseller-site
  contract; omitting it makes browser preflight fail before `/api/sites/current`
  reaches the controller.
* Self-service registration must honor a supplied `tenantId` from the public
  site context and validate that it belongs to the submitted `siteId` and is
  active. It must not silently fall back to the site's default tenant when the
  reseller tenant is invalid.
* Customer self-service sub-site creation uses `POST /api/customer/reseller/self-service`.
  It must create a real `tenants` row, a real `TENANT_ADMIN` account, an audit
  row, and return the customer-facing reseller/sub-site state required by the
  customer sidebar. Do not model this as a frontend-only application,
  notification, or pending mock state, and do not route customer features through
  the admin tenant endpoint.
  The tenant admin email must be independent from existing customer/admin
  emails because login resolves customer users before admin users.
* Customer proxy connectivity checks must probe only an owned
  `proxy_instances.id`; never accept caller-supplied host, port, protocol, or
  target URL. The outbound target is `PROXY_CHECK_TARGET_URL`. The prober must
  choose `http.get` + `HttpProxyAgent` for `http:` targets, `https.get` +
  `HttpsProxyAgent` for `https:` targets, and `SocksProxyAgent` for SOCKS5
  proxies. Network failures return `{ reachable: false, error }` as a normal
  business result, not a 500 and not a fake success.
* Tests should pass through the stable public interface of the module under
  change instead of asserting incidental private calls.

---

## Scenario: Managed Static Proxy Public Price Resolution

### 1. Scope / Trigger

- Trigger: customer quote, public resource listing, and order creation for
  managed static proxy providers (`PR`, `IPIPD`, `NINE_EIGHT_FIVE`).
- Applies to `/api/resources` public saleable listing, `/api/pricing/quote`,
  and `/api/orders/static-proxy`.

### 2. Signatures

- Public resource list: `GET /api/resources?publicOnly=true&page=...&pageSize=20&durationDays=30&currency=CNY`
- Customer quote: `GET /api/pricing/quote?resourceId=...&durationDays=30&quantity=...&currency=CNY`
- Customer order: `POST /api/orders/static-proxy`

### 3. Contracts

- Managed static proxy providers use 39 CNY as the 30-day base price only when
  no explicit database price applies.
- Explicit database prices win over the base price in this order: user resource
  override -> user template rule -> tenant default template rule -> resource
  override -> site default template rule -> managed-provider base price.
- The public list and the quote endpoint must agree on the same unit price and
  currency for the same managed resource.
- Customer public lists must not expose country-only managed-provider rows as
  purchasable products. Countries are grouping/price-scope nodes; purchasable
  rows are concrete region/line/network resources.
- When a concrete resource has no direct price, the backend resolves price
  scopes in this order: concrete resource id -> `platform_resources.parentId`
  chain -> same-site, same-provider, same-ipType country resource for the
  parsed country code -> managed-provider base price. Public resource listing
  and quote must use the same helper for this scope order.
- `priceSource` must identify the effective pricing source in quote responses.

### 4. Validation & Error Matrix

- Managed provider + supported concrete resource + direct override row ->
  return that override.
- Managed provider + supported concrete resource + same-country override row
  and no direct override -> return the country override.
- Managed provider + supported network/zone resource + parent region override
  row and no direct network override -> return the parent region override
  before the country override.
- Managed provider + supported concrete resource + no database price -> return
  39 CNY for 30 days, adjusted by duration multiplier.
- Customer `GET /api/resources?type=COUNTRY` -> empty public catalog page, not
  country grouping rows.
- Customer quote with a `COUNTRY` resource id -> `VALIDATION_ERROR /
  resource_not_purchasable`.
- Managed provider + unsupported country -> resource stays unsaleable and must
  not appear in the public list.
- Currency mismatch -> reject the price candidate instead of silently mixing
  currencies.

### 5. Good/Base/Bad Cases

- Good: `IPIPD`/`PR`/`985` public rows quote with the same explicit or base
  price shown in the customer resource list.
- Good: setting a 30-day country price in admin applies to concrete resources
  for that same provider/country when those resources do not have a direct
  price.
- Good: setting a 30-day region/line price in admin applies to child network
  resources when those child resources do not have a direct price.
- Base: non-managed resources continue to use the normal pricing matrix.
- Bad: showing a country-only managed-provider row as a purchasable product.
- Bad: resolving quote prices through the parent chain while public listing
  only checks the concrete resource id, because the customer then sees a
  different price or no price.
- Bad: returning a public resource row that shows a different unit price from
  the quote endpoint.

### 6. Tests Required

- Quote/repository tests: managed provider resources use direct explicit
  prices before inherited parent/country prices and base prices.
- Resource repository tests: public resource listing excludes country-only
  product rows, rejects/empties public `type=COUNTRY`, and uses the same price
  scope resolution as quote.
- Quote tests: `COUNTRY` resource ids return `resource_not_purchasable` before
  inventory or price lookup.
- Order integration tests: purchase must debit and persist the same quoted
  value that the customer saw.

### 7. Wrong vs Correct

#### Wrong

```ts
return getBaseStaticProxyPrice(resource);
```

#### Correct

```ts
const price = await pricingRepo.getPriceForUser(...);
return price ?? getBaseStaticProxyPrice(resource);
```

---

## Scenario: Proxy-Seller Resident Upstream Cost Sync

### 1. Scope / Trigger

- Trigger: Proxy-Seller (`PR`) inventory sync and any admin surface that shows
  upstream cost.
- Applies to `PrAdapter.syncInventory`, `ResourcesRepository.upsertSyncedResource()`,
  and matrix/list views that read `upstreamCost` / `upstreamCostCurrency`.

### 2. Signatures

- Inventory sync flow:
- `GET resident/geo`
- `GET reference/list/resident`
- `POST order/calc`
- `order/calc` body:
  - `paymentId: 1`
  - `tarifId`
  - `coupon: ''`

### 3. Contracts

- `reference/list/resident` only selects the resident tariff id used for the
  sync and buy path.
- `order/calc` is the source of truth for the upstream unit cost and currency.
- PR inventory sync must persist `upstreamCost` and `upstreamCostCurrency`
  from `order/calc`; tariff metadata alone is not a valid cost source.
- A sync that cannot resolve a numeric cost is a visible upstream failure, not
  a successful sync with `null` cost.

### 4. Validation & Error Matrix

- Missing resident tariff id -> `UPSTREAM_ERROR / proxy_seller_tarifs_empty`
- `order/calc` returns no numeric price -> `UPSTREAM_ERROR /
  proxy_seller_calc_invalid`
- `order/calc` returns a numeric price and currency -> persist the upstream
  cost and currency on every synced resource

### 5. Good/Base/Bad Cases

- Good: reference/list selects tariff `6928`, order/calc returns `1.99 USD`,
  and every synced PR resource stores that cost.
- Base: geo-tree flattening still owns only country/region/path stock mapping.
- Bad: reading `price`, `cost`, or `amount` from the resident tariff list when
  the live response does not provide those fields.
- Bad: writing a sync result with `upstreamCost = null` after a successful PR
  inventory sync.

### 6. Tests Required

- PR adapter sync tests must assert the `order/calc` request shape and the
  persisted upstream cost/currency.
- Coverage tests must assert PR synced items carry the same resolved cost and
  currency across the normalized inventory rows.
- Regression: tariff lookup failures still fail loudly before any fake cost is
  written.

### 7. Wrong vs Correct

#### Wrong

```ts
const tarif = selectResidentTarif(extractResidentTarifs(reference));
const upstreamCost = firstNumeric(tarif.price, tarif.cost, tarif.amount);
```

#### Correct

```ts
const tarif = selectResidentTarif(extractResidentTarifs(reference));
const cost = await fetchResidentTarifCost(config, String(tarif.id));
```

---

## Scenario: Upstream API Inventory Sync Shape Normalization

### 1. Scope / Trigger

- Trigger: `UpstreamApiAdapter.syncInventory()` and
  `ResourcesRepository.upsertSyncedResource()`.
- Applies to `/res_static/inventory` syncs for upstream accounts and the admin
  surfaces that display `upstreamCost` / `upstreamCostCurrency`.

### 2. Signatures

- Inventory responses may arrive as:
  - `data: [...]`
  - `data: { items: [...] }`
  - `data: { list: [...] }`
  - `data: { records: [...] }`
  - top-level `items` / `list` / `records`
- Inventory rows may use aliases such as `country_code`, `countryCode`,
  `country_name`, `area_code`, `area_name`, `resource_id`, `line_id`,
  `proxy_id`, `price`, `cost`, `amount`, `unit_price`, and currency aliases.

### 3. Contracts

- Sync adapters must flatten the first real row collection they find and ignore
  wrapper shells instead of rejecting the entire response.
- `area_code` is not automatically a plain alpha-2 country code. Compound
  resource codes must only resolve to a country when the parsed prefix matches
  a known covered country code.
- `regionCode` should be preserved when the upstream row carries region/city
  data so admin labels stay readable.
- Upstream cost strings must be trimmed before validation and persistence.
  A successful sync with a parsable cost must not write `null`.

### 4. Validation & Error Matrix

- Wrapped inventory rows + valid country/resource id -> sync succeeds.
- Row with no resolvable country code/resource id -> skip the row, not the
  entire batch.
- Batch with zero valid rows -> `UPSTREAM_ERROR / inventory_empty` at the
  use-case boundary.
- Cost string with surrounding whitespace -> persists as the numeric cost,
  not `null`.

### 5. Good/Base/Bad Cases

- Good: `data.records` rows with `area_code = CA:...` sync to `countryCode =
  CA` and keep the full resource id as `providerResourceId`.
- Good: admin/provider views show the parsed upstream cost currency from the
  live row.
- Bad: treating every `area_code` as a plain country code and silently
  dropping valid rows.
- Bad: returning sync success after flattening nothing from a wrapped response.

### 6. Tests Required

- Adapter unit tests cover wrapped `records` / `items` responses and compound
  area codes.
- Repository unit tests cover trimmed upstream cost persistence.
- Use-case tests still assert a zero-row sync fails visibly.

---

## Testing Requirements

Required coverage by risk:

* Provider adapters: unit tests for request preview, envelope errors, transport
  configuration, country filtering, and no fake inventory.
* Inventory sync: use-case tests for selected account config, zero upstream
  inventory as visible failure, and no repository writes on failure.
* Wallet/order: real PostgreSQL integration tests for insufficient balance,
  no double debit on duplicate idempotency key, scoped idempotency reuse, and
  atomic order/job/ledger creation.
* Worker: unit tests for disabled mode, per-item logging, overlapping poll
  prevention, and continuing after one failed job/account.
* Proxy-check prober: unit tests for target protocol selection, proxy-agent URL
  construction, network errors returning unreachable, and no credential leakage
  through API results or audit metadata.
* Type gates: run `pnpm --filter @ipeasy/api typecheck` and the matching worker
  or web typecheck when exported contracts change.

---

## Code Review Checklist

* Is there one source of truth for price, wallet, inventory, order, provider
  credential, and delivered proxy data?
* Does every catch block either rethrow, return a typed handled result, or own
  a real compensating transaction?
* Can a user or tenant reuse an idempotency key without cross-user conflict?
* Can concurrent wallet mutations overdraw the wallet?
* Does "sync success" mean at least one real upstream item was processed?
* Do provider inventory, resource seeding, pricing, and public product lists
  all agree on the operator-approved country coverage?
* When a provider account has `enabledCountryCodes`, does inventory sync skip
  unselected upstream countries and hide stale resources outside the selected
  set before pricing is edited?
* Does a reseller custom domain resolve to the correct site and tenant before
  registration or purchase begins?
* Does CORS allow every browser-sent header required for public site context,
  especially `x-public-host`?
* Are provider credentials, API keys, proxy passwords, and signed URLs excluded
  from logs/audit metadata?
* Are tests proving behavior rather than mock calls?
