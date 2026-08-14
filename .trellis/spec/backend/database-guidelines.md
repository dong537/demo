# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

This project uses Prisma over PostgreSQL from `@ipeasy/db`. Prisma schema and
migrations live under `packages/db/prisma/`; application modules import the
shared Prisma client through the package instead of constructing their own DB
connections.

Database writes that affect money, orders, fulfillment, refunds, provider
resources, or audit logs must go through the domain repository/use-case that
owns the state transition. Controllers and scripts may orchestrate but must not
hand-write cross-table business updates.

---

## Query Patterns

Repository list methods coerce pagination values to numbers before passing
`skip/take` to Prisma. Scoped queries always include `siteId`, and tenant/user
scope is added by the repository/use case from `AuthenticatedContext`, not from
client-supplied authority fields.

Use `findFirst` for scoped lookups where the unique key is not exactly the
scope, and `findUnique` only when the Prisma unique shape matches the business
lookup. Do not fetch globally by idempotency key when the business key is scoped
by site, tenant, and user.

---

## Migrations

Schema changes require a Prisma migration under
`packages/db/prisma/migrations`. Do not rely on runtime auto-migration or code
fallbacks that read both old and new columns in production paths.

When changing uniqueness or idempotency semantics, migrations must explicitly
drop obsolete indexes and create the new compound key. Example: static proxy
orders use `@@unique([siteId, tenantId, userId, idempotencyKey])`; the old
global `orders.idempotencyKey` unique index must not remain.

---

## Naming Conventions

Prisma models mirror existing snake_case table names such as `orders`,
`wallets`, `ledger_entries`, `provider_accounts`, and
`inventory_snapshots`. Business id fields are strings/UUIDs. Money is stored as
`Decimal(20, 8)` and must be converted with the shared money helpers before
comparison or arithmetic.

---

## Common Mistakes

* Reading wallet balance outside the transaction that debits and creates the
  order/job.
* Updating wallet balance without a ledger entry and optimistic/conditional
  update.
* Using a globally unique idempotency key when business semantics are scoped.
* Treating a missing inventory snapshot as stock `0` instead of
  `inventory_stale`.
* Catching Prisma errors and returning empty pages or fake resources.

## Scenario: Repository Pagination and DB Failure Behavior

### 1. Scope / Trigger

- Trigger: repository list methods feed API `PageResult<T>` responses and call Prisma with values sourced from HTTP query params.

### 2. Signatures

- Input: `query.page?: string | number`, `query.pageSize?: string | number`.
- Prisma: `skip: number`, `take: number`.
- Output: `{ page: number; pageSize: number; total: number; items: T[] }`.

### 3. Contracts

- Convert pagination values through the shared pagination helper before computing `skip/take`.
- Display/list endpoints default to page `1`, pageSize `20`, and cap `pageSize` at `20` unless a dedicated export/streaming contract says otherwise.
- Preserve unexpected Prisma/DB failures so the global exception filter returns `INTERNAL_ERROR`.
- Do not catch DB errors and return empty arrays or default objects.

### 4. Validation & Error Matrix

- String query numbers -> successful list response with numeric metadata.
- Missing query -> defaults to page `1`, pageSize `20`; oversized `pageSize` is clamped to `20`.
- DB outage/table missing -> 500 `INTERNAL_ERROR`, not `{ items: [] }`.

### 5. Good/Base/Bad Cases

- Good: wallet ledger, payment orders, orders, and proxies coerce pagination at repository boundary.
- Base: a healthy empty result returns `{ total: 0, items: [] }`.
- Bad: catching Prisma errors and returning empty lists hides outages.

### 6. Tests Required

- Integration tests with real Postgres for list endpoints using `page=1&pageSize=10`.
- Fault-path integration tests that break a table or connection and assert a 500 envelope.

### 7. Wrong vs Correct

#### Wrong

```ts
try {
  return await prisma.wallets.findMany();
} catch {
  return [];
}
```

#### Correct

```ts
const { page, pageSize } = normalizePageQuery(query);
return prisma.ledger_entries.findMany({ skip: (page - 1) * pageSize, take: pageSize });
```

## Scenario: Admin Payment Order Account Projection

### 1. Scope / Trigger

- Trigger: backend or frontend code lists, details, or confirms wallet top-up `payment_orders` for the admin payment list.
- Applies to `PaymentsRepository`, `PaymentsController`, `PaymentOrderDto`, `PaymentListFeature`, and `payment_orders -> users`.

### 2. Signatures

- `GET /api/payments?page&pageSize&status&channel&userId?` -> `PageResult<PaymentOrderDto>`.
- `GET /api/payments/:id` -> `PaymentOrderDto`.
- `POST /api/payments/:id/confirm` -> `{ order: PaymentOrderDto; wallet: { available: string; currency: string } }`.
- `PaymentOrderDto.user?: { id: string; email: string; name: string | null; phone: string | null; status: string } | null`.

### 3. Contracts

- Admin payment list/detail queries must include a scoped `users` projection for the payment owner: `id`, `email`, `name`, `phone`, and `status`.
- `PaymentOrderDto.userId` remains the support identifier and copy target; `PaymentOrderDto.user.email` is the primary account label when present.
- Customer-created payment order responses may omit the user projection or return `user: null`; do not add an extra user lookup only for the customer success page.
- The frontend payment list must render account information from `PaymentOrderDto.user`; it must not issue a second user-list request or keep a local user-id-to-email cache.
- The admin UI may fall back to the shortened `userId` only when the backend projection is absent, so older responses remain readable without hiding the support id.

### 4. Validation & Error Matrix

- Payment order belongs to another site -> existing site scope returns `NOT_FOUND / payment_order_not_found`.
- Tenant admin reads another tenant's payment order -> tenant scope returns `NOT_FOUND / payment_order_not_found`.
- User reads another user's payment detail -> controller returns `PERMISSION_DENIED / cannot_read_other_order`.
- `PaymentOrderDto.user` absent/null -> frontend shows shortened, copyable `userId`, not an empty user cell.

### 5. Good/Base/Bad Cases

- Good: admin payment list row shows `customer@example.com`, status, optional name/phone, and a copyable short `userId`.
- Good: confirm modal displays the same account projection as the row so operators confirm the right customer.
- Base: customer top-up creation returns the order id/status without account projection because the caller already owns the session.
- Bad: rendering only `0d48eba1...` in the admin user column when the related `users.email` is available.
- Bad: fetching `/api/users` from the payment list and joining in React state, which can leak tenant data and desync pagination.

### 6. Tests Required

- Repository unit: `listPaymentOrders` and `getPaymentOrderById` call Prisma with `include: { user: { select: paymentOrderUserSelect } }`.
- Frontend component: payment list renders `user.email`, optional name/phone, status, and still keeps `userId` copyable.
- Frontend component: confirm modal displays the selected payment's account projection.
- Regression: customer top-up creation and admin pending-count query continue to accept `PaymentOrderDto.user` as optional.

### 7. Wrong vs Correct

#### Wrong

```tsx
render: (userId: string) => <Typography.Text>{shortId(userId)}</Typography.Text>
```

This turns the admin payment list into a support-id table and hides the customer's actual account.

#### Correct

```tsx
render: (_, payment) => (
  <PaymentUserSummary payment={payment} />
)
```

The backend owns the account projection, and the frontend displays the account label while preserving the copyable `userId`.

## Scenario: Resource Inventory And Pricing Quote Source Of Truth

### 1. Scope / Trigger

- Trigger: backend code lists platform resources, reads inventory snapshots, writes pricing rules, or returns a customer/admin quote.
- Applies to `ResourcesController`, `ResourcesRepository`, `PricingController`, `PricingRepository`, and `QuoteUseCase`.

### 2. Signatures

- `GET /api/resources?page&pageSize&search&status&type&providerCode&countryCode` -> `PageResult<ResourceListItem>`.
  Public items include `costGroupKey`; admin/priceable items may also include
  `upstreamCost` and `upstreamCostCurrency`.
- `GET /api/resources/countries?search&providerCode&countryCode&durationDays&currency` -> `{ items: { countryCode, totalResources, availableStock }[] }`.
- `GET /api/resources/:id/inventory` -> latest `inventory_snapshots` row with calculated `isStale`.
- `POST /api/resources/sync-inventory` body `{ providerCode, accountId? }` -> `{ attempted, created, updated, skipped, failed, synced, syncedAt, upstreamRawStatus, countries }`.
- `POST /api/resources/:id/sync-inventory` uses the resource's provider plus the authenticated `siteId/tenantId`; it must not drop tenant scope and fall back to an unrelated site-global account.
- `POST /api/upstream-accounts/:id/sync-inventory` delegates to `SyncInventoryUseCase.execute(ctx.siteId, 'UPSTREAM_API', ctx.tenantId, id)` after account scope validation.
- `PUT /api/providers/:id` with `enabledCountryCodes` writes the provider account and immediately projects that country selection to same-site `platform_resources` for the provider.
- `GET /api/resources/priceable-catalog?page&pageSize&durationDays&currency` returns admin bulk-pricing resources: active, visible, saleable, non-`COUNTRY` rows plus direct override price and upstream cost.
- `GET /api/resources/priceable-catalog/summary?page&pageSize&search&durationDays&currency` returns admin quick-pricing country summaries with fixed display pagination.
- `GET /api/resources/priceable-catalog/groups?countryCode&page&pageSize&durationDays&currency` returns one selected country's region/cost groups with fixed display pagination.
- `POST /api/pricing/resource-group-overrides` body `{ countryCode, regionKey, costGroupKey, autoSelect, durationDays, unitPrice, currency }` writes prices for the backend-resolved saleable resources in that group.
- `POST /api/pricing/templates/:id/rules` body `{ rules: PriceRuleBody[] }` or a single `PriceRuleBody`.
- `GET /api/pricing/quote?resourceId&durationDays&quantity&currency` -> `QuoteResult`.

