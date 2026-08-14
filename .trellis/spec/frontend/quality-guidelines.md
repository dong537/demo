# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

- Calling `fetch` directly in features — use `apiRequest`/`userApiRequest`.
- Optimistically mutating server state in local variables (e.g.
  `row.status = 'REFUNDED'`) instead of invalidating and re-reading.
- Hardcoded user-visible strings — all copy goes through `t(key)` with keys in
  `shared/i18n/{zh,en}.ts`.
- Decoding the opaque `admin_token`/`user_token` as a JWT to infer role.
- `any` in feature code (see `type-safety.md` for the single sanctioned router
  exception).
- Hiding a button as the *only* permission enforcement — the backend is the
  authority; UI hiding is UX only.
- Building UI for an endpoint a role cannot actually call. Before adding a
  button/page/menu entry for a given role, verify the backend use-case permits
  that role. If the endpoint is `@RequireUser` (or 403s for the current role),
  do **not** render the control for that role — a button that always fails is
  fake UI. Examples: admin must not get proxy lifecycle buttons (renew /
  change-password / switch-ip / export are USER-only); the admin API-key page is
  TENANT_ADMIN-only because list/create 403 for PLATFORM_ADMIN.
- Setting both `id` and `path` on a TanStack Router route.

---

## Required Patterns

- Server reads/writes via TanStack Query (`useQuery`/`useMutation`) over
  `apiRequest`; invalidate affected query keys on mutation success.
- Loading, error, and permission states must be visible — use `ListPage` (which
  renders `Skeleton` / `Alert` / permission warning) or the equivalent inline
  `Skeleton` + `Alert` pattern. Never render an empty table in place of an error.
- Surface backend `ApiError.reasonKey` to the user on failure.
- Pricing admin surfaces must format known backend pricing reasons through
  `features/pricing/pricing-errors.ts` and `pricing.reason.*` i18n keys. Unknown
  internal errors fall back to `pricing.reason.generic`; do not show raw strings
  such as `unit_price_invalid`, resource ids plus reason keys, or local contract
  diagnostics as the primary user-facing error.
- Thin route files; logic in feature components (see `directory-structure.md`).
- Role/tenant context from `useCurrentAdmin()` / `/api/auth/me`.
- Railway production frontend should call the same-origin `/api` proxy via the
  shared API client. Do not point `VITE_API_BASE_URL` at the backend service
  URL in production; keep deployment docs and `buildApiUrl(...)` aligned so the
  browser never needs to reach the backend origin directly.
- Railway production frontend must keep the browser on same-origin `/api`
  while the web server proxy uses `WEB_API_PROXY_TARGET`; `VITE_API_BASE_URL`
  is not the server proxy target and must not be treated as one.
- Money display that uses the plain `amount currencyCode` shape must go through
  `shared/money/formatMoneyAmount(...)` instead of reimplementing parsing in a
  feature. The helper treats blank strings as missing values so UI does not
  accidentally render an unknown amount as `0.00 CNY`.
- Date-time table/detail display must go through `shared/time/formatDateTime(...)`
  instead of inline `new Date(value).toLocaleString()`. The helper keeps invalid
  upstream values visible as their raw string rather than rendering `Invalid Date`.

---

## Scenario: Bodyless API Requests Through the Web Proxy

### 1. Scope / Trigger

- Trigger: changing `shared/api/client.ts`, `apps/web/serve.mjs`, or any admin/customer action that sends a bodyless API mutation such as provider health checks.
- Applies to browser requests through same-origin `/api` and the Node web proxy forwarding to the backend service.

### 2. Signatures

- Client call: `apiRequest<T>(path, { method: 'POST' })` or `userApiRequest<T>(path, { method: 'POST' })`.
- Proxy entry: `proxyApi(req, res, targetBase)` in `apps/web/serve.mjs`.
- Header sanitizer: `sanitizeProxyRequestHeaders(headers, bodyLength)`.
- Important routes: `POST /api/providers/:id/health-check`, `POST /api/upstream-accounts/:id/test`, and other bodyless probe endpoints.

### 3. Contracts

