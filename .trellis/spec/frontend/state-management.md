# State Management

> How state is managed in this project.

---

## Overview

There is **no global client-state store** (no Redux/Zustand/Context store).
State falls into three buckets, each with one home:

- **Server state** → TanStack Query (`useQuery`/`useMutation`). The source of
  truth lives on the backend; the client caches and re-reads it.
- **Local UI state** → `useState` inside the feature (pagination, selected rows,
  open drawers, inline error strings).
- **URL state** → TanStack Router route params (`$tenantId`) and route guards.

Derived values (role checks, path prefixes) are computed inline from query data;
they are not stored.

Server-state request caching belongs to TanStack Query. Do not add module-level
`Map`, `Promise`, or array caches around API fetchers; those caches outlive a
component tree, bypass query invalidation, and can leak data between tests,
tenants, users, currencies, or search inputs.

---

## State Categories

| Category | Tool | Examples |
|----------|------|----------|
| Server state | TanStack Query | lists, detail records, `/api/auth/me` identity |
| Local UI state | `useState` | `page`, `pageSize`, `selectedRowKeys`, `serverError`, drawer open flags |
| URL state | TanStack Router | `$tenantId` params, auth redirects in `beforeLoad` |
| Form state | antd `Form` / React Hook Form | field values, validation |

---

## When to Use Global State