### 3. Contracts

- `siteId` is owned by `AuthenticatedContext`; resource and pricing APIs must not accept client-supplied `siteId` as the authority.
- Resource lists are real database pages. They include the latest inventory summary (`stock`, `inventoryCapturedAt`, `inventoryIsStale`) but never invent stock values.
- Customer public resource lists (`publicOnly`) must apply `count + skip/take` at the database layer before pricing resolution. Price lookups should receive only the current page resource ids, not every saleable resource in the site.
- Customer public resource DTOs may expose an anonymous `costGroupKey` derived
  from `(upstreamCostCurrency, upstreamCost)` so the UI can split same-country
  resources into `Line 1`, `Line 2`, etc. They must not expose
  `upstreamCost` or `upstreamCostCurrency`; those amounts are admin/operator
  data only.
- Customer public country summaries are a separate selector contract. `/api/resources/countries` groups active, visible, saleable, non-`COUNTRY` resources by `resourceCountryCode(row.code)` and returns one row per country; it does not page or return concrete SKU rows.
- `/api/resources/countries` must stay a lightweight selector query. It may read resource codes and count resources, but it must not include `inventory_snapshots` for every resource to calculate country stock totals. Inventory remains quote/order context, not the country-selector source of truth.
- Customer public SKU pages may use `countryCode=<CC>` to filter before `count + skip/take`. The filter must match exact `code = CC` or line codes starting with `CC:` and must not use broad `contains`.
- Resource list APIs must clamp display `pageSize` to `20` at the repository boundary. Frontend pagination defaults are not a security/performance boundary.
- Customer public resource search must stay database-side. When customer-facing labels are localized, the repository expands known country/city aliases such as `纽约`, `新加坡`, or `美国` into real `platform_resources.code/name/displayName/providerCode` conditions before pagination. Two-letter country aliases must use `code.startsWith`, not broad `code.contains`, so `美国`/`US` does not accidentally match unrelated codes such as `AUS`.
- Inventory sync result semantics are explicit. `synced` is not enough by itself; callers must see attempted/created/updated/skipped/failed counts and synced countries.
- Upstream API account inventory sync must reuse `SyncInventoryUseCase`. Controllers must not duplicate resource upsert, inventory snapshot, mapping writes, freshness TTL, or `inventory_empty` failure handling.
- `ProviderRegistryService.getConfig('UPSTREAM_API', siteId, tenantId)` must resolve the tenant-specific active upstream account first, then the public site account, so purchase-time stale inventory refresh can use the same real account selection path as fulfillment. An explicit account id still goes through `getConfigForProviderAccount('UPSTREAM_API', siteId, accountId)`.
- `POST /api/resources/sync-inventory` with an explicit `accountId` must enforce tenant scope for `TENANT_ADMIN` callers before calling `SyncInventoryUseCase`: the account must belong to `ctx.tenantId` or be the site-global account. Another tenant's account returns `PERMISSION_DENIED / tenant_access_denied`; a missing account returns `NOT_FOUND / provider_account_not_found`.
- Admin UI consumers must treat optional/missing summary fields defensively while still surfacing backend `reasonKey` failures; never read `countries.length` before normalizing it to an array.
- Provider inventory sync returning zero upstream items is `UPSTREAM_ERROR / inventory_empty`, not a successful empty sync.
- Proxy-Seller inventory adapters must normalize real upstream country fields (`countryCode`, `country_code`, `iso2`, `alpha2`, `country_alpha3`, `countryAlpha3`, `alpha3`, and English country names) into the supported PR alpha-2 coverage before writing `platform_resources`; unsupported countries are skipped, not stored as fake resources.
- Proxy-Seller `resident/geo` inventory is a country -> region -> city -> ISP tree, not a flat stock feed. When a node has no explicit numeric stock field, derive the stock from its nested leaf count instead of persisting `0`.
- Proxy-Seller legacy country rows are part of the visible resource projection, not just a stock cache. When detailed leaf resources are synced, the matching legacy country row must also be rewritten with the latest `upstreamCost` and `upstreamCostCurrency` together with stock and mapping; refreshing only snapshot/mapping leaves admin/provider cost views stale.
- Quote inventory source of truth is the latest `inventory_snapshots` row for `(siteId, resourceId)` for every provider. Missing or expired snapshots return `UPSTREAM_ERROR / inventory_stale`.
- Quote may attempt one real Provider inventory sync when the latest snapshot is missing or stale, then re-read the snapshot. If sync fails or the snapshot is still stale/missing, keep returning a visible upstream error; do not bypass inventory validation.
- Proxy-Seller (`PR`) no longer has a stock-validation bypass. A fresh latest snapshot with `stock=0` returns `UPSTREAM_OUT_OF_STOCK / out_of_stock`, and stale/missing snapshots trigger the same sync-then-error path as other providers.
- Customer public resource lists should expose priced, visible, saleable upstream resources even when the latest local inventory snapshot is zero, missing, or stale. The list is the configured catalog surface; quote/order remains the inventory source of truth and must reject stale, missing, or zero inventory visibly.
- Customer reseller product APIs expose the main-site product pool as reseller-saleable products, but their DTOs must not leak upstream provider codes, upstream account details, or upstream costs. Reseller users manage only enabled state and their own selling prices.
- Native provider inventory sync must preserve upstream line granularity. Do not collapse multiple upstream lines in one country into a single `platform_resources` row. Use a stable resource code derived from the country and upstream resource id, for example `US:<lineId>`, and keep `resource_mappings.providerResourceId` as the exact upstream line/tariff id used during fulfillment.
- Synced resource upstream cost must reflect the current upstream inventory response. If the adapter returns no cost for this sync, write `platform_resources.upstreamCost = null` and `upstreamCostCurrency = null`; do not keep an older cost from a previous sync.
- Native provider saleability is centralized in `provider-saleability-policy.ts`. Current operator policy is permissive for real upstream resources: PR, IPIPD, and 985 resources that sync from upstream are eligible for saleability projection, regardless of fixed country recommendation lists or IPIPD `Recommended` markers. The stored `MANAGED_RESOURCE_SALEABLE_COUNTRIES` list is an initial operator recommendation only, not a hard runtime allowlist.
- Saving native provider `enabledCountryCodes` is a configuration state transition, not a UI hint. The provider repository must immediately recompute same-site resources for that provider: selected countries that pass `provider-saleability-policy.ts` become `ACTIVE/isVisible/isSaleable`; unselected countries become hidden with `provider_country_disabled`; selected resources blocked by a future operator policy remain hidden with `provider_sale_policy_disabled`. This explicit operator save may restore rows previously hidden by provider country selection or unsupported-country cleanup, but it must not clear a manual operator close recorded as `provider_sale_disabled`.
- Saving resource-level provider saleability through `PUT /api/providers/:id/resources/saleability` must rebuild `provider_accounts.enabledCountryCodes` from the final same-provider resources that are actually `ACTIVE/isVisible/isSaleable`. The rebuild is backend-owned and must use the full same-site provider resource set, not the frontend's current page, so a newly enabled country survives the next inventory sync and a removed country stops leaking to the customer catalog.
- Native provider `enabledCountryCodes=[]` means no countries are enabled for sale. It must not be interpreted as the provider's default coverage. Inventory sync must still write the real upstream rows so operators can see and enable the switched supply chain; those rows are hidden with `provider_country_disabled` until explicitly enabled.
- Inventory sync owns upstream stock/cost/mapping refresh, not operator sale toggles. When a concrete resource is manually closed with `provider_sale_disabled`, syncing the same upstream line may refresh `upstreamCost`, inventory, and mapping, but must preserve `HIDDEN/isSaleable=false`. When no countries are enabled, sync should refresh real upstream resources and hide them with `provider_country_disabled`, not permanently mark them `DISABLED` or skip writing them.
- Inventory sync must pass the final saleability state into `upsertSyncedResource()` when a provider country is disabled or a resource was manually closed. Do not upsert a managed resource as active and then issue a separate hide update, because a mid-sync failure can leave an unsaleable upstream row visible to customers.
- Cleanup after a successful sync must preserve every current active account for the same `(siteId, providerCode)`, not only the account currently being synced. `hideResourcesFromOtherUpstreamAccounts()`-style cleanup may hide old/null account rows, but it must not hide resources owned by another tenant override or site-global account that is still the most recent active account for its scope.
- `/api/resources/priceable-catalog` is the source for admin quick pricing and per-user pricing selectors. It must not return country-only grouping rows; country selection is a UI grouping over concrete resources, not a purchasable product row.
- `/api/resources/priceable-catalog` must include current upstream cost fields
  for admin quick pricing. Operators set prices by country/region plus cost
  line: same location + same cost can be bulk-priced together, while same
  location + different cost must remain separate price groups.
- `/api/resources/priceable-catalog/summary` and
  `/api/resources/priceable-catalog/groups` are the resource-management quick
  pricing source. They must use the same active/visible/saleable/concrete
  resource filter, tenant scope, and current upstream account filter as
  `/api/resources/priceable-catalog`, while clamping `pageSize` to `20`.