- `withJsonAuthHeaders(...)` must add `Content-Type: application/json` only when `RequestInit.body` is present.
- Explicit caller headers still win, but the shared client must not invent a JSON content type for bodyless `GET`, `POST`, or `DELETE` requests.
- The web proxy must remove `content-type` when the forwarded request body length is `0`, because stale browser bundles or external clients may still send `Content-Type: application/json` without a JSON body.
- Bodyful JSON mutations must keep `Content-Type: application/json` so backend DTO parsing remains stable.

### 4. Validation & Error Matrix

- Bodyless POST + stale `Content-Type: application/json` -> proxy strips the header, backend returns the real auth/probe result, not a JSON parser 500.
- Bodyless POST without auth -> `AUTH_REQUIRED` envelope, not `INTERNAL_ERROR`.
- Bodyful POST with JSON body -> header preserved and backend receives the payload.
- Network/proxy failure -> visible `network_error` / proxy failure, not fake success.

### 5. Good/Base/Bad Cases

- Good: provider health check calls `apiRequest('/api/providers/<id>/health-check', { method: 'POST' })` and sends only authorization headers.
- Base: create/update provider calls include `body: JSON.stringify(...)` and keep JSON content type.
- Bad: setting `Content-Type: application/json` globally for every request.
- Bad: proxying an empty request body while preserving stale `content-type`, which lets Fastify parse an empty JSON document before auth/use-case code runs.

### 6. Tests Required

- `src/shared/api/client.spec.ts`: bodyless POST does not include JSON content type; bodyful POST still does.
- `apps/web/serve.spec.mjs`: `sanitizeProxyRequestHeaders(...)` strips `content-type` when `bodyLength === 0` and preserves it when `bodyLength > 0`.
- Production smoke after deploy: `POST /api/providers/:id/health-check` with stale JSON content type and no auth must return `401 AUTH_REQUIRED`, not `500`.

### 7. Wrong vs Correct

Wrong:

```ts
const headers = {
  'Content-Type': 'application/json',
  ...init.headers,
};
```

Correct:

```ts
const headers = {
  ...(init.body !== undefined && init.body !== null ? { 'Content-Type': 'application/json' } : {}),
  ...init.headers,
};
```

---

## Scenario: Customer Buy Pagination and Quote Reset

### 1. Scope / Trigger

- Trigger: customer purchase page pagination, search filtering, and resource
  selection changes.
- Applies to the buy page resource list, country/region automatic assignment,
  and the order summary quote panel.

### 2. Signatures

- Country summary query: `GET /api/resources/countries?durationDays=30&currency=<walletCurrency>&search=<term>`.
- Resource list query: `GET /api/resources?page=<n>&pageSize=20&durationDays=30&currency=<walletCurrency>&countryCode=<CC>&search=<term>`.
- Resource list query key includes `currency`, `durationDays`, `search`,
  selected `countryCode`, and `pageNumber`.
- Page size for customer resource loading is fixed at 20.
- Quote state is derived from the auto-assigned current resource and quantity
  only.

### 3. Contracts

- When the customer changes resource page/search/currency, stale quote and
  selection state must be cleared before the next page is treated as current.
- `keepPreviousData` / placeholder data may be used for fetch continuity, but
  the page must not render previous-page results as if they were current.
- The visible buy price must come from the current page resource or the fresh
  quote for the current selection, not from an older page token.
- The current quote is keyed by the selected resource snapshot as well as
  `resourceId/quantity/currency`. If the selected row's unit price, currency,
  stock, stale-inventory flag, visibility, saleable flag, or status changes
  after a query invalidation, clear the old quote and request a new one.
- The country selector is backed by `/api/resources/countries`; it must not be
  derived from the current `/api/resources` page because that page is scoped to
  one country and one pagination window.
- Duplicate country summaries must be merged before rendering option cards so
  React keys and selected-country state stay stable.
- The customer UI must not render line/network/SKU card selectors. Resource ids
  may remain copyable for support, but the primary flow is country/region plus
  automatic assignment.

### 4. Validation & Error Matrix

- Page token changes -> clear selected region/resource and quote/loading
  state.