Effectively never — there is no global store. Cross-page shared data (the current
admin's role and tenant) is **server state** fetched via `useCurrentAdmin()` and
cached by React Query under `['auth', 'me', 'admin']`, not promoted into a global
store. If multiple components need the same server data, share the query key and
let React Query dedupe; do not lift it into module-level state or module-level
request caches.

---

## Server State

<!-- How server data is cached and synchronized -->

### Convention: React Query Owns Request Caches

**What**: Feature API fetchers may build request paths and normalize responses,
but must not keep module-level caches for server data. Use a complete query key
and let TanStack Query own in-flight dedupe, stale time, garbage collection, and
invalidation.

**Why**: Module-level caches survive component unmounts and test render cleanup.
They can return stale resource, wallet, auth, pricing, or tenant data after the
backend source of truth has changed, and they bypass the query key that documents
the cache boundary.

**Example**:

```typescript
// Bad: this cache survives tests and ignores QueryClient invalidation.
const resourceListCache = new Map<string, Promise<ResourceDto[]>>();

async function fetchResources(currency: string, search: string) {
  const key = `${currency}:${search}`;
  if (!resourceListCache.has(key)) {
    resourceListCache.set(key, userApiRequest(`/api/resources?currency=${currency}&search=${search}`));
  }
  return resourceListCache.get(key)!;
}

// Good: the query key is the cache contract.
const resourcesQuery = useQuery({
  queryKey: ['resources-list', currency, durationDays, normalizedSearch],
  queryFn: () => fetchResources(currency, normalizedSearch),
  staleTime: 2 * 60 * 1000,
});
```

**Tests Required**: When a feature query has currency, search, tenant, owner, or
permission inputs, component tests should assert the outgoing request path and
should be able to render separate mocked responses without module cache leakage.

### Scenario: Admin Quick Price Summary-First Loading

#### 1. Scope / Trigger
- Trigger: the admin resource page opens the country/region quick pricing modal
  for the saleable priced catalog.
- Applies to `admin-resources/resource-tree.feature.tsx` and the backend
  endpoints that feed its quick-pricing selector.
- Other selectors may still use `shared/resource/use-priceable-catalog.ts`, but
  the resource-management quick-pricing modal must not use that hook to
  background-load the whole catalog.

#### 2. Signatures
- Country summary:
  `GET /api/resources/priceable-catalog/summary?page=<n>&pageSize=20&search=<term>&durationDays=30`
- Selected-country groups:
  `GET /api/resources/priceable-catalog/groups?countryCode=<CC>&page=<n>&pageSize=20&durationDays=30`
- Bulk save:
  `POST /api/pricing/resource-group-overrides`
- Summary query key:
  `['resources', 'quick-price-catalog', 'summary', durationDays, page, search]`
- Group query key:
  `['resources', 'quick-price-catalog', 'groups', durationDays, countryCode, page]`

#### 3. Contracts
- The modal first loads country summaries only. It must not request
  `/api/resources/priceable-catalog?pageSize=500` or fetch every page just to
  build a country list.
- Country and region/group pages use fixed `pageSize=20`; search is pushed into
  the summary API instead of filtering an all-resource array in the browser.
- Selecting a country loads only that country's region/cost groups. Same
  country with identical upstream cost can collapse to the default automatic
  option; same country/region with different upstream costs remains separate.
- Admin resource quick-pricing cards title these groups by country/region only;
  use the cost subtitle to distinguish same-region cost groups, not visible
  `Line 1` / `Line 2` labels.
- The frontend saves a selected group by posting country/region/cost selectors.
  It must not expand the group to hidden resource ids from the current page.
- Backend source of truth still filters active, visible, saleable, concrete
  resources for the current site/tenant and current upstream account.
- No module-level caches around quick-pricing fetchers; React Query keys own
  request caching and invalidation.

#### 4. Validation & Error Matrix
- Summary fails -> show a blocking quick-price load error.
- Selected-country groups fail -> keep the country list visible and show the
  group-load error in the modal.
- Search changes -> reset selected country/region and request summary page 1.
- Country page changes -> request the new summary page; do not keep hidden
  country data as selectable.
- Group save succeeds -> invalidate pricing/resource key families including
  `['resources', 'quick-price-catalog']`, `['resources']`, and
  `['pricing-matrix']`.
- Group save fails -> show backend `reasonKey`; do not fake a local price update.

#### 5. Good/Base/Bad Cases
- Good: resource management opens quickly with 20 country summaries, then loads
  20 groups for the selected country.
- Good: searching `Ukraine` or `乌克兰` hits the summary API and returns the
  relevant country without loading tens of thousands of resource rows.
- Good: saving an Austria cost group posts selectors and the backend expands the
  exact current saleable resources in a transaction.
- Base: small catalogs with fewer than 20 countries still use the same summary
  and group endpoints.
- Bad: opening the modal and background-loading 20,000 resources before the
  operator can price the first country.
- Bad: deriving the saved resource id set from the frontend's current page,
  which can miss hidden pages or include stale saleability.

#### 6. Tests Required
- Component test: quick pricing requests `/summary` and `/groups` with
  `pageSize=20`, and does not request `/priceable-catalog?pageSize=500`.
- Component test: country search is sent to the summary endpoint.
- Component test: saving posts one `/api/pricing/resource-group-overrides`
  request with country/region/cost selectors.
- Repository test: summary counts resources, regions, priced rows, and cost
  groups from the same concrete saleable filter as the catalog.
- Repository test: group selector resolves resource ids from the full backend
  data set, not from a frontend page.

#### 7. Wrong vs Correct

Wrong:

```typescript
const catalog = usePriceableCatalog({
  queryKey: ['resources', 'quick-price-catalog', 30],
  pageSize: 500,
  fetchPage: fetchQuickPriceCatalogPage,
});
```

Correct:

```typescript
const countries = useQuery({
  queryKey: ['resources', 'quick-price-catalog', 'summary', 30, page, search],
  queryFn: () => fetchQuickPriceSummary(page, search),
});

const groups = useQuery({
  queryKey: ['resources', 'quick-price-catalog', 'groups', 30, countryCode, groupPage],
  queryFn: () => fetchQuickPriceGroups(countryCode, groupPage),
  enabled: Boolean(countryCode),
});
```

### Scenario: Pricing Mutation Cache Fan-out

#### 1. Scope / Trigger
- Trigger: admin pricing writes change template membership, template rules, user
  price bindings, or resource overrides.
- Applies to `PriceTemplateFeature`, `UserPricingFeature`,
  `ResourceOverrideFeature`, customer buy queries, and admin resource selectors.

#### 2. Signatures
- Template create path: `POST /api/pricing/templates`
- Template rule create path: `POST /api/pricing/templates/:templateId/rules`
- User override path: `POST /api/pricing/user-overrides`
- User template binding path: `POST /api/pricing/user-template-bindings`
- Shared invalidation families:
  - `['price-templates']`
  - `['pricing-matrix']`
  - `['pricing-resources']`
  - `['resources']`
  - `['resources-list']`
  - `['resources-countries']`
  - `['resources', 'quick-price-catalog']`
  - `['admin-user-price-resources']`
  - `['admin-assisted-order-resources']`

#### 3. Contracts
- A pricing write is cross-surface server state. Invalidating only the currently
  open pricing page is insufficient.
- Template/rule/user-pricing mutations must fan out to customer buy catalog
  queries, admin quick-pricing catalogs, and assisted-order selectors so all
  surfaces re-read the backend-derived price state.
- The broad `['resources']` invalidation is required because some pricing
  surfaces still read paged `/api/resources` data rather than the quick-price
  catalog hook.
- Do not keep local resource maps or stale option lists after a pricing write.
  React Query re-read is the source of truth.

#### 4. Validation & Error Matrix
- Template created successfully -> invalidate every shared pricing/resource key
  family above.
- Template rule created successfully -> invalidate every shared pricing/resource
  key family above.
- User override or template binding saved -> invalidate every shared
  pricing/resource key family above.
- Mutation failure -> keep current server state; do not fake a price refresh or
  mutate local option labels.

#### 5. Good/Base/Bad Cases
- Good: after a template rule is added, the customer buy page re-reads
  `['resources-list']` / `['resources-countries']` and shows the new price.
- Good: admin user pricing and assisted-order drawers re-read their resource
  selectors after the same mutation.
- Base: `['price-templates']` and `['pricing-matrix']` still refresh the
  currently open pricing UI.
- Bad: invalidating only `['pricing-matrix']`, leaving customer purchase and
  assisted-order selectors on stale prices.
- Bad: keeping a module-level resource option cache after a price mutation.

#### 6. Tests Required
- Component test: template create invalidates the full shared key family.
- Component test: template rule create invalidates the full shared key family.
- Component test: user override save invalidates the full shared key family.
- Component test: user template binding save invalidates the full shared key
  family.

#### 7. Wrong vs Correct

Wrong:

```typescript
void queryClient.invalidateQueries({ queryKey: ['pricing-matrix'] });
```

Correct:

```typescript
for (const key of [
  ['price-templates'],
  ['pricing-matrix'],
  ['pricing-resources'],
  ['resources'],
  ['resources-list'],
  ['resources-countries'],
  ['resources', 'quick-price-catalog'],
  ['admin-user-price-resources'],
  ['admin-assisted-order-resources'],
]) {
  void queryClient.invalidateQueries({ queryKey: key });
}
```

### Scenario: Admin Role And Tenant Context

#### 1. Scope / Trigger
- Trigger: Admin pages need role-based menus, redirects, and tenant-scoped API calls.
- The admin token stored in `sessionStorage.admin_token` is an opaque session token, not a JWT.

#### 2. Signatures
- `GET /api/auth/me` returns:
  - `ownerId: string`
  - `ownerType: 'USER' | 'TENANT_ADMIN' | 'PLATFORM_ADMIN' | 'SYSTEM'`
  - `siteId: string`
  - `tenantId: string | null`
  - `scopes: string[]`
- Frontend hook: `useCurrentAdmin()` in `apps/web/src/shared/auth/current-user.ts`.

#### 3. Contracts
- Admin role and tenant context must come from `GET /api/auth/me`.
- `sessionStorage.admin_token` is only a bearer token for `apiRequest`; it must not be parsed.
- Admin menus and admin route redirects should use `useCurrentAdmin()` or router `beforeLoad` calls to `/api/auth/me`.

#### 4. Validation & Error Matrix
- Missing `admin_token` -> redirect to `/admin/login`.
- `/api/auth/me` returns `USER` or `SYSTEM` -> remove `admin_token`, redirect to `/admin/login`.
- `TENANT_ADMIN` opens platform-only route -> redirect to `/admin/dashboard`.
- `PLATFORM_ADMIN` opens tenant-only route -> redirect to `/admin/resellers`.
- Network error while checking auth -> do not fake a role; surface the error or let router fail visibly.

#### 5. Good/Base/Bad Cases
- Good: `useCurrentAdmin()` reads `/api/auth/me`, then pages derive `ownerType` and `tenantId`.
- Base: A page may show no role-specific action until `useCurrentAdmin().data` is available.
- Bad: Decoding `sessionStorage.admin_token` with `atob(token.split('.')[1])`; the token is opaque and this silently hides platform actions.

#### 6. Tests Required
- Component tests for tenant-scoped admin tables must assert `tenantId` is present in API query strings.
- Router/menu behavior should be covered by smoke tests when Playwright coverage exists for admin pages.
- Permission failures must render an error/permission state, not an empty table.

#### 7. Wrong vs Correct

Wrong:

```typescript
const token = sessionStorage.getItem('admin_token');
const ownerType = token ? JSON.parse(atob(token.split('.')[1])).ownerType : '';
```

Correct:

```typescript
const currentAdmin = useCurrentAdmin();
const ownerType = currentAdmin.data?.ownerType;
```

---

### Scenario: Current User Cache For Route Navigation

#### 1. Scope / Trigger
- Trigger: route guards or layout components need `/api/auth/me` for admin/customer identity.
- Applies to `shared/auth/current-user.ts`, `app/router.tsx`, `routes/admin/_layout.tsx`, and `routes/customer/_layout.tsx`.

#### 2. Signatures
- Helpers:
  - `fetchCurrentCustomer(): Promise<CurrentUser>`
  - `fetchCurrentAdmin(): Promise<CurrentUser>`
  - `clearCurrentUserCache(area?: 'admin' | 'customer'): void`
  - `getCurrentUserQueryKey(area): ['auth', 'me', area, token]`
- Cache key includes the opaque token string from `sessionStorage`.

#### 3. Contracts
- Route guards and `useCurrentCustomer()` / `useCurrentAdmin()` must share the same fetch helpers so a navigation guard and the rendered layout do not both request `/api/auth/me`.
- The token is opaque. It may be compared as a cache key but must not be decoded.
- The current-user cache is short lived and token-aware. Changing or removing the token must force a fresh check or redirect.
- Logout must remove the token and call `clearCurrentUserCache(...)`.
- Network errors may remain visible or allow the existing route guard network behavior; permission/auth errors must clear the token and redirect.

#### 4. Validation & Error Matrix
- Same token + repeated route navigation within TTL -> reuse cached current user.
- Same token + concurrent guard/hook requests -> share one in-flight promise.
- Token changes -> new `/api/auth/me` request.
- Logout -> token and cache cleared.
- Role mismatch -> `PERMISSION_DENIED / insufficient_permissions` and route redirect logic handles it.

#### 5. Good/Base/Bad Cases
- Good: clicking between customer menu pages does not block on a fresh auth request each time.
- Good: admin role guard and admin layout use the same cached `CurrentUser`.
- Base: after TTL expires, the next navigation may refresh `/api/auth/me`.
- Bad: storing role in a global client store or decoding the token to avoid the request.
- Bad: clearing `sessionStorage` on logout but leaving the current-user cache populated.

#### 6. Tests Required
- Unit: same customer token dedupes concurrent and repeated `fetchCurrentCustomer()` calls.
- Unit: changing customer token triggers a new request.
- Unit: same admin token dedupes repeated `fetchCurrentAdmin()` calls.
- Regression: route guard/layout tests that rely on `/api/auth/me` continue to pass.

#### 7. Wrong vs Correct

Wrong:

```typescript
beforeLoad: () => userApiRequest('/api/auth/me')
```

This makes every page transition wait on a fresh auth request and duplicates the layout hook request.

Correct:

```typescript
beforeLoad: () => fetchCurrentCustomer()
```

The guard, layout, and feature hooks share a token-aware short-lived server-state cache.

---

### Scenario: Customer Static Proxy Batch Lifecycle UI

#### 1. Scope / Trigger
- Trigger: Customer proxy pages add or change batch renew, batch password change, batch IP switch, row selection, or batch result display.
- Applies to `CustomerProxyListFeature`, `ListPage`, customer proxy i18n keys, and tests under `features/customer-proxies`.

#### 2. Signatures
- Row selection state: `selectedRowKeys: React.Key[]`.
- Batch paths:
  - `POST /api/proxies/batch-renew`
  - `POST /api/proxies/batch-change-password`
  - `POST /api/proxies/batch-switch-ip`
- Batch renew body: `{ proxyIds: string[]; durationDays: 30; idempotencyKey: string }`.
- Batch change-password / switch-IP body: `{ proxyIds: string[] }`.
- Batch response: `{ totalCount, successCount, failureCount, items }`.
- Success item: `{ proxyId, success: true, proxy }`.
- Failure item: `{ proxyId, success: false, error: { code, reasonKey, httpStatus } }`.

#### 3. Contracts
- Frontend batch lifecycle actions must call backend batch endpoints, not loop over single-item `/api/proxies/:id/*` endpoints.
- Row selection is client state scoped to the current table page. Clear selection when page, page size, search, status, or country filters change.
- Batch result detail is client state and should be displayed in a Drawer or Modal; the proxy list itself stays server state from TanStack Query.
- Successful batch mutation must invalidate the `customer-proxies` query.
- Successful batch items may reuse the proxy copy modal; failure items must show backend `reasonKey`, `code`, and `httpStatus`.
- User-visible labels and batch result text must come from i18n files, not inline component strings.

#### 4. Validation & Error Matrix
- No selected proxy ids -> batch buttons disabled; no request is sent.
- Backend item failure -> show it inside the batch result, do not collapse it into a global error.
- Network/auth/global validation failure -> show the global action error alert with the backend reason key.
- Page/filter changes with existing selection -> clear selected ids so cross-page batch actions cannot happen accidentally.

#### 5. Good/Base/Bad Cases
- Good: selecting two proxies and clicking batch renew sends one request to `/api/proxies/batch-renew`.
- Good: mixed success/failure result shows copy action for successful proxy delivery and reason key for failed items.
- Base: zero selected rows leaves batch controls disabled and explains that proxies must be selected first.
- Bad: frontend loops over selected ids and calls `/api/proxies/:id/switch-ip`, losing the backend batch aggregation contract.
- Bad: treating a global request failure as an empty success result or empty proxy list.

#### 6. Tests Required
- Component test: batch buttons are disabled until a row is selected.
- Component test: batch renew sends selected `proxyIds`, `durationDays: 30`, and an `idempotencyKey`.
- Component test: batch change-password and switch-IP call batch endpoints and do not call single lifecycle endpoints.
- Component test: mixed batch result displays failure `reasonKey/code/httpStatus` and exposes copy action for success items.
- Regression: existing single-row lifecycle, export, and filter tests continue to pass.

#### 7. Wrong vs Correct

Wrong:

```typescript
await Promise.all(selectedIds.map((id) => userApiRequest(`/api/proxies/${id}/switch-ip`, { method: 'POST' })));
```

This bypasses the backend batch contract and makes item-level failures harder to report consistently.

Correct:

```typescript
await userApiRequest('/api/proxies/batch-switch-ip', {
  method: 'POST',
  body: JSON.stringify({ proxyIds: selectedIds }),
});
```

The backend owns batch aggregation, per-item error mapping, and lifecycle audit boundaries.

### Scenario: Customer Static Proxy Purchase Resource Visibility

#### 1. Scope / Trigger
- Trigger: Customer static proxy purchase pages render resources from `GET /api/resources` and allow quote/order actions.
- Applies to `BuyStaticProxyFeature`, resource-card filtering, quote triggering, and tests under `features/customer-proxies`.

#### 2. Signatures
- Resource query: `GET /api/resources?pageSize=20&durationDays=30&currency=<walletCurrency>&search=<optionalSearch>`.
- Resource price fields:
  - `unitPrice: string | null`
  - `priceCurrency: string | null`
- Resource page response fields used by the UI:
  - `items: ResourceDto[]`
  - `total: number`
  - `pageSize: number`
- Quote path: `GET /api/pricing/quote?resourceId&durationDays&quantity&currency`.

#### 3. Contracts
- The customer purchase grid renders resources that are visible, saleable, and priced by backend server state. Do not hide a configured priced resource only because the latest local inventory snapshot is zero, missing, or stale.
- A resource is quotable in the frontend when `unitPrice` is a non-empty string. A successful backend quote for the active `resourceId + durationDays + quantity + currency` is required before purchase submit can be enabled.
- Local stock is display context and sort preference, not the customer catalog visibility gate. Backend quote/order/fulfillment remains the final authority and must reject stale, missing, or zero inventory visibly.
- The frontend must not render placeholder prices such as `-- CNY` for public purchase cards.
- Initial purchase resource loading is intentionally bounded to a small first page. When `total > items.length`, the UI must show a user-readable loaded/total hint and make clear that searching country, city, line, code, or provider continues querying backend matches.
- Search text is part of the React Query key; do not hide backend search behind a module-level cache or a client-only filter when the initial page is partial.
- The frontend may present localized search examples such as country/city names because backend `/api/resources?publicOnly=true` expands known customer-facing aliases before DB pagination. The UI still sends the raw search text and does not duplicate the backend alias map.
- Missing price means a returned SKU is hidden from the customer purchase selector and is not quotable. The operator must fix pricing in the admin pricing/provider flow.
- Upstream line-level resources should keep the country/region as the primary label and show the synced upstream line name/id as supporting detail, for example `美国` with `United States-New York Recommended`.
- Quote requests may be triggered for priced resources even when local inventory is stale, missing, or zero so the backend can perform its realtime inventory refresh/check. Hidden or unpriced resources must never call `/api/pricing/quote`.
- Quote is server-derived state for the current `resourceId + durationDays + quantity + currency`. Store or derive a quote fingerprint from those inputs, and treat a quote as current only when all four fields match the active selection. When any quote input changes, clear the previous quote immediately, show the quote loading state, and keep order submit disabled until the new backend quote succeeds.

#### 4. Validation & Error Matrix
- `stock === null` with price -> show the priced configured resource; quote verifies live inventory.
- `stock <= 0` with price -> show the priced configured resource; quote/order still rejects `out_of_stock` if realtime validation confirms no stock.
- `stock === 0` for Proxy-Seller (`PR`) with fresh inventory and a price -> show the configured resource but keep quote/order as the inventory authority; PR has no fulfillment-time bypass.
- `inventoryIsStale === true` with price -> show the priced configured resource; quote attempts backend refresh and surfaces `inventory_stale` if it remains stale.
- `unitPrice === null | undefined | ''` -> hide the returned saleable SKU from the selector and do not quote.
- Backend quote failure -> visible quote error; do not enable purchase.
- Quantity/resource/currency changes after a successful quote -> old total disappears, quote loading is visible, and the buy button stays disabled until the new quote response arrives. If an older quote response resolves after the user has switched lines, ignore it for checkout.

#### 5. Good/Base/Bad Cases
- Good: a resource with `{ stock: 464, inventoryIsStale: false, unitPrice: '10' }` renders as `10 CNY` and can be quoted.
- Good: a resource with `{ stock: 0, inventoryIsStale: true, unitPrice: '21' }` renders as a configured priced SKU and requests a quote; the quote error remains visible if backend inventory validation fails.
- Base: if backend returns only unpriced resources, show the empty available-resources state.
- Base: if backend returns `{ items: 20 entries, total: 1001, pageSize: 20 }`, show `20/1001` (or equivalent localized copy) and keep backend search available for targets outside the first page.
- Base: searching `纽约` or `新加坡` sends that exact term to the backend; the component does not require the matching resource to already be present in the first page.
- Bad: hiding all configured priced resources on the customer page because local inventory snapshots are stale, creating an empty catalog while backend quote could refresh upstream inventory.
- Bad: showing a stocked but unpriced resource as `-- CNY`, then allowing users to select it.
- Bad: increasing customer purchase startup to `pageSize=5000` just to make the first view exhaustive; this slows the purchase flow and makes search feel broken under a large SKU pool.
- Bad: triggering `/api/pricing/quote` for a resource already known to have no price.

#### 6. Tests Required
- Component test: stocked resources with `unitPrice: null` are hidden, `/api/pricing/quote` is not called for them, and `-- CNY` is absent.
- Component test: priced resources with `stock=0`, `stock=null`, or `inventoryIsStale=true` remain visible and may trigger `/api/pricing/quote`; quote failure is shown and submit stays disabled.
- Component test: visible priced resources render the actual price from `unitPrice`/`priceCurrency`.
- Component test: Proxy-Seller resources with `stock=0`, fresh inventory, and a price remain visible but do not enable purchase unless backend quote succeeds.
- Component test: unpriced returned resources are hidden and do not trigger `/api/pricing/quote`.
- Component test: initial purchase loading requests `pageSize=20`, does not request page 2, and shows the loaded/total hint when backend `total` exceeds returned `items.length`.
- Component/API contract test: resource search text remains in the backend request/query key and is not implemented as first-page-only client filtering.
- Component test: changing quantity after a successful quote clears the stale quote and keeps the submit button disabled while the new quote is pending.
- Component test: changing the selected line after a successful quote clears the stale quote and keeps the submit button disabled while the new line is being quoted.

#### 7. Wrong vs Correct

Wrong:

```tsx
const visible = Boolean(resource.unitPrice?.trim())
  && hasAvailableInventory(resource);
<Typography.Title>{resource.unitPrice ? `${resource.unitPrice} CNY` : '-- CNY'}</Typography.Title>
```

Correct:

```tsx
const visible = Boolean(resource.unitPrice?.trim());
const preferred = visible
  && typeof resource.stock === 'number'
  && resource.stock > 0
  && resource.inventoryIsStale !== true;
```

Wrong:

```tsx
const canBuy = Boolean(quote && !quoteError);
```

This can keep an old quote enabled while a new quantity/resource quote is still pending.

Correct:

```tsx
setQuote(null);
setQuoteError(null);
setQuoteLoading(true);
const canBuy = Boolean(quote && !quoteError && !quoteLoading);
```

---

### Scenario: Admin Order Failure Operation UI

#### 1. Scope / Trigger
- Trigger: Admin order pages expose retry fulfillment, refund, manual completion, or other high-risk order mutation controls.
- Applies to `OrderListFeature`, nearby admin order operation components, order i18n keys, and tests under `features/admin-orders`.

#### 2. Signatures
- Operation paths:
  - `POST /api/orders/:id/retry-fulfillment`
  - `POST /api/orders/:id/refund`
  - `POST /api/orders/:id/manual-complete`
- Retry body: `{ reason?: string }`.
- Refund and manual-complete body: `{ reason: string }`.
- Response: `{ orderId, status, fulfillmentJobId?, wallet? }`.
- Query keys:
  - order list: `['admin-orders', tenantId, page, pageSize, status]`
  - fulfillment drawer: `['order-fulfillment', orderId]`

#### 3. Contracts
- Frontend operation visibility may hide impossible actions for UX, but backend remains the permission and state-transition source of truth.
- Refund and manual-complete must collect a non-empty reason before calling the API.
- Retry may submit without a reason, but if a reason is entered it must be trimmed and included.
- Successful mutations must invalidate the broad `['admin-orders']` query family and the specific `['order-fulfillment', orderId]` query.
- Do not optimistically rewrite order status, wallet balance, proxy instances, or fulfillment jobs in local state.
- Operation labels, modal copy, validation copy, and result text must live in i18n files.

#### 4. Validation & Error Matrix
- `FAILED` order -> show retry, refund, and manual-complete controls.
- `PENDING` or `FULFILLING` order -> show refund and manual-complete controls only.
- `COMPLETED` or `REFUNDED` order -> show no failure-operation controls.
- Blank reason for refund/manual-complete -> block submit client-side; no request is sent.
- Backend `ApiError` -> display `reasonKey`; do not convert it to an empty table or success toast.
- Successful refund with `wallet` -> display returned wallet balance as a result summary, but still reload server state.

#### 5. Good/Base/Bad Cases
- Good: after a retry succeeds, the UI invalidates order list and fulfillment detail queries, then displays the returned fulfillment job id.
- Good: a refund error such as `order_already_refunded` remains visible in the modal.
- Base: completed orders still allow viewing fulfillment details.
- Bad: setting `row.status = 'REFUNDED'` in local state after a refund instead of re-reading the list.
- Bad: hiding a button and assuming that is sufficient permission enforcement.

#### 6. Tests Required
- Component test: operation path helper URL-encodes order ids.
- Component test: operation visibility matches `FAILED`, `PENDING`, `FULFILLING`, `COMPLETED`, and `REFUNDED`.
- Component test: refund/manual-complete require reason and do not call the API when blank.
- Component test: each mutation posts to the real endpoint and invalidates order/fulfillment queries on success.
- Component test: backend `reasonKey` is visible on mutation failure.

#### 7. Wrong vs Correct

Wrong:

```typescript
row.status = 'REFUNDED';
message.success(t('adminOrders.operations.successToast'));
```

This turns a high-risk backend state transition into local UI state and can hide wallet, audit, or fulfillment failures.

Correct:

```typescript
await apiRequest(`/api/orders/${encodeURIComponent(order.id)}/refund`, {
  method: 'POST',
  body: JSON.stringify({ reason }),
});
void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
void queryClient.invalidateQueries({ queryKey: ['order-fulfillment', order.id] });
```

The backend owns funds, audit, and order state. The frontend submits intent and refreshes server state.

---

### Scenario: Admin-Assisted Customer Static Proxy Order UI

#### 1. Scope / Trigger
- Trigger: Admin user pages expose "assisted order" or any flow where an admin creates a static proxy order for a target customer.
- Applies to `UserListFeature`, nearby admin-assisted order form/drawer components, admin order list filters, user i18n keys, and tests under `features/admin-users`.

#### 2. Signatures
- Entry point context: selected user row `{ id, email, tenantId, status }` from `GET /api/users`.
- Resource options: `GET /api/resources?pageSize=200&status=ACTIVE`.
- Target wallet: `GET /api/wallet/:userId`.
- Mutation path: `POST /api/orders/users/:userId/static-proxy`.
- Mutation body:
  - `{ resourceId, quantity, durationDays, currency, idempotencyKey, businessType?, reason }`
- Response:
  - `{ orderId, status }`
- Query keys:
  - users list: `['users', tenantId, page, pageSize, search, status]`
  - admin order list: `['admin-orders', tenantId, page, pageSize, status, userId]`
  - assisted resource selector: `['admin-assisted-order-resources']`
  - target wallet: `['admin-user-wallet', userId]`

#### 3. Contracts
- The frontend must not ask operators to manually enter the target user id when the action is launched from a user row.
- The frontend submits purchase intent only. Backend owns quote, wallet debit, order status, fulfillment jobs, audit, tenant scope, and permission enforcement.
- `idempotencyKey` is generated per submit in the frontend and is not visible/editable as an operator field.
- Target wallet currency must come from `GET /api/wallet/:userId`; do not hardcode platform currency in the mutation when wallet data is available.
- Successful mutations must invalidate the broad `['admin-orders']` query family, `['users']`, and the specific `['admin-user-wallet', userId]`.
- Admin order list should expose `userId` filtering so support staff can inspect the newly created order in UI.
- User-visible labels, validation copy, success copy, and result copy must live in i18n files.
- Resource selection must not use a high-cardinality `<Select>` that exposes raw upstream English names. Render a searchable modal/card picker using localized resource labels (`formatResourceLocationZh`, `formatProviderLabel`, IP/protocol labels) and keep the submitted form value as `resourceId`.

#### 4. Validation & Error Matrix
- Blank `reason` -> block submit client-side; no request is sent.
- Missing resource, duration, quantity, or wallet currency -> block locally or throw a visible validation error.
- Backend `ApiError` -> display `reasonKey` in the drawer; do not convert permission, wallet, inventory, price, or idempotency failures into empty state.
- Pending mutation -> prevent close-triggered duplicate work and keep the submit button loading.
- No saleable/active resources returned -> show the empty option state from the resource query; do not synthesize fake resource options.
- Resource search in the assisted picker -> filter only the already-loaded admin-assisted resource server-state list, matching localized country/city/line/provider labels and traceable ids/codes. Do not change the backend mutation payload.

#### 5. Good/Base/Bad Cases
- Good: clicking "assisted order" on a user row opens a drawer showing that user's email, tenant, and wallet balance.
- Good: success displays the returned `orderId/status`, invalidates server-state queries, and lets the operator use the order list `userId` filter.
- Good: the resource picker opens as a modal, shows localized cards such as `日本`/`新加坡`, and the selected summary exposes provider, line, status, and stock without submitting anything except `resourceId`.
- Base: tenant admin sees the same UI but backend enforces same-tenant access.
- Bad: mutating local order rows or wallet balance instead of invalidating server state.
- Bad: defaulting to `CNY` when the target wallet request failed.
- Bad: swallowing `wallet_insufficient_balance`, `tenant_access_denied`, or `reason_required` as a generic empty form state.

#### 6. Tests Required
- Component test: endpoint path helper URL-encodes target user ids.
- Component test: request body helper trims `reason` and optional `businessType`, includes generated idempotency key, and matches the backend contract.
- Component test: user list row action opens the assisted-order drawer with target user context.
- Component test: successful submit posts to `/api/orders/users/:userId/static-proxy`, includes target wallet currency, and invalidates users/orders/wallet queries.
- Component test: blank reason blocks submit and displays local validation.
- Component test: backend mutation failure displays `reasonKey`.
- Component test: assisted resource selection is performed through the searchable modal/card picker, keeps stale or unknown-stock resources visible, and no longer depends on raw English `<Select>` option text.
- Component test: admin order list sends `userId` in query string when the operator filters by customer.

#### 7. Wrong vs Correct

Wrong:

```typescript
await apiRequest('/api/orders/static-proxy', {
  method: 'POST',
  body: JSON.stringify({ userId: typedUserId, currency: 'CNY', reason }),
});
row.wallet.available = String(Number(row.wallet.available) - totalPrice);
```

This calls the customer endpoint, trusts operator-entered identity, hardcodes currency, and invents local wallet state.

Correct:

```typescript
await apiRequest(`/api/orders/users/${encodeURIComponent(user.id)}/static-proxy`, {
  method: 'POST',
  body: JSON.stringify({
    resourceId,
    quantity,
    durationDays,
    currency: wallet.currency,
    idempotencyKey,
    reason,
  }),
});
void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
void queryClient.invalidateQueries({ queryKey: ['users'] });
void queryClient.invalidateQueries({ queryKey: ['admin-user-wallet', user.id] });
```

The backend owns funds, tenant scope, audit, order state, and fulfillment; the frontend submits intent from a real user-row context and refreshes server state.

### Scenario: Admin Customer Management Operation UI

#### 1. Scope / Trigger
- Trigger: Admin customer pages expose customer detail, create user, wallet adjustment, assisted order, impersonation, per-user pricing, password reset, status changes, or delete actions.
- Applies to `UserListFeature`, `CreateUserDrawer`, `WalletAdjustModal`, `AdminCustomerOrderDrawer`, pricing modals, user i18n keys, and tests under `features/admin-users`.

#### 2. Signatures
- List query: `GET /api/users?page&pageSize&search&status&tenantId`.
- List query key: `['users', tenantId, page, pageSize, search, status]`.
- Row operations:
  - `POST /api/users` body `{ email, password, tenantId? }`.
  - `POST /api/users/:id/status` body `{ status }`.
  - `POST /api/users/:id/reset-password` body `{ password }`.
  - `POST /api/users/:id/impersonate`.
  - `DELETE /api/users/:id`.
- Related operations:
  - `POST /api/wallet/:userId/adjust`.
  - `POST /api/orders/users/:userId/static-proxy`.
  - `POST /api/pricing/user-template-bindings`.
  - `POST /api/pricing/user-overrides`.

#### 3. Contracts
- The customer table and detail drawer must render server state from `/api/users`; do not invent role, wallet, order count, proxy count, or price-template values on the client.
- Current schema has customer users only. Show the role as customer, but do not expose a fake mutable "set role" action unless the backend schema and permission contract exist.
- Row actions may be grouped under "More actions", but each visible action must map to a real backend mutation or an existing real workflow drawer.
- Detail drawers can reuse the row projection for read-only summary. If a new field is needed, add it to the backend projection or a real detail endpoint instead of hardcoding it.
- Per-user price override drawers must provide client-side search over the loaded resource list and an explicit "select current filtered results" action. The action should select the current filtered server-state rows, not silently select hidden or unloaded resources.
- Successful mutations must invalidate `['users']`. Wallet adjustment also invalidates `['admin-user-wallet', userId]`; assisted orders also invalidate `['admin-orders']`; pricing changes invalidate pricing/user queries owned by their feature when present.
- Impersonation success must replace the admin session with the returned user session and navigate to the customer area. The frontend must not derive user identity from the token.
- Delete UI must communicate that only empty users are deletable and must surface backend `user_has_business_records` failures.
- User-visible labels, drawer titles, validation copy, and operation text must live in i18n files.

#### 4. Validation & Error Matrix
- Blank create email, tenant, or password -> block locally according to the create form rules.
- Reset password shorter than 8 characters -> block locally and still preserve backend `password_too_weak` if returned.
- Inactive customer -> impersonation button disabled; backend remains the source of truth.
- Backend mutation `ApiError` -> show `reasonKey`; do not close the modal/drawer as if it succeeded.
- Delete failure `user_has_business_records` -> remain visible to the operator; do not remove the row locally.
- Network/list failure -> show the normal list error state; do not show an empty table as a fallback.

#### 5. Good/Base/Bad Cases
- Good: clicking detail opens a drawer with real row fields and launches the same real operations used by table actions.
- Good: setting a user's price calls `/api/pricing/user-template-bindings` or `/api/pricing/user-overrides`, then reloads server state.
- Good: searching `SG` in the per-user price drawer narrows the loaded resources, then "select current filtered results" selects those visible matches for `/api/pricing/user-overrides`.
- Good: impersonation stores the returned `user_token`, removes `admin_token`, and navigates to `/customer`.
- Base: role is displayed as a fixed customer tag because the data model has no role field.
- Bad: adding a "set role" menu item that only changes React state or posts to a nonexistent endpoint.
- Bad: decrementing wallet or order counts locally after assisted order instead of invalidating server state.
- Bad: filtering out a deleted row before the backend confirms deletion.

#### 6. Tests Required
- Component test: user list row opens the real detail/action surface and displays row-derived wallet/order/proxy/pricing fields.
- Component test: create user posts to `/api/users` and invalidates `['users']`.
- Component test: wallet adjustment posts to `/api/wallet/:userId/adjust` and invalidates user/wallet queries.
- Component test: assisted order posts to `/api/orders/users/:userId/static-proxy` and invalidates users/orders/wallet queries.
- Component test: status, password reset, pricing, impersonation, and delete actions call their real endpoints.
- Component test: per-user pricing supports resource search and a select-current-filter bulk action before posting one `/api/pricing/user-overrides` mutation per selected resource id.
- Component test: backend `reasonKey` from these mutations remains visible.

#### 7. Wrong vs Correct

Wrong:

```tsx
setRows((rows) => rows.map((row) => row.id === user.id ? { ...row, wallet: { available: '0' } } : row));
message.success(t('users.operations.statusSuccess'));
```

This treats customer account and wallet state as local UI state and can hide backend/audit failures.

Correct:

```tsx
await apiRequest(`/api/users/${encodeURIComponent(user.id)}/status`, {
  method: 'POST',
  body: JSON.stringify({ status: 'SUSPENDED' }),
});
void queryClient.invalidateQueries({ queryKey: ['users'] });
```

The backend owns status changes, session revocation, and audit. The frontend submits intent and refreshes server state.

Wrong:

```tsx
menu.items.push({ key: 'set-role', label: 'Set role' });
```

There is no mutable customer role in the current backend contract, so this would be fake UI.

Correct:

```tsx
{ title: t('users.role'), render: () => <Tag>{t('users.roleCustomer')}</Tag> }
```

Display the real model clearly until a role source of truth is designed.

---

### Scenario: Admin Pricing Center Priority UI

#### 1. Scope / Trigger
- Trigger: Admin pricing pages render the pricing center, matrix, resource-price form, quote sandbox, or user-specific pricing controls.
- Applies to `PricingCenterFeature`, `PricingMatrixFeature`, `ResourceOverrideFeature`, `QuoteSandboxFeature`, `UserListFeature` pricing actions, and pricing i18n keys.

#### 2. Signatures
- Global resource price path: `POST /api/pricing/overrides`.
- User resource override path: `POST /api/pricing/user-overrides`.
- Quote price sources: `USER_OVERRIDE | USER_TEMPLATE | RESOURCE_OVERRIDE | DEFAULT_TEMPLATE`.

#### 3. Contracts
- Pricing Center is the global default pricing surface. It must be labeled as global default/global resource pricing in UI copy.
- User Management owns per-user price overrides. UI copy must state that per-user prices have higher priority than Pricing Center prices.
- Quote priority shown to operators must match backend behavior: user override -> user template rule -> global resource price -> default template rule.
- `RESOURCE_OVERRIDE` labels should read as global resource price, not a generic "override" that implies it replaces user-specific pricing.
- Pricing matrix resources must be loaded with backend pagination at a fixed `pageSize=20`. Do not expose a page-size switcher, request `pageSize=1000`, or fetch every resource just to render the matrix or compute page metrics. Use the server `total` for global count and label row-derived metrics as current-page metrics.
- User-visible pricing labels and priority notices must live in i18n files.

#### 4. Validation & Error Matrix
- Operator opens Pricing Center -> visible guidance explains that global pricing is lower priority than user-specific pricing.
- Operator uses quote sandbox -> returned `priceSource` labels clearly distinguish user-specific and global-resource prices.
- Backend pricing failure -> show `ApiError.reasonKey`; do not hide priority or pricing errors behind empty states.

#### 5. Good/Base/Bad Cases
- Good: Pricing Center tab says "全局资源售价" and explains "单用户覆盖价 > 用户专属价 > 全局资源售价 > 基础售价".
- Good: User Management pricing action remains the place for one customer-specific price overrides.
- Bad: Pricing Center labels say only "覆盖售价", causing operators to think it overrides a user's dedicated price.

#### 6. Tests Required
- Component test: Pricing Center renders the global default pricing priority notice.
- Component test: Pricing matrix initial load requests fixed `pageSize=20` and never requests `pageSize=1000`.
- Component test: matrix and resource-price forms render their priority notices.
- Regression: quote sandbox source labels keep distinguishing `USER_OVERRIDE` and `RESOURCE_OVERRIDE`.

---

### Scenario: Customer Reseller Product Pricing Source

#### 1. Scope / Trigger
- Trigger: Customer-side reseller pages render product management, price configuration, reseller orders, or reseller users.
- Applies to `features/customer-reseller/*` and tests under `features/customer-reseller/tests`.

#### 2. Signatures
- Customer self-service sub-site create path:
  - `POST /api/customer/reseller/self-service`
- Reseller product pool path:
  - `GET /api/customer/reseller/products?page=<n>&pageSize=<n>&status=ENABLED`
- Reseller product price save path:
  - Existing reseller product mutation endpoint owned by `ResellerProductsFeature`.

#### 3. Contracts
- Reseller pricing selectors must read from the reseller product pool, not the global `/api/resources` list.
- Only products enabled for the reseller can appear in reseller pricing configuration.
- The source of truth for reseller-saleable products is the main-site product pool exposed through `/api/customer/reseller/products`.
- Do not show products that the main site has not enabled for reseller sale, and do not synthesize product rows on the client.
- Customer-side reseller product, pricing, and order pages present products as main-site products only. Do not render upstream provider labels, upstream costs, provider-account controls, or direct platform connection language in reseller-facing surfaces.
- Reseller pages use `userApiRequest`; they must not switch to admin tokens or admin endpoints.
- Customer-owned sub-site creation must call `/api/customer/reseller/self-service`; do not call admin tenant endpoints or require a second admin account flow from the customer sidebar.

#### 4. Validation & Error Matrix
- Product pool empty -> pricing selector shows a real empty state; no global resource fallback.
- Product disabled or absent from `/api/customer/reseller/products` -> cannot be selected for reseller pricing.
- Product pool request fails -> show backend `ApiError.reasonKey`; do not render an empty success state.
- Price mutation succeeds -> invalidate/re-read reseller product/pricing server state.
- Self-service sub-site create pending -> show pending feedback and re-read reseller overview after success.

#### 5. Good/Base/Bad Cases
- Good: reseller pricing loads `/api/customer/reseller/products?page=1&pageSize=500&status=ENABLED` and builds options from returned enabled products.
- Good: customer sidebar self-service creates a sub-site through `/api/customer/reseller/self-service` using the current customer session.
- Good: reseller product management states that products come from the main-site product pool.
- Base: reseller users/orders pages may link to product/pricing management but keep their own server-state queries.
- Bad: reading `/api/resources` directly from reseller pricing, which can expose main-site resources that the reseller has not enabled for sale.
- Bad: showing `providerCode`, upstream cost, or a provider-account tab in reseller product/pricing/order UI; reseller operators should only see the main-site product pool and their own sale prices.
- Bad: using `/api/tenants/self-service` from a customer feature, which bypasses the customer reseller contract and can require the wrong account context.
- Bad: adding local placeholder products when the reseller product pool is empty.

#### 6. Tests Required
- Component test: reseller products list calls `/api/customer/reseller/products`.
- Component test: reseller pricing selector uses the enabled reseller product pool, not `/api/resources`.
- Component test: reseller product and pricing selectors do not render upstream provider codes or upstream costs even if older backend responses contain those fields.
- Component test: saving reseller product price posts through the real reseller endpoint and re-reads server state.
- Component test: customer self-service sub-site creation posts to `/api/customer/reseller/self-service` and does not call `/api/tenants/self-service`.

#### 7. Wrong vs Correct

Wrong:

```typescript
userApiRequest('/api/tenants/self-service', { method: 'POST', body });
```

This uses the admin tenant surface from a customer-owned reseller page.

Correct:

```typescript
userApiRequest('/api/customer/reseller/self-service', { method: 'POST', body });
```

Wrong:

```typescript
userApiRequest('/api/resources?pageSize=500');
```

This bypasses the reseller product pool and can expose products the main site has not enabled for this reseller.

Correct:

```typescript
userApiRequest('/api/customer/reseller/products?page=1&pageSize=500&status=ENABLED');
```

The reseller pricing UI now uses the same saleable product source as the reseller product management page.

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- Treating opaque session tokens as JWT payloads. Always use `/api/auth/me` as the source of truth for admin role and tenant context.