- Admin resource display lists (`GET /api/resources` for admin callers) must
  also apply the current upstream account filter. Legacy native-provider rows
  with `upstreamAccountId = null`, especially old Proxy-Seller (`PR`) rows, must
  not reappear in Resource Management just because the admin list is broader
  than the public catalog.
- Quick-pricing summary search is database-side. Do not load the full catalog
  and search countries in memory on the frontend.
- `/api/pricing/resource-group-overrides` must resolve resource ids on the
  backend through the same group selector used by the groups endpoint, then
  replace/create `price_overrides` in one transaction. It must not trust a
  frontend-supplied resource-id list for hidden pages.
- Managed native provider base sale price is `39 CNY` for 30 days; 60/90 day defaults use the same duration multipliers as existing templates unless an explicit override/user/template price wins.
- `hasBuyableInventory(providerCode, stock)` is the source of truth for buyable inventory checks. It requires `stock > 0` for every provider, including PR.
- Inventory sync must write `inventory_snapshots.freshnessTtlSeconds` from `DATABASE_INVENTORY_FRESHNESS_MS` (seconds after conversion). Do not rely on the table default 300 seconds for synced provider resources; the worker sync interval must stay below this freshness TTL so valid PR/IPIPD/985 resources do not disappear from customer purchase pages between worker runs.
- Proxy-Seller (`PR`) inventory freshness has an effective minimum TTL of 6
  hours. New PR sync/manual inventory writes should store at least that TTL, and
  stale checks must apply the same effective TTL to historical rows that were
  already stored with the old `300` second value.
- `PROVIDER_INVENTORY_SYNC_ENABLED` defaults to `true`. Set it to `false` only for intentional maintenance. `ConfigGuard` must fail production startup when inventory sync is enabled and `WORKER_INVENTORY_SYNC_INTERVAL_MS >= DATABASE_INVENTORY_FRESHNESS_MS`.
- Quote pricing source of truth is the database priority chain: user resource override -> user template rule -> resource override -> default template rule.
- If a higher-priority price row exists in a different currency, return `CURRENCY_NOT_SUPPORTED`; do not fall through to a lower-priority price.
- Admin pricing matrix and display resource list APIs must keep resource reads paginated and enforce fixed `pageSize=20` at the repository boundary. Do not allow clients to request every resource row in one page for convenience metrics.

### 4. Validation & Error Matrix

- Missing resource -> `NOT_FOUND / resource_not_found`.
- Missing inventory or expired inventory for any provider -> quote attempts one real sync, then returns `UPSTREAM_ERROR / inventory_stale` if no fresh snapshot is available.
- Missing, zero, or stale inventory for Proxy-Seller (`PR`) -> same behavior as every provider; zero stock returns `UPSTREAM_OUT_OF_STOCK / out_of_stock`.
- Provider sync returns zero items -> `UPSTREAM_ERROR / inventory_empty`.
- Latest stock `0` for IPIPD/985 -> public customer list may still show the priced configured line; quote/order returns `UPSTREAM_OUT_OF_STOCK / out_of_stock` after realtime validation.
- Latest stock `0`, stale, or missing local snapshot for Proxy-Seller (`PR`) -> quote is blocked; do not rely on fulfillment-time confirmation.
- Public resource search `search=纽约` -> DB `OR` includes `displayName/name contains 'New York'` and code patterns such as `:NY`/`USANY` before `count/findMany`.
- Public resource search `search=新加坡` -> DB `OR` includes `code startsWith 'SG'` and `displayName/name contains 'Singapore'`; it must not add broad `code contains 'SG'`.
- Public resource list `countryCode=AT&page=2&pageSize=20` -> DB filters Austria resources before pagination and returns the Austria page-2 `total`, not a global page.
- Country summary rows with multiple upstream lines for `US` -> one `{ countryCode: 'US', totalResources, availableStock }` item, not duplicate countries.
- Country summary `availableStock` may be `0` when the lightweight selector intentionally avoids loading every inventory snapshot; the customer quote flow remains the real inventory validation path.
- Public resource row with `upstreamCost=8.8 CNY` -> response includes a stable
  anonymous `costGroupKey` for `CNY:8.8` and omits `upstreamCost`.
- Two same-country rows with costs `8.8 CNY` and `14 CNY` -> public UI can
  render two line groups and quote/order one real `resourceId` from the chosen
  group.
- Admin priceable catalog row with `upstreamCost=8.8 CNY` -> response includes
  both `costGroupKey` and the human-readable cost fields for operator review.
- Provider account update `enabledCountryCodes=['GB']` for IPIPD -> all real GB IPIPD lines become active/saleable even if they were previously hidden by provider-country selection, and JP/other countries are hidden with `provider_country_disabled`.
- Provider account update `enabledCountryCodes=['GB']` for IPIPD + a GB row already marked `provider_sale_disabled` -> the row stays `HIDDEN/isSaleable=false` with `provider_sale_disabled`; country selection does not override a manual operator close.
- Provider account update `enabledCountryCodes=[]` for IPIPD/PR/985 -> no native countries are saleable; existing same-provider resources are hidden with `provider_country_disabled` and customer/resource pricing selectors must not expose them, while future syncs still refresh real upstream rows.
- Tenant admin sync with another tenant's explicit provider `accountId` -> `PERMISSION_DENIED / tenant_access_denied`; do not let a tenant switch or hide another tenant's resources through the shared sync endpoint.
- Priceable catalog query -> excludes `type='COUNTRY'` even when the country row itself is active/saleable.
- Missing price row across the priority chain -> `PRICE_MISSING / no_price_rule`.
- Invalid pagination, enum, duration, quantity, or price amount -> `VALIDATION_ERROR`.

### 5. Good/Base/Bad Cases

- Good: `QuoteUseCase` reads `resourcesRepo.findByIdInSite()` and every provider reads `resourcesRepo.getLatestInventory()` before pricing.
- Good: a PR resource with a stale local snapshot triggers one inventory sync; if it remains stale or zero, quote fails visibly.
- Good: two IPIPD US lines such as "New York Recommended" and "New York Standard" sync into two resources with separate stock, cost, mapping, and price rows.
- Good: two same-location resources with different upstream costs show as two
  anonymous customer lines and two admin quick-price groups; saving one group's
  price only writes overrides for resources in that cost group.
- Good: `/api/resources/countries` shows `US` once while `/api/resources?countryCode=US&page=1&pageSize=20` returns concrete US lines with resource ids and prices.
- Good: saving provider selected countries immediately changes `/api/resources/priceable-catalog`, `/api/resources/countries`, and customer `/api/resources` because all three read the same projected `platform_resources` state.
- Good: a customer searching `纽约` on the bounded purchase page can find a DB resource named `United States-New York Recommended` even when that SKU is not in the first 300 rows.
- Good: Admin resource create/update writes `siteId: ctx.siteId`.
- Base: a priced but out-of-stock or stale resource can remain visible in the customer resource list so configured products are discoverable; quote still returns `out_of_stock` or `inventory_stale` when realtime validation fails.
- Base: `GET /api/resources?page=3&pageSize=20&durationDays=30&currency=CNY` returns the true filtered `total` and scopes price lookup to the 20 rows on page 3.
- Base: `GET /api/resources/countries?search=新加坡` returns only matching country summaries, then the UI loads `/api/resources?countryCode=SG&search=新加坡`.
- Bad: `GET /api/resources?siteId=...` trusting a request-owned site id.
- Bad: deriving country summaries from the first `/api/resources` page, which hides countries that are not in that page.
- Bad: fetching all public saleable resources, calculating prices for all of them, and then using `items.slice(offset, offset + pageSize)` for pagination.
- Bad: updating only `provider_accounts.enabledCountryCodes` and waiting for a later inventory sync before hiding or restoring existing resources.
- Bad: showing active country rows in quick pricing as if they were purchasable SKUs.
- Bad: collapsing `US -> line A` and `US -> line B` into one country resource, which prevents operators from pricing/selling a stocked alternate line after the first line sells out.
- Bad: grouping same-location resources only by country/region when their costs
  differ; this makes a one-click admin price save overwrite resources with
  different margins.
- Bad: exposing raw `upstreamCost` to customer purchase pages so users can infer
  upstream supplier pricing.

### 6. Tests Required

- Unit: inventory freshness helper covers explicit stale flag and TTL expiry.
- Unit: price candidate selection does not fall through after a higher-priority currency mismatch.
- Unit: public saleable resource listing passes `skip/take` to Prisma before pricing and sends only current-page resource ids to price queries.
- Unit: public saleable resource listing applies `countryCode` before pagination with exact country-prefix matching.
- Unit: public country summary listing groups duplicate same-country resources, excludes country-only grouping rows, and asserts the Prisma select does not include `inventory_snapshots`.
- Unit: public saleable resource listing keeps priced configured resources visible even when the latest local inventory snapshot is zero, stale, or missing; it must not use historical `inventory_snapshots.some` as a list filter.
- Unit: public saleable resource listing returns `costGroupKey` but not
  `upstreamCost/upstreamCostCurrency`.
- Unit: admin priceable catalog returns `costGroupKey`, `upstreamCost`, and
  `upstreamCostCurrency` so quick pricing can split by cost line.