- Current selected resource changes price/stock/saleable snapshot after
  `['resources-list']` or `['resources-countries']` refresh -> clear stale quote
  and re-quote before enabling purchase again.
- Placeholder data while the next page loads -> keep the old request alive, but
  do not expose it as the current page contents.
- Deep pagination or a page number above the current page count -> clamp to the
  last valid page.
- Country search changes -> re-read country summaries, reset selected country
  and resource page, then load the first page for the new selected country.
- `/api/resources/countries` failure -> show a visible country-list error; do
  not fall back to an empty country grid.

### 5. Good/Base/Bad Cases

- Good: clicking page 2 clears the old quote and waits for the new resource
  page before rendering cards.
- Good: invalidating the current resource list after an admin price change
  triggers a second quote request and updates the buy summary to the new price.
- Good: the first screen can show all available countries from
  `/api/resources/countries` while the SKU grid only loads page 1 for the
  selected country.
- Base: page 1 loads normally and selected resource quoting works.
- Bad: using `/api/resources?page=1` as the country list, which hides countries
  that do not happen to appear on the first resource page.
- Bad: the next page briefly shows previous-page cards and quote values as if
  they belonged to the current page.
- Bad: stale `quoteLoading` / `quoteRefreshing` status survives after the user
  changes pages.

### 6. Tests Required

- Customer buy flow test covering page change after a quote selection.
- Customer buy flow test covering search-driven resource page reset.
- Customer buy flow test asserting country summaries are requested from
  `/api/resources/countries` and SKU pages include `countryCode`.
- Customer buy flow test invalidates the selected resource list after a price
  change and asserts a second quote request plus the refreshed total.
- Regression test for duplicate same-country upstream rows rendering one country
  card and preserving unique resource card keys by `resource.id`.
- Regression test asserting the customer buy page does not render the old
  `ipx-buy-network-card` selector or "network 1 / network 2" copy.
- Assertion points: no stale loading tag, no stale quote display, confirm
  disabled until the new current selection is ready.

### 7. Wrong vs Correct

#### Wrong

```ts
const resources = resourcePage?.items ?? [];
const countryGroups = groupResourcesByCountry(resources);
```

#### Correct

```ts
const countryGroups = groupCountrySummaries(countriesQuery.data?.items ?? []);
const resources = resourcePageIsStale ? [] : resourcePage?.items ?? [];
```

---

## Testing Requirements

- **Vitest + Testing Library** for feature behavior: validation, API error
  surfacing, permission/error states, and that mutations hit the real endpoints
  and invalidate the right queries.
- Component tests for tenant-scoped tables must assert `tenantId` appears in the
  API query string.
- **Playwright** smoke tests run against the production bundle for critical flows
  (admin login/list, unauth redirect, customer login/wallet/top-up).
- Regression: existing single-row / filter / export tests must keep passing when
  adding batch or new operations.

---

## Code Review Checklist

- [ ] No direct `fetch`; all I/O via `apiRequest`/`userApiRequest`.
- [ ] All user-facing strings via `t(key)`, keys added to both `zh.ts` and `en.ts`.
- [ ] Mutations invalidate the correct query keys; no optimistic server-state edits.
- [ ] Loading/error/permission states are visible, not empty UI.
- [ ] Role guards in `router.tsx` `beforeLoad` match the menu visibility in
      `_layout.tsx`.
- [ ] New feature has co-located tests under `tests/`.
- [ ] No `any`; local DTOs typed; backend `reasonKey` surfaced on error.

## Scenario: Production Preview SPA Fallback

### 1. Scope / Trigger

- Trigger: E2E smoke tests or local browser checks use `e2e/start-web.cjs` to serve `apps/web/dist`.

### 2. Signatures

- Preview server path: `e2e/start-web.cjs`.
- API proxy rule: only `/api` and `/api/...` proxy to `WEB_API_PROXY_TARGET`.
- SPA fallback candidates: `/`, requests with `Accept: text/html`, or URL paths with no file extension such as `/buy`, `/wallet`, `/api-keys`.

### 3. Contracts

- Customer/admin/public client routes must return `index.html` from the preview server even when the request does not explicitly send `Accept: text/html`.
- Static asset paths with file extensions must keep real 404 behavior when the file is missing.
- `/api-keys` is a frontend route and must not be treated as an API proxy path.
- `/api` and `/api/...` remain the only API proxy prefixes.

### 4. Validation & Error Matrix

- `GET /buy` with default PowerShell or curl-like headers -> `200 index.html`.
- `GET /api-keys` -> `200 index.html`, not `502` from the API proxy.
- `GET /assets/missing.js` -> `404`, not `index.html`.
- `GET /api/resources` -> proxied to backend target.

### 5. Good/Base/Bad Cases

- Good: `Invoke-WebRequest http://127.0.0.1:4173/buy` returns 200 before a Playwright smoke.
- Base: browser navigation with `Accept: text/html` keeps working.
- Bad: matching `pathname.startsWith('/api')`, which accidentally proxies `/api-keys`.
- Bad: falling back to `index.html` for every missing asset, hiding broken bundle references.

### 6. Tests Required

- Run `node --test e2e/start-web.test.cjs` after changing preview proxy or SPA fallback logic.
- Smoke check the preview server with a non-browser request to an extensionless route.
- Browser smoke should still verify page title/text for the same route.
- If adding automated coverage, assert `/assets/missing.js` still returns 404.

### 7. Wrong vs Correct

Wrong:

```js
if (url.pathname.startsWith('/api')) proxyApi(req, res, url);
```

Correct:

```js
if (url.pathname === '/api' || url.pathname.startsWith('/api/')) proxyApi(req, res, url);
```

## Scenario: Frontend Initial Load Budget

### 1. Scope / Trigger

- Trigger: adding or changing top-level routes, route layouts, global CSS, i18n bootstrapping, or Vite chunk configuration.
- Applies to `apps/web/src/app/router.tsx`, `apps/web/src/main.tsx`, `apps/web/src/shared/theme/*.css`, `apps/web/src/shared/i18n/index.ts`, `apps/web/index.html`, and `apps/web/vite.config.ts`.

### 2. Signatures

- Route component signature: `component: lazyPage(() => import('../routes/<area>/<page>'), '<ExportName>')`.
- Entry CSS signature: `main.tsx` imports only `./shared/theme/base.css`.
- Authenticated shell CSS signature: `routes/admin/_layout.tsx` and `routes/customer/_layout.tsx` import `../../shared/theme/tokens.css`.
- Runtime i18n bootstrap: `resources` contains the active language only unless a runtime language switch is implemented.

### 3. Contracts

- Public pages, login/register pages, admin/customer layouts, and content-heavy pages must not be statically imported by `router.tsx`.
- `tokens.css` is the authenticated shell/theme stylesheet and must not be imported by `main.tsx`.
- `base.css` contains only variables and browser reset required before any route chunk loads.
- `index.html` must not load external font stylesheets for the default Chinese deployment; use system font stacks to avoid blocking first paint.
- Vite manual chunks must not force all of `antd` or `@ant-design/icons` into a chunk required by the initial entry.

### 4. Validation & Error Matrix

- `router.tsx` statically imports a route page/layout -> initial JS grows and the route must be converted to `lazyPage`.
- `main.tsx` imports `tokens.css` -> public/auth routes download authenticated shell CSS; move that import back to authenticated layouts.
- `index.html` or CSS imports Google Fonts -> default deployment waits on a remote font endpoint; remove the external font link/import.
- `vite.config.ts` groups `antd` and `@ant-design/icons` as a mandatory vendor chunk -> Ant Design code needed only by lazy routes can be pulled into first load.

### 5. Good/Base/Bad Cases

- Good: `/` initial HTML preloads only the main entry, `vendor-tanstack`, and a tiny `index-*.css`.
- Good: admin/customer navigation loads `tokens-*.css` with the authenticated layout chunk.
- Base: public route CSS such as `home.css` and `buy.css` remains route-local.
- Bad: importing `PublicHomePage`, `AdminLayout`, or `CustomerLayout` directly in `router.tsx`.
- Bad: adding `@import url("https://fonts.googleapis.com/...")` to global CSS.

### 6. Tests Required