- Unit: public saleable resource search expands customer Chinese country/city aliases into DB conditions and uses `startsWith` for two-letter country code aliases.
- Unit: provider repository applies `enabledCountryCodes` to all same-site provider resources and preserves native provider saleability policy decisions.
- Unit: provider repository re-enables rows hidden by `provider_country_disabled` / `provider_country_not_supported`, but preserves `provider_sale_disabled` rows as hidden manual closures.
- Unit: priceable catalog query includes active/visible/saleable resources and excludes country-only grouping rows.
- Unit: Proxy-Seller geo trees without explicit stock fields derive stock from nested regions/cities/isps leaf counts instead of returning zero.
- Integration: quote endpoint covers default-template price, stock `0` for every provider including Proxy-Seller, missing price, stale inventory, user override priority, and currency mismatch when a real PostgreSQL test DB is available.

### 7. Wrong vs Correct

#### Wrong

```ts
const resource = await resourcesRepo.findById(resourceId);
const price = await pricingRepo.getPriceForUser(siteIdFromQuery, userId, resourceId, days);
const countries = (await resourcesRepo.list(siteId, { publicOnly: true, page: 1, pageSize: 20 })).items;
```

#### Correct

```ts
const resource = await resourcesRepo.findByIdInSite(resourceId, ctx.siteId);
const price = await pricingRepo.getPriceForUser(ctx.siteId, ctx.ownerId, resourceId, days, qty, currency);
const countries = await resourcesRepo.listPublicCountries(ctx.siteId, { publicOnly: true });
```

## Scenario: Static Proxy Order Fulfillment Source Of Truth

### 1. Scope / Trigger

- Trigger: backend code creates static proxy orders, processes `fulfillment_jobs`, writes `upstream_order_mirrors`, writes `proxy_instances`, or refunds failed fulfillment.

### 2. Signatures

- `CreateStaticProxyOrderUseCase.execute(ctx, { resourceId, quantity, durationDays, currency, idempotencyKey, businessType? })`.
- `FulfillStaticProxyUseCase.execute(jobId: string)` -> `{ status: 'NOOP' | 'COMPLETED' | 'RETRYING' | 'FAILED_REFUNDED', ... }`.
- Tables: `orders`, `fulfillment_jobs`, `upstream_order_mirrors`, `proxy_instances`, `wallets`, `ledger_entries`, `audit_logs`.

### 3. Contracts

- `orders` uses a compound unique key on `siteId + tenantId + userId + idempotencyKey`. Business idempotency returns an existing order only inside that same scope.
- Different users or tenants may reuse the same order idempotency key; they must create independent orders and ledgers.
- The debit ledger idempotency key derived from an order must include `siteId + tenantId + userId + idempotencyKey`; never reuse a raw order idempotency key in a globally unique ledger key.
- The fulfillment refund ledger idempotency key must include `siteId + tenantId + userId + orderId + idempotencyKey`. Different users may legitimately share the same order idempotency key, and both failed fulfillments must refund independently.
- Duplicate valid order requests in `PENDING`, `FULFILLING`, or `COMPLETED` return the existing order before quote/wallet checks, so stale inventory or price changes do not break retries.
- Static proxy purchase debits through `debitWalletTx(..., type='DEBIT', reason='static_proxy_order')` in the same transaction that creates `orders(status=PENDING)` and `fulfillment_jobs(status=QUEUED)`.
- Static proxy purchase reads the wallet inside the same transaction as the debit/order/job writes; wallet optimistic-lock conflicts return a visible 409 business error, not a generic internal error.
- Worker fulfillment must claim a queued/retrying job before processing it, and must not create `proxy_instances` until a real adapter response contains exactly the ordered proxy count.
- Worker fulfillment must read `resource_mappings.providerResourceId` for the order resource and pass it into `StaticProxyBuyInput.providerResourceId`. Synced upstream line resources such as `US:<lineId>` must be fulfilled by exact upstream line/tariff id, not downgraded to a country-level order.
- Worker fulfillment returns a typed execution result so the worker can log and aggregate completed, retrying, and final-refunded jobs without treating handled failures as invisible success.
- If upstream `buyStaticProxy` returns `PENDING`, store `upstream_order_mirrors` and retry later with `queryOrder` for the same upstream order; do not call `buyStaticProxy` again for that job.
- Final fulfillment failure must refund through `creditWalletTx(..., type='REFUND', reason='fulfillment_failed_refund')`, update order/job failure state, and write an audit log in one transaction.
- `proxy_instances.password` is encrypted at rest with AES-256-GCM. Customer delivery endpoints decrypt at response/export mapping boundaries only.

### 4. Validation & Error Matrix

- Missing tenant on user order context -> `PERMISSION_DENIED / tenant_required`.
- Missing idempotency key -> `VALIDATION_ERROR / idempotency_key_required`.
- Same idempotency key in a different `siteId + tenantId + userId` scope -> independent order.
- Wallet available `< totalPrice` -> `WALLET_INSUFFICIENT_BALANCE`; no order, job, or debit ledger is created.
- Provider disabled before HTTP call -> retry/final failure path with `UPSTREAM_DISABLED / provider_disabled`.
- Upstream order pending or incomplete proxy count -> retry while attempts remain; no `proxy_instances`.
- Attempts exhausted -> order `FAILED`, job `FAILED`, refund ledger `REFUND`, audit `order.fulfillment_failed`.
- Two orders in different user scopes with the same order idempotency key both exhaust fulfillment attempts -> two distinct `REFUND` ledger rows, no `ledger_idempotency_conflict`.

### 5. Good/Base/Bad Cases

- Good: a second request with the same key for the same user returns the existing pending order without another debit.
- Good: a pending upstream order creates one mirror row and later calls `queryOrder` on that upstream id.
- Good: a synced IPIPD "United States-New York Standard" resource passes its `line-us-ny-standard` mapping into the adapter as `providerResourceId`.
- Base: successful fulfillment creates mirror + encrypted proxies + completed order/job.
- Bad: worker directly updates `wallets.available` or writes `ledger_entries` by hand instead of `creditWalletTx`.
- Bad: using `refund-${order.idempotencyKey}` as the refund ledger key; it collides across users or tenants that reused the same order idempotency key.
- Bad: returning AES ciphertext from `proxy_instances.password` in list/detail/export responses.
- Bad: treating upstream `PENDING` as completed or creating fake proxy rows.

### 6. Tests Required

- Unit: proxy export formats and AES-GCM round trip/tamper failure.
- Unit: fulfillment builds `StaticProxyBuyInput` from the selected order resource and includes `resource_mappings.providerResourceId`.
- Unit: Prisma unique `P2002` for `idempotencyKey` maps to `IDEMPOTENCY_CONFLICT`.
- Worker unit: queued jobs are delegated to `FulfillStaticProxyUseCase` and overlapping polls are skipped.
- Integration with real Postgres: insufficient balance creates no order/job/ledger; successful order creates one order, one debit ledger, one queued job; duplicate key does not double debit; worker success creates encrypted proxies; final worker failure refunds through one `REFUND` ledger.
- Integration with real Postgres: two different users can reuse one order idempotency key and both receive independent fulfillment-failure refunds with distinct ledger idempotency keys.

### 7. Wrong vs Correct

#### Wrong

```ts
await tx.wallets.update({ where: { id: wallet.id }, data: { available: newBalance } });
await tx.proxy_instances.createMany({ data: fakeProxies });
```

#### Correct

```ts
await walletRepo.creditWalletTx(tx, wallet.id, amount, currency, 'REFUND', order.id, 'fulfillment_failed_refund', key);
await proxiesRepo.createMany(tx, realProviderProxies.map((p) => ({ ...p, password: encryptAesGcm(p.password, keyHex) })));
```

## Scenario: Admin Static Proxy Order Failure Operations

### 1. Scope / Trigger

- Trigger: backend code adds or changes admin actions for failed static proxy orders.
- Applies to `OrdersController`, admin order operation use cases, `orders`, `fulfillment_jobs`, `wallets`, `ledger_entries`, and `audit_logs`.

### 2. Signatures

- `POST /api/orders/:id/retry-fulfillment` body `{ reason?: string }`.
- `POST /api/orders/:id/refund` body `{ reason: string }`.
- `POST /api/orders/:id/manual-complete` body `{ reason: string }`.
- Response shape: `{ orderId: string; status: OrderStatus; fulfillmentJobId?: string; wallet?: { available: string; currency: string } }`.

### 3. Contracts

- Only `PLATFORM_ADMIN` and `TENANT_ADMIN` may call these actions. Tenant admins are scoped to their own tenant; platform admins may operate across tenants inside `ctx.siteId`.
- Retry is for unrefunded `FAILED` orders only. It resets `orders.status` to `PENDING`, clears `failReason`, and creates a new `QUEUED` fulfillment job. It must not retry an order that already has a `REFUND` ledger row for `relatedId=order.id`.
- Refund is order-idempotent. Before crediting the wallet, check for an existing `ledger_entries(type='REFUND', relatedId=order.id)`. If it exists, do not credit again; still allow the order status to converge to `REFUNDED`.
- Manual completion is for unrefunded `PENDING`, `FULFILLING`, or `FAILED` orders only. It marks the order `COMPLETED` and may mark the latest fulfillment job `COMPLETED`, but it must not create fake `proxy_instances`.
- All successful mutations write audit rows with actions `order.retry_fulfillment`, `order.refund`, or `order.manual_complete`.

### 4. Validation & Error Matrix

- `USER` caller -> `PERMISSION_DENIED / admin_only`.
- Tenant admin targeting another tenant's order -> scoped lookup returns `NOT_FOUND / order_not_found`.
- Retry a non-`FAILED` order -> `VALIDATION_ERROR / order_not_retryable`.
- Retry or manual-complete an already-refunded order -> `VALIDATION_ERROR / order_already_refunded`.
- Refund a `COMPLETED` order -> `VALIDATION_ERROR / order_not_refundable`.
- Refund/manual-complete without reason -> `VALIDATION_ERROR / reason_required`.

### 5. Good/Base/Bad Cases

- Good: a failed order without refund ledger can be retried and gets one new queued fulfillment job.
- Good: a failed order with an existing refund ledger can be marked `REFUNDED` without another wallet credit.
- Base: manual completion records the admin reason and latest fulfillment job id in audit metadata.
- Bad: retrying a worker-failed order after it has already been refunded, which would fulfill without charging.
- Bad: manual completion that inserts placeholder proxy rows instead of using a real proxy import/instance management flow.

### 6. Tests Required

- Integration: platform admin retry creates a new queued job and writes audit.
- Integration: refund restores wallet balance once across repeated requests and writes one `REFUND` ledger.
- Integration: tenant admin cannot operate another tenant's order.
- Integration: user caller receives 403 and does not mutate jobs.
- Integration: manual completion requires reason, completes the order/job, and writes audit.

### 7. Wrong vs Correct

#### Wrong

```ts
await tx.orders.update({ where: { id }, data: { status: 'PENDING' } });
await tx.fulfillment_jobs.create({ data: { orderId: id, status: 'QUEUED' } });
```

This retries even when the customer has already been refunded, creating a free fulfillment path.

#### Correct

```ts
const refunded = await tx.ledger_entries.findFirst({
  where: { relatedId: order.id, type: 'REFUND' },
});
if (refunded) throw new AppError(ErrorCode.VALIDATION_ERROR, 'order_already_refunded', 422);
```

The refund ledger is part of the order state machine's source of truth.

## Scenario: Admin Order List Upstream Projection

### 1. Scope / Trigger

- Trigger: backend code changes the admin order list or adds columns such as Provider, upstream order number, failure stage, failure error, or cost.
- Applies to `OrdersRepository.listForAdmin`, `OrdersController.list`, `orders`, `fulfillment_jobs`, and `upstream_order_mirrors`.

### 2. Signatures

- `GET /api/orders?page&pageSize&status&tenantId&search`.
- Admin list DTO fields: `{ id, tenantId, tenantCode, tenantName, tenantAdminId, tenantAdminEmail, userId, userEmail, type, status, totalPrice, currency, cost, providerCode, upstreamOrderId, failureStage, failureError, resource, createdAt }`.
- `resource` is `{ id, code, name, displayName, providerCode } | null`.

### 3. Contracts

- `orders` is the source of truth for order id, type, status, amount, currency, and `failReason`.
- `tenants` is the source of truth for subsite code/name. Because `orders` stores only scalar `tenantId`, admin list projections batch-load tenants for the current page instead of adding fake fields or running one query per row.
- `admin_users` with `role='TENANT_ADMIN'` is the source of truth for tenant admin id/email. If multiple active tenant admins exist, use a deterministic first-created projection for list display.
- `users` is the source of truth for customer email.
- `platform_resources` is the source of truth for resource code/name/displayName/providerCode.
- `fulfillment_jobs` is the source of truth for fulfillment Provider, job stage, and `lastError`.
- `upstream_order_mirrors` is the source of truth for upstream order number and mirrored upstream status.
- Provider should prefer the latest upstream mirror provider when present, then fall back to the latest fulfillment job provider.
- Failure stage/error should only be populated for failed orders. Prefer latest job `lastError`, then order `failReason`.
- Upstream cost is not currently persisted. Return `cost: null` and let the UI show a visible "not connected" state; do not invent cost from sale price or provider assumptions.
- Search must cover real persisted fields: order id, user id, user email, resource code/name/displayName, upstream order id, and tenant code/name.
- Missing related data is returned as `null` and displayed visibly by the UI; it must not be replaced with placeholder business data.

### 4. Validation & Error Matrix

- Order with a mirror -> show `providerCode` and `upstreamOrderId` from `upstream_order_mirrors`.
- Order with only a queued job -> show job `providerCode`, null upstream order id.
- Order with tenant/user/resource rows -> show tenant code/name, tenant admin email, customer email, and resource projection from those tables.
- Failed order with job last error -> show job status/error.
- Failed order without job last error -> show order `failReason`.
- Non-failed order -> failure stage/error are null even if old job/mirror text exists.
- Missing cost storage -> `cost: null`, not `0`.
- Tenant admin passing another `tenantId` query -> still sees only their own tenant orders.
- Search by customer email, resource display name, upstream order id, or tenant code/name -> returns matching scoped orders.

### 5. Good/Base/Bad Cases

- Good: an empty pending order row displays the Provider selected for fulfillment but leaves upstream order number blank.
- Good: a provider failure can be found by searching its upstream order id or last error text.
- Good: admin order rows show customer email, subsite code/name, tenant admin email, resource display name, provider, upstream order id, and latest failure reason from persisted rows.
- Base: completed orders with a mirror display the upstream order number for reconciliation.
- Bad: showing `0` cost, which makes margin look real when no upstream cost exists.
- Bad: deriving Provider from a resource name in the frontend instead of reading the latest job/mirror projection.
- Bad: returning only raw `orders` rows while UI silently falls back to IDs for every related field.

### 6. Tests Required

- Repository unit: mirror provider/upstream order id override job provider in the DTO.
- Repository unit: job provider is used when no mirror exists.
- Repository unit: failed order maps `failureStage/failureError` and non-failed order leaves them null.
- Integration: admin order list returns tenant/user/resource/provider/upstream/failure projection fields.
- Integration: tenant admin order list remains scoped to the effective tenant even when another `tenantId` is passed.
- Integration: search covers user email, resource display name, upstream order id, and tenant code/name.
- Repository unit: search `where.OR` covers order id, user id, user email, resource fields, upstream order id, and tenant fields.
- Frontend component: admin order table renders the configured columns and displays `cost: null` as not connected.

### 7. Wrong vs Correct

#### Wrong

```ts
return {
  providerCode: order.resource.name,
  upstreamOrderId: '',
  cost: '0',
};
```

This invents Provider and cost state and hides missing upstream reconciliation data.

#### Correct

```ts
const latestJob = order.fulfillment_jobs[0];
const latestMirror = order.upstream_order_mirrors[0];
return {
  providerCode: latestMirror?.providerCode ?? latestJob?.providerCode ?? null,
  upstreamOrderId: latestMirror?.upstreamOrderId ?? null,
  cost: null,
};
```

The admin list is a read model over real order, fulfillment, and upstream mirror tables.

## Scenario: Admin Order Fulfillment Detail Projection

### 1. Scope / Trigger

- Trigger: backend or frontend code changes the order detail drawer opened from the admin order list or wallet ledger.
- Applies to `OrdersRepository.getFulfillmentDetail`, `OrdersController.getFulfillment`, `fulfillment_jobs`, `upstream_order_mirrors`, `proxy_instances`, `audit_logs`, and the admin/customer-facing fulfillment detail component.

### 2. Signatures

- `GET /api/orders/:id/fulfillment`.
- Response fields: `{ taskStatus, upstreamImage, proxies, operationLogs }`.
- `operationLogs[]`: `{ id, action, actorType, actorId, reason, requestId, meta, createdAt }`.

### 3. Contracts

- `fulfillment_jobs` is the source of truth for the latest task status and fallback Provider.
- `upstream_order_mirrors` is the source of truth for upstream order image text when mirrored rows exist.
- `proxy_instances` is the source of truth for delivered proxy rows.
- `audit_logs` with `targetType='orders'` and `targetId=orderId` is the source of truth for order operation logs.
- The detail endpoint must return `operationLogs: []` when there are no logs; it must not omit the field in new backend responses.
- Frontend detail rendering should normalize optional arrays before reading `.length`, so an older backend response cannot crash the entire admin page.

### 4. Validation & Error Matrix

- Missing or out-of-scope order -> `NOT_FOUND / order_not_found` before reading fulfillment detail.
- Order with no fulfillment job -> `taskStatus: 'QUEUED'`, empty upstream image, empty proxy list, real audit logs if present.
- Order with no audit rows -> `operationLogs: []`.
- Older response missing `operationLogs` -> frontend shows the no-log empty state, not a route error boundary.

### 5. Good/Base/Bad Cases

- Good: detail drawer shows admin assisted-purchase, retry, refund, manual-complete, and worker failure audit rows from `audit_logs`.
- Base: a newly queued order with no logs still renders the drawer and empty operation-log state.
- Bad: frontend reads `query.data.operationLogs.length` without response normalization.
- Bad: backend returns only fulfillment rows while the frontend assumes operation logs exist.

### 6. Tests Required

- Integration: `GET /api/orders/:id/fulfillment` returns audit rows for the scoped order.
- Frontend component: detail drawer renders operation logs when present.
- Frontend regression: detail drawer still renders a no-log state when the response has no `operationLogs` field.

### 7. Wrong vs Correct

#### Wrong

```tsx
query.data.operationLogs.length
```

This crashes the route if the response contract is incomplete or an old backend is still running.

#### Correct

```tsx
const logs = Array.isArray(data.operationLogs) ? data.operationLogs : [];
```

The backend owns the complete detail projection, and the frontend normalizes arrays before rendering.

## Scenario: Admin Assisted Static Proxy Purchase Source Of Truth

### 1. Scope / Trigger