- Run `pnpm --filter @ipeasy/web typecheck`.
- Run `pnpm --filter @ipeasy/web lint`.
- Run a clean `pnpm --filter @ipeasy/web build` and inspect `dist/index.html` plus gzip size output.
- Run `node --test e2e/start-web.test.cjs` after changing production preview routing or static asset behavior.
- For changed i18n bootstrap, run the shared i18n copy tests.

### 7. Wrong vs Correct

Wrong:

```tsx
import { PublicHomePage } from '../routes/public/home';

createRoute({ path: '/', component: PublicHomePage });
```

Correct:

```tsx
const publicHomePage = lazyPage(() => import('../routes/public/home'), 'PublicHomePage');

createRoute({ path: '/', component: publicHomePage });
```

Wrong:

```ts
import './shared/theme/tokens.css';
```

Correct:

```ts
import './shared/theme/base.css';
```

## Scenario: Admin Provider Inventory Sync Failure UI

### 1. Scope / Trigger

- Trigger: Admin provider/resource pages call the inventory sync endpoint, especially from provider health/resource setup actions and resource row actions.
- Applies to provider sync mutations, resource row sync mutations, and tests under `features/admin-providers` / `features/admin-resources`.

### 2. Signatures

- Provider sync path: `POST /api/resources/sync-inventory`.
- Resource row sync path: `POST /api/resources/:id/sync-inventory`.
- Successful sync response: `{ attempted, created, updated, skipped, failed, synced, syncedAt, upstreamRawStatus, countries }`.
- Backend failure shape: `ApiError` with `reasonKey`, for example `inventory_empty` or upstream-specific failures.

### 3. Contracts

- Sync failures must derive their failure state from `ApiError.reasonKey`, but
  the provider UI must render a localized `providers.reason.*` / related i18n
  message instead of showing raw machine keys such as `inventory_empty` as the
  primary copy.
- A failed sync must not render the success result block or imply that upstream resources were synced.
- Frontend sync mutations must type the full successful response shape. Do not normalize legacy count-only responses such as `{ synced }` into a successful audit summary.
- Successful sync may invalidate provider/resource/pricing queries, but failure keeps current server state unchanged and visible.
- User-visible labels come from i18n. Unknown backend `reasonKey` values fall
  back to a localized generic provider failure message; raw keys belong in logs
  or debugging details, not the main provider card/drawer/toast copy.

### 4. Validation & Error Matrix

- Backend returns `inventory_empty` -> show the localized provider reason, do not show sync success summary, and do not expose the raw key as primary copy.
- Backend/network failure -> show the localized derived reason, do not clear the provider row.
- Successful provider sync -> show the sync result and invalidate affected server-state queries.
- Successful resource row sync -> show counts and countries from the backend response; missing fields are a contract failure, not values to invent in the UI.

### 5. Good/Base/Bad Cases

- Good: PR sync returns zero items and the page shows the localized "upstream returned no available inventory" reason instead of a green success notice or the raw `inventory_empty` key.
- Good: resource row sync displays `attempted/synced/skipped/countries` from the API response.
- Base: connectivity test and inventory sync have separate visible error slots per provider.
- Bad: catching sync failure and leaving the previous success result visible.
- Bad: treating an empty upstream inventory as an empty successful resource list.
- Bad: converting `{ synced: 1 }` into `{ attempted: 1, updated: 1, countries: [] }`, which hides a stale backend contract.

### 6. Tests Required

- Component test: sync endpoint rejection displays the localized reason derived from `reasonKey` and asserts the raw key is not the primary visible copy.
- Component test: sync endpoint rejection does not render the success result.
- Component test: resource row sync mock uses the full auditable response shape and the UI reads that shape directly.
- Regression: successful sync still renders the sync result and invalidates provider/resource state.

### 7. Wrong vs Correct

Wrong:

```tsx
onError: () => setSyncResult({ synced: 0 });
```

Wrong:

```tsx
const result = {
  attempted: data.attempted ?? data.synced,
  countries: Array.isArray(data.countries) ? data.countries : [],
};
```

This turns an obsolete response contract into a fake successful audit summary.