- Trigger: backend code lets an admin create a static proxy order on behalf of a customer.
- Applies to `OrdersController`, `CreateStaticProxyOrderUseCase`, `UsersRepository`, `orders`, `fulfillment_jobs`, `wallets`, `ledger_entries`, `audit_logs`, OpenAPI export, and generated contracts.

### 2. Signatures

- Customer self-service: `POST /api/orders/static-proxy` body `{ resourceId, quantity, durationDays, currency, idempotencyKey, businessType? }`.
- Admin assisted purchase: `POST /api/orders/users/:userId/static-proxy` body `{ resourceId, quantity, durationDays, currency, idempotencyKey, businessType?, reason }`.
- Use case entry points:
  - `CreateStaticProxyOrderUseCase.execute(ctx, input)` for `USER` callers.
  - `CreateStaticProxyOrderUseCase.executeForAdmin(ctx, targetUserId, input)` for `PLATFORM_ADMIN` and `TENANT_ADMIN` callers.

### 3. Contracts

- The target user row is the source of truth for `siteId`, `tenantId`, and `userId`. Admin assisted purchase must load it from `users` scoped by `ctx.siteId`; clients must not submit tenant or site ids.
- `PLATFORM_ADMIN` may create orders for any user in the current site. `TENANT_ADMIN` may create orders only for users in `ctx.tenantId`. `USER` and `SYSTEM` callers are denied.
- Quote, wallet debit, order ownership, ledger entry, and fulfillment job must all use the target user's identity, not the admin actor id.
- The admin actor is recorded only in `audit_logs`: `actorType='ADMIN_USER'`, `actorId=ctx.ownerId`, `action='order.admin_create'`, `tenantId=targetUser.tenantId`, `reason=input.reason`, and `meta.targetUserId=targetUser.id`.
- The debit, order, fulfillment job, and audit row belong in one transaction. Do not allow a created order without the matching admin audit trail.
- `orders.idempotencyKey` is scoped by `siteId + tenantId + userId`. A duplicate assisted purchase returns the existing order only for the same target user; reuse for another target user creates an independent order and debit.

### 4. Validation & Error Matrix

- `USER` or `SYSTEM` caller -> `PERMISSION_DENIED / admin_only`.
- Tenant admin targeting another tenant's user -> `TENANT_SCOPE_VIOLATION / tenant_access_denied`.
- Target user missing in current site -> `NOT_FOUND / user_not_found`.
- Blank or missing admin `reason` -> `VALIDATION_ERROR / reason_required`; no wallet, order, job, or audit mutation.
- Missing idempotency key -> `VALIDATION_ERROR / idempotency_key_required`.
- Same target user + same idempotency key + existing `PENDING`, `FULFILLING`, or `COMPLETED` order -> return existing order, no second debit.
- Different target user/tenant + same idempotency key -> `IDEMPOTENCY_CONFLICT / order_idempotency_conflict`.

### 5. Good/Base/Bad Cases

- Good: platform admin posts to `/api/orders/users/:userId/static-proxy`, the customer's wallet is debited once, the order belongs to the customer, and audit metadata identifies the admin and target user separately.
- Good: tenant admin can assist a user in the same tenant and gets a tenant-scope error for another tenant's user before quote or wallet access.
- Base: a duplicate browser submit returns the existing order and leaves one `DEBIT` ledger row.
- Bad: calling `QuoteUseCase` or `WalletRepository` with `ctx.ownerId` on an admin request, which prices and debits the admin instead of the customer.
- Bad: writing the admin audit log after the transaction; a DB failure there would create an unaudited admin-assisted order.

### 6. Tests Required

- Integration with real Postgres: platform admin success asserts target wallet debit, order owner, queued fulfillment job, and `order.admin_create` audit fields.
- Integration with real Postgres: tenant admin same-tenant success and cross-tenant denial.
- Integration with real Postgres: user caller receives 403 and no order is created.
- Integration with real Postgres: blank reason returns `VALIDATION_ERROR / reason_required` and leaves wallet/orders unchanged.
- Integration with real Postgres: duplicate idempotency key for the same user does not double debit, and reuse for another user returns `IDEMPOTENCY_CONFLICT`.
- Contracts: run `pnpm --filter @ipeasy/api export:openapi`, `pnpm --filter @ipeasy/contracts generate`, and `pnpm --filter @ipeasy/contracts typecheck` after route/DTO changes.

### 7. Wrong vs Correct

#### Wrong

```ts
await quoteUseCase.execute({
  siteId: ctx.siteId,
  tenantId: ctx.tenantId!,
  userId: ctx.ownerId,
  resourceId,
  durationDays,
  quantity,
  currency,
});
```

This treats the admin actor as the buyer, so pricing, wallet debit, and order ownership drift from the target customer.

#### Correct

```ts
const targetUser = await usersRepo.findOrderContextByIdInSite(targetUserId, ctx.siteId);
assertTenantAccess(ctx, targetUser.tenantId);
await quoteUseCase.execute({
  siteId: targetUser.siteId,
  tenantId: targetUser.tenantId,
  userId: targetUser.id,
  resourceId,
  durationDays,
  quantity,
  currency,
});
```

The target user owns the business purchase while the admin actor is preserved separately in audit logs.

## Scenario: Admin Customer Management Operations Source Of Truth

### 1. Scope / Trigger

- Trigger: backend code lists admin customer rows, creates customer users, changes customer status, resets passwords, issues impersonation sessions, deletes customers, or exposes per-user pricing/wallet/order operations from the admin users surface.
- Applies to `UsersController`, `UsersRepository`, `CreateUserUseCase`, `AdminUserOperationsUseCase`, `WalletAdjustUseCase`, pricing user binding/override APIs, `users`, `wallets`, `sessions`, `orders`, `proxy_instances`, `ledger_entries`, `user_price_bindings`, `user_resource_price_overrides`, and `audit_logs`.

### 2. Signatures

- `GET /api/users?page&pageSize&search&status&tenantId` -> `PageResult<AdminUserListItem>`.
- `POST /api/users` body `{ email, password, tenantId? }`.
- `POST /api/users/:id/status` body `{ status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' }`.
- `POST /api/users/:id/reset-password` body `{ password }`.
- `POST /api/users/:id/impersonate` -> `{ token, expiresAt }`.
- `DELETE /api/users/:id` -> `{ id }`.
- Related real operations launched from the same UI:
  - `POST /api/wallet/:userId/adjust`
  - `POST /api/orders/users/:userId/static-proxy`
  - `POST /api/pricing/user-template-bindings`
  - `POST /api/pricing/user-overrides`

### 3. Contracts

- The admin users table is a real database projection. It may aggregate wallet balance, order count, proxy count, and price template in one list query, but it must not synthesize balances, counts, roles, or pricing labels.
- `users` are customer accounts only in the current schema. The admin UI may display a fixed customer role, but there is no mutable user-role operation until a role field and permission model are designed.
- `PLATFORM_ADMIN` may list and operate users in the current `siteId`; `TENANT_ADMIN` is scoped to `ctx.tenantId`. `USER` and `SYSTEM` callers are denied.
- Creating a user must create the user, initial wallet, and `users.create` audit row in one transaction.
- Setting a non-`ACTIVE` status must revoke active user sessions and write `users.update_status` audit.
- Resetting a password must hash the new password, revoke active user sessions, and write `users.reset_password` audit.
- Impersonation must issue an opaque short-lived `USER` session token for an `ACTIVE` scoped user, store only its SHA-256 hash, and write `users.impersonate` audit.
- Delete is intentionally limited to empty customer records. A customer with orders, proxies, payment orders, tickets, or ledger entries must return `VALIDATION_ERROR / user_has_business_records`; do not cascade-delete business history.
- Wallet adjustment, assisted ordering, and pricing updates remain owned by their respective wallet, order, and pricing use cases. User management may launch them but must not duplicate their DB writes.

### 4. Validation & Error Matrix

- Non-admin caller -> `PERMISSION_DENIED / admin_only` or `insufficient_permissions`.
- Tenant admin targeting another tenant's customer -> scoped lookup returns `NOT_FOUND / user_not_found` or the domain-specific tenant error before mutation.
- Invalid status -> `VALIDATION_ERROR / user_status_invalid`.
- Reset password shorter than 8 characters -> `VALIDATION_ERROR / password_too_weak`; no hash, session revoke, or audit write.
- Impersonate missing or suspended/banned user -> `NOT_FOUND / user_not_found`; no session row.
- Delete customer with business records -> `VALIDATION_ERROR / user_has_business_records`; no related rows are deleted.
- Duplicate email on create -> `VALIDATION_ERROR / email_taken`.

### 5. Good/Base/Bad Cases

- Good: the admin customer list shows wallet, order count, proxy count, and price template from one scoped Prisma query.
- Good: disabling a customer revokes their current user sessions in the same transaction as the status/audit update.
- Good: support can impersonate a customer through a real user session while the audit log keeps the admin actor.
- Base: a newly created customer with no business records can be deleted during onboarding cleanup.
- Bad: adding a "set role" button that writes no database state or stores a role only in frontend state.
- Bad: deleting users with historical orders or ledger rows to make the table look clean.
- Bad: returning a plaintext impersonation token from storage; only the one-time response may contain the plaintext session token.

### 6. Tests Required

- Use-case tests: non-admin denial, status validation, password length validation, active-only impersonation, and scoped repository calls.
- Repository or integration tests: create user writes wallet and audit in one transaction; non-active status revokes sessions; delete rejects customers with business records; delete empty user removes only safe related rows.
- Security tests: impersonation stores a token hash and creates a `USER` session with an expiry.
- Frontend contract tests: user row actions call the real endpoints above and show backend `reasonKey` on failure.

### 7. Wrong vs Correct

#### Wrong

```ts
return {
  ...user,
  role: 'vip',
  wallet: { available: '0', frozen: '0', currency: 'CNY' },
};
```

This fabricates role and wallet state that are not owned by the `users` table or wallet domain.

#### Correct

```ts
const users = await prisma.users.findMany({
  where: scopedWhere,
  select: {
    id: true,
    email: true,
    status: true,
    wallets: { take: 1, select: { available: true, frozen: true, currency: true } },
    user_price_bindings: { take: 1, select: { template: { select: { id: true, name: true } } } },
    _count: { select: { orders: true, proxy_instances: true } },
  },
});
```

The list projection reads real source-of-truth tables and only maps them into DTO fields.

#### Wrong

```ts
await tx.users.delete({ where: { id: user.id } });
```

Deleting a customer without checking business history can remove the owner of orders, ledgers, tickets, or delivered proxies.

#### Correct

```ts
const [orders, proxies, payments, tickets, ledgerEntries] = await Promise.all([
  tx.orders.count({ where: { userId: user.id } }),
  tx.proxy_instances.count({ where: { userId: user.id } }),
  tx.payment_orders.count({ where: { userId: user.id } }),
  tx.tickets.count({ where: { userId: user.id } }),
  tx.ledger_entries.count({ where: { wallet: { userId: user.id } } }),
]);
if (orders || proxies || payments || tickets || ledgerEntries) {
  throw new AppError(ErrorCode.VALIDATION_ERROR, 'user_has_business_records', 422);
}
```

Empty-user deletion is an onboarding cleanup path, not a business-history deletion path.

## Scenario: Static Proxy Lifecycle Source Of Truth

### 1. Scope / Trigger

- Trigger: backend code renews a static proxy, changes proxy auth, switches proxy IP, maps provider proxy delivery, or changes `proxy_instances`.
- Applies to customer lifecycle endpoints, `ProxyLifecycleService`, provider adapters, fulfillment writes, export/list DTO mapping, and migrations that affect static proxy delivery.

### 2. Signatures

- DB: `proxy_instances.upstreamProxyId String?`.
- Delivery DTO from providers: `ProxyDelivery.upstreamProxyId?: string`.
- Adapter methods:
  - `renewStaticProxy(input: { upstreamProxyId: string; durationDays?: number; idempotencyKey?: string }, config)`.
  - `changeProxyPassword(input: { upstreamProxyId: string }, config)`.
  - `switchProxyIp(input: { upstreamProxyId: string }, config)`.
- Customer APIs:
  - `POST /api/proxies/:id/renew` body `{ durationDays: number; idempotencyKey?: string }`.
  - `POST /api/proxies/:id/change-password` body `{}`.
  - `POST /api/proxies/:id/switch-ip` body `{}`.
- Customer batch APIs:
  - `POST /api/proxies/batch-renew` body `{ proxyIds: string[]; durationDays: number; idempotencyKey?: string }`.
  - `POST /api/proxies/batch-change-password` body `{ proxyIds: string[] }`.
  - `POST /api/proxies/batch-switch-ip` body `{ proxyIds: string[] }`.
- Batch response: `{ totalCount: number; successCount: number; failureCount: number; items: BatchProxyLifecycleItem[] }`.
- Batch success item: `{ proxyId: string; success: true; proxy: CustomerProxyDeliveryDto }`.
- Batch failure item: `{ proxyId: string; success: false; error: { code: string; reasonKey: string; httpStatus: number } }`.

### 3. Contracts

- `proxy_instances.id` is the local delivery id. It must never be sent to an upstream lifecycle API as the upstream proxy id.
- `proxy_instances.upstreamProxyId` is the source of truth for upstream lifecycle operations. It is written from `ProxyDelivery.upstreamProxyId` during fulfillment or order query completion.
- Provider adapters own upstream field mapping. For `UPSTREAM_API`, map `proxy_id` (or a documented equivalent) into `ProxyDelivery.upstreamProxyId`.
- `ProxyLifecycleService` owns user ownership checks, provider config lookup, adapter capability checks, and local proxy updates after a lifecycle operation.
- `BatchProxyLifecycleUseCase` owns only batch input validation, sequential item orchestration, and result aggregation. It must call `RenewProxyUseCase`, `ChangePasswordUseCase`, or `SwitchIpUseCase` per proxy id instead of calling repositories, provider adapters, or `ProxyLifecycleService` directly.
- Batch renew idempotency is item-scoped: when the request has `idempotencyKey`, each single-item renew call receives `${idempotencyKey}:${proxyId}`.
- Batch lifecycle failures are item-level for valid batch requests. A single `AppError` maps to item `error={ code, reasonKey, httpStatus }` and must not stop later proxy ids.
- If a lifecycle adapter returns a new `ProxyDelivery`, update local IP, port, username, AES-GCM encrypted password, protocol, country, expiry, status, and `upstreamProxyId` when returned.
- Customer DTO/export paths decrypt passwords only at response boundaries; stored passwords remain encrypted.

### 4. Validation & Error Matrix

- Missing proxy or proxy owned by another user -> `NOT_FOUND / proxy_not_found`.
- Missing `proxy_instances.upstreamProxyId` -> `UNSUPPORTED_CAPABILITY / upstream_proxy_id_missing`.
- Missing or disabled provider config -> `UPSTREAM_DISABLED / provider_disabled`.
- Adapter method not implemented -> `UNSUPPORTED_CAPABILITY / <action>_not_supported`.
- Upstream envelope with known business code such as `UNSUPPORTED_CAPABILITY` -> preserve that `ErrorCode` and reason key.
- Unknown upstream envelope code -> `UPSTREAM_ERROR / <upstream msg>`.
- Batch request with missing, non-array, or empty `proxyIds` -> global `VALIDATION_ERROR / proxy_ids_required` before any single-item use case call.
- Batch request with a blank or non-string proxy id -> global `VALIDATION_ERROR / proxy_id_invalid` before any single-item use case call.
- Batch renew with non-positive or non-integer `durationDays` -> global `VALIDATION_ERROR / duration_days_invalid` before any single-item use case call.
- Batch item `AppError` -> item failure with `code/reasonKey/httpStatus`; subsequent proxy ids are still attempted.

### 5. Good/Base/Bad Cases

- Good: `switch-ip` loads the local proxy by `:id`, checks `userId`, then calls the adapter with `proxy.upstreamProxyId`.
- Good: `change_auth` response with a new username/password updates local encrypted delivery and returns a user DTO with decrypted fields.
- Good: `batch-switch-ip` loops through proxy ids and calls `SwitchIpUseCase.execute(ctx, proxyId)`, preserving each single-item audit/error contract.
- Base: `renew` returns no proxy payload; local delivery remains unchanged and the existing proxy is returned.
- Base: a valid batch request can return both successful proxy delivery DTOs and item-level unsupported capability failures in one response.
- Bad: calling `/res_static/switch_ip` with `proxy_instances.id`.
- Bad: batch lifecycle code directly reads `proxy_instances` or calls provider adapters, duplicating ownership checks, audit behavior, or upstream capability mapping.
- Bad: hiding a missing upstream proxy id behind a successful no-op.
- Bad: returning provider ciphertext or stored AES-GCM ciphertext in customer list/export APIs.

### 6. Tests Required

- Unit: fulfillment maps provider `ProxyDelivery.upstreamProxyId` into `proxy_instances.upstreamProxyId`.
- Unit: provider adapter lifecycle methods assert path, body, response mapping, and known envelope error preservation.
- Unit: lifecycle service covers user mismatch, missing upstream id, unsupported adapter method, disabled provider, and successful local delivery update with encrypted password.
- Unit: batch lifecycle use case covers mixed success/failure aggregation, invalid `proxyIds`, invalid `durationDays`, item-level `AppError` mapping, and item-scoped renew idempotency keys.
- Controller/API: lifecycle endpoints return the same customer delivery DTO shape as list/export boundaries.
- Controller/API: batch lifecycle endpoints decrypt only successful proxy DTOs at the response boundary and preserve failure item error objects.
- Frontend: customer row actions call real lifecycle endpoints and show backend reason keys for unsupported actions.

### 7. Wrong vs Correct

#### Wrong

```ts
await adapter.switchProxyIp({ upstreamProxyId: proxy.id }, config);
return proxy;
```

This sends a local id to the upstream and converts a missing capability into a fake success.

#### Correct

```ts
if (!proxy.upstreamProxyId) {
  throw new AppError(ErrorCode.UNSUPPORTED_CAPABILITY, 'upstream_proxy_id_missing', 422);
}
const result = await adapter.switchProxyIp({ upstreamProxyId: proxy.upstreamProxyId }, config);
```

The service uses the persisted upstream id and fails visibly when lifecycle operations cannot be real.

#### Wrong

```ts
for (const proxyId of proxyIds) {
  const proxy = await proxiesRepo.findById(proxyId);
  await providerAdapter.switchProxyIp({ upstreamProxyId: proxy.upstreamProxyId }, config);
}
```

This bypasses the single-item use case, so ownership checks, audit writes, provider config selection, and error mapping can drift.

#### Correct

```ts
for (const proxyId of proxyIds) {
  items.push(await switchIpUseCase.execute(ctx, proxyId));
}
```

The batch layer is orchestration only; the single-item lifecycle use case remains the source of truth for lifecycle behavior.