Correct:

```tsx
onError: (error) => {
  const reason = getReasonKey(error);
  setActionErrors((prev) => ({ ...prev, [provider.id]: reason }));
};
```

Correct:

```tsx
apiRequest<SyncInventoryResult>(`/api/resources/${resourceId}/sync-inventory`, { method: 'POST' });
```

## Scenario: Forms, Route Guards, and Browser Smoke Tests

### 1. Scope / Trigger

- Trigger: login, wallet, and top-up flows depend on React Hook Form, Ant Design, TanStack Router, TanStack Query, and backend error envelopes.

### 2. Signatures

- Login fields: `email`, `password`.
- Top-up fields: `amount`, `channel`.
- Stable E2E submit selector: `button[type="submit"]` when Ant Design spacing changes short Chinese accessible names.

### 3. Contracts

- Ant Design inputs participating in schema validation must be wired through React Hook Form `Controller`.
- `InputNumber` must not rely on `min` as the business validation source of truth; `0` and negative values must reach Zod/RHF and block submit.
- Frontend API/permission failures must render visible errors, not zero balances or empty data.
- TanStack Router routes must not set both `id` and `path`. Use `path` for URL routes and `id` only for pathless layout routes.

### 4. Validation & Error Matrix

- Invalid email -> validation error and no API call.
- Empty password -> validation error and no API call.
- Login `AUTH_REQUIRED`/`invalid_credentials` -> invalid credentials copy, no crash.
- Network failure -> generic network error copy, no crash.
- Top-up `amount <= 0` -> validation error and no `/api/payments` call.
- Wallet `PERMISSION_DENIED` or API 500 -> visible alert, not empty wallet.

### 5. Good/Base/Bad Cases

- Good: tests fill real inputs, submit the form, and assert API call counts plus visible copy.
- Good: E2E waits for login navigation before entering guarded customer routes.
- Base: route guard tests assert unauthenticated admin users redirect to `/admin/login`.
- Bad: `min={0.01}` silently coerces invalid amounts before schema validation sees them.
- Bad: Playwright locks to `getByRole('button', { name: '登录' })` when Ant Design exposes spaced text.

### 6. Tests Required

- Vitest + Testing Library for login validation, API errors, wallet permission/API errors, and top-up invalid amounts.
- Playwright smoke against the production bundle for Admin login/list, Admin unauth redirect, Customer login/wallet, and Customer top-up.

### 7. Wrong vs Correct

#### Wrong

```tsx
<InputNumber min={0.01} />
```

#### Correct

```tsx
<Controller
  name="amount"
  control={control}
  render={({ field }) => <InputNumber {...field} precision={2} />}
/>
```

## Scenario: Admin Route Transition Responsiveness

### 1. Scope / Trigger

- Trigger: admin and customer shells wrap page content during navigation.
- Applies to `shared/ui/route-transition.tsx`, admin/customer layouts, and any route wrapper that changes the rendered page key.

### 2. Signatures

- Wrapper: `<RouteTransition routeKey={location.pathname}>...`

### 3. Contracts

- Route changes should render immediately. Do not introduce a fixed post-navigation timer just to keep a busy overlay visible.
- If a loading state is needed, it must reflect actual pending router or data work, not an artificial delay.

### 4. Validation & Error Matrix

- Navigation completes instantly -> no extra busy state remains visible.
- Real data query still pending -> show the query's own loading/error state, not a fake timer-based state.

### 5. Good/Base/Bad Cases

- Good: clicking a sidebar item swaps content without waiting on a hardcoded animation timer.
- Base: a route change may still feel progressive if a real query or lazy chunk is loading.
- Bad: holding the previous page for a fixed 360ms after every route key change.

### 6. Tests Required

- Wrapper test: route key change remounts content without requiring a timer-driven navigation flag.
- Browser smoke: menu navigation still works while content swaps immediately.

### 7. Wrong vs Correct

#### Wrong

```tsx
window.setTimeout(() => setIsNavigating(false), 360);
```

#### Correct

```tsx
<div key={routeKey}>{children}</div>
```

The router and data layer own loading; the wrapper should not add an artificial pause.