## Scenario: Static Proxy Search And Renewal Filters

### 1. Scope / Trigger

- Trigger: backend code lists static proxy instances for customers or admins, implements renewal search, or changes `GET /api/proxies` query behavior.
- Applies to `ProxiesController`, `ProxiesRepository.findByUserId`, `ProxiesRepository.listForAdmin`, and `/res_static/ip_list` when it reuses repository filters.

### 2. Signatures

- Customer API: `GET /api/proxies?page&pageSize&status&countryCode&search&from&to`.
- Admin API: `GET /api/proxies?page&pageSize&tenantId&userId&orderId&countryCode&status&search&from&to`.
- OpenAPI: `POST /res_static/ip_list` body `{ page?, page_size?, status?, country_code?, search?, from?, to? }`, with `country_code` mapped to repository `countryCode`.
- Repository query type: `ProxyListQuery = PageQueryDto & { tenantId?: string; userId?: string; countryCode?: string; orderId?: string; status?: ProxyStatus }`.
- Date range source: `from/to` map to `proxy_instances.expiresAt`, not `createdAt`.

### 3. Contracts

- Customer lists are always scoped by `ctx.ownerId + ctx.siteId + ctx.tenantId`; query parameters must not override user/site/tenant ownership.
- Admin lists are scoped by `ctx.siteId` and either `ctx.tenantId` for tenant admins or optional `tenantId` for platform admins.
- Customer search must cover `ip`, `orderId`, `upstreamProxyId`, and `countryCode`.
- Admin search must cover `ip`, `orderId`, `upstreamProxyId`, `countryCode`, and `userId`.
- `countryCode` and `status` filters are exact matches for both customer/admin lists; admin-only `orderId` and `userId` filters are exact matches.
- `/res_static/ip_list` owns only the boundary mapping from snake_case request fields to repository query fields; repository remains the source of truth for filtering and date validation.
- Invalid `from/to` dates return `VALIDATION_ERROR`, not a Prisma validation failure or an empty result.

### 4. Validation & Error Matrix

- `countryCode=HK` -> exact `where.countryCode='HK'`.
- `search=ORD` -> Prisma `OR` over the fields defined above.
- `from=2026-07-01&to=2026-07-31` -> `where.expiresAt={ gte, lte }`.
- Invalid `from` -> `VALIDATION_ERROR / from_invalid`.
- Invalid `to` -> `VALIDATION_ERROR / to_invalid`.
- DB outage/table missing -> propagate to global exception handling; do not return an empty page.

### 5. Good/Base/Bad Cases

- Good: customer "My proxies" country filter and search box map to real DB conditions.
- Good: admin renewal search can locate a proxy by local order id or upstream proxy id.
- Base: no filters returns the scoped page ordered by `createdAt desc`.
- Bad: front-end sends `countryCode`, but repository only searches by IP.
- Bad: treating `from/to` as `createdAt` for a renewal search that should find soon-to-expire proxies.
- Bad: invalid date falls through to Prisma validation and returns a generic internal error.

### 6. Tests Required

- Unit: repository customer filter test asserts exact `where` for country, status, search, and expiry range.
- Unit: repository admin filter test asserts exact `where` for tenant, user, order id, search, and expiry range.
- Unit: OpenAPI `ip_list` controller test asserts `country_code/search/from/to` are passed to `findByUserId` and response mapping still decrypts only at the boundary.
- Unit: invalid `from/to` dates throw `VALIDATION_ERROR` before Prisma is called.
- Controller regression: customer DTO still decrypts passwords and admin DTO still omits password fields.

### 7. Wrong vs Correct

#### Wrong

```ts
if (query.search) where.ip = { contains: query.search, mode: 'insensitive' };
```

This makes order-number and upstream-instance renewal searches silently fail.

#### Correct

```ts
where.OR = [
  { ip: contains },
  { orderId: contains },
  { upstreamProxyId: contains },
  { countryCode: contains },
];
```

The repository owns the complete proxy search contract and keeps UI/API behavior aligned.

## Scenario: Customer API Key Naming And Simplified Creation

### 1. Scope / Trigger

- Trigger: backend code creates, lists, migrates, or maps customer-visible API keys.
- Applies to `api_keys`, `ApiKeysRepository`, `CreateApiKeyUseCase`, `ListApiKeysUseCase`, and the customer API key feature.

### 2. Signatures

- DB: `api_keys.name String`.
- Create API: `POST /api/api-keys` body `{ tenantId: string; name: string; scopes: string[]; ipWhitelist?: string[] }`.
- Customer UI simplified body: `{ tenantId, name, scopes: ['res_static:*'], ipWhitelist: [] }`.
- List/create DTOs include `{ id, name, keyPrefix, scopes, ipWhitelist, status, createdAt, ... }`.

### 3. Contracts

- `api_keys.name` is the source of truth for the customer-facing label. Do not keep a separate frontend-only name.
- Customer self-service UI only asks for the API Key name. Scope and IP whitelist customization are not part of the normal customer create flow.
- The customer UI submits the default static-proxy scope `res_static:*` and an empty `ipWhitelist`; a future whitelist flow must be explicit and backend-backed.
- Backend still validates tenant ownership through `AuthenticatedContext`; the client-supplied `tenantId` is not trusted beyond matching `ctx.tenantId`.
- Backend must return `name` in both create and list responses so the customer table can identify keys without exposing `keyHash` or `plainKey`.

### 4. Validation & Error Matrix

- Blank customer UI name -> frontend validation error / no request.
- Missing/blank backend `name` -> `VALIDATION_ERROR / api_key_name_required`; no key, audit row, or secret is created.
- `name.length > 80` -> `VALIDATION_ERROR / api_key_name_too_long`.
- Empty or non-array `scopes` -> `VALIDATION_ERROR / api_key_scopes_required`.
- Caller tenant differs from body tenant -> `PERMISSION_DENIED / insufficient_permissions`.
- List response -> no `keyHash`, no stored secret, no `plainKey`; only create response may include one-time `plainKey`.

### 5. Good/Base/Bad Cases

- Good: customer enters `Order automation`, the row stores and displays `Order automation`, and the create payload carries `scopes: ['res_static:*']`.
- Base: an existing key created before the name field exists receives the migration default name, but new requests must provide a real name.
- Bad: customer create modal exposes raw scope strings and IP whitelist tags, making a normal key creation look like an operator task.
- Bad: storing the user-entered name only in React state or table decoration, which breaks refresh and list consistency.

### 6. Tests Required

- Frontend component test: customer creates a key by entering only a name; payload includes default `res_static:*` and empty `ipWhitelist`.
- Backend integration test: create persists and returns `name`, stores only the key hash, and list returns `name` without secret fields.
- Use-case test: create trims/requires `name`, list DTO includes `name`, and both still exclude `keyHash` / stored secrets.

### 7. Wrong vs Correct

#### Wrong

```tsx
<Select mode="tags" name="scopes" />
<Select mode="tags" name="ipWhitelist" />
```

This exposes internal permission and network concepts to normal customers.

#### Correct

```tsx
buildCreateApiKeyBody({ tenantId, name });
// -> { tenantId, name: name.trim(), scopes: ['res_static:*'], ipWhitelist: [] }
```

The customer names the key; the product owns the standard permission profile.

## Scenario: Manual Resource Inventory Writes

### 1. Scope / Trigger

- Trigger: backend code needs to let operators set a resource's stock manually from the admin provider/resource surface.
- Applies to `ResourcesController`, `ResourcesRepository`, `inventory_snapshots`, and any admin provider resource configurator that persists stock.

### 2. Signatures

- API: `PUT /api/resources/:id/inventory`
- Body: `{ stock: number; freshnessTtlSeconds?: number }`
- Response: latest inventory snapshot with `stock`, `capturedAt`, `freshnessTtlSeconds`, and `isStale`

### 3. Contracts

- Manual inventory writes must create a new `inventory_snapshots` row. They must not mutate `platform_resources.stock`.
- `stock` is a non-negative integer and is stored exactly as entered.
- `freshnessTtlSeconds` is optional; when omitted, the repository default applies. When supplied, it must be a positive integer in seconds.
- The latest snapshot remains the source of truth for public inventory freshness and buyability checks.

### 4. Validation & Error Matrix

- Missing resource -> `NOT_FOUND / resource_not_found`
- Negative stock or fractional stock -> `VALIDATION_ERROR / inventory_stock_invalid`
- Invalid TTL -> `VALIDATION_ERROR / inventory_ttl_invalid`
- Non-admin caller -> `PERMISSION_DENIED / insufficient_permissions`

### 5. Good/Base/Bad Cases

- Good: admin sets `stock=93`, backend writes a new snapshot, and public inventory reads the new value.
- Base: inventory writes remain optional; sync can still refresh the same resource later.
- Bad: storing stock only in React state or a resource row field and treating it as the live inventory source.

### 6. Tests Required

- Controller test: admin inventory write calls `upsertInventorySnapshot` with the resource's provider code.
- Controller test: negative stock is rejected before repository writes.
- Regression: inventory freshness still comes from the latest snapshot.

### 7. Wrong vs Correct

#### Wrong

```ts
await prisma.platform_resources.update({ where: { id }, data: { stock: 93 } });
```

#### Correct

```ts
await resourcesRepo.upsertInventorySnapshot({
  siteId: ctx.siteId,
  resourceId: resource.id,
  providerCode: resource.providerCode,
  stock: 93,
  capturedAt: new Date(),
});
```

The latest snapshot is the inventory source of truth; the resource row is not.
