# Component Guidelines

> How components are built in this project.

---

## Overview

Components are built with **React + TypeScript** and **Ant Design (antd)** as the
sole UI kit. There are two component roles:

- **Feature components** (`*.feature.tsx`) — own data fetching, mutations, and the
  full rendered section. This is where most code lives.
- **Shared UI** (`shared/ui/*`) — generic, reusable scaffolds like `ListPage`.

No custom CSS framework, no styled-components, no CSS modules. Layout uses antd
components plus inline `style={{ ... }}` for one-off spacing.

---

## Component Structure

A feature component follows this order:

1. Local DTO `interface` for the data shape (defined at top of file).
2. Props `interface` (suffix `FeatureProps`) if the feature is parameterized.
3. Hooks in this order: `useTranslation`, `useNavigate`, `useQueryClient`, local
   `useState`, `useCurrentAdmin`/`useCurrentCustomer`, then `useQuery` /
   `useMutation`.
4. Derived values (role checks, path prefixes).
5. antd column / form definitions.
6. Loading / error early returns, then the rendered tree.

See [features/admin-tenants/tenant-list.feature.tsx](../../../apps/web/src/features/admin-tenants/tenant-list.feature.tsx)
and [features/admin-tenants/tenant-brand.feature.tsx](../../../apps/web/src/features/admin-tenants/tenant-brand.feature.tsx)
as canonical examples.

---

## Props Conventions

- Props interfaces are named `<Component>Props` and typed explicitly (no inline
  object types in the signature).
- Prefer a `mode` / variant prop to fork shared behavior instead of duplicating a
  component (e.g. `mode?: 'tenant' | 'reseller'`, `backMode?: ...`).
- Provide sensible defaults via destructuring defaults
  (`{ mode = 'tenant' }: Props = {}`).

---

## Styling Patterns

- **Ant Design components only** for structure (`Layout`, `Table`, `Form`,
  `Space`, `Typography`, `Button`, `Alert`, `Skeleton`, `Drawer`, `Modal`,
  `message`).
- One-off spacing/layout via inline `style` props (e.g.
  `style={{ marginBottom: 16 }}`). No external stylesheet per feature.
- **Exception — public-facing pages** (landing/home, auth login/register): these
  may use a namespaced stylesheet (e.g. `home.css` with `.landing-*`,
  `auth.css` with `.auth-*`) for richer visual layout. Keep class names prefixed
  so styles never leak into the antd admin/customer pages. This exception does
  not apply to admin/customer feature components, which stay antd + inline style.
- Public-facing purchase previews may explain the real workflow and link into the
  authenticated purchase page, but they must not synthesize resource rows,
  countries, cities, stock, prices, or provider lines when the public site
  configuration/API does not provide them. Render a visible empty state instead,
  and keep the authenticated purchase link available.
- Public landing and public purchase pages that read `/api/sites/current` must
  show honest loading, error, and empty states. Do not render default countries,
  default SKU counts, default inventory, or "live" price hints while the site
  configuration is still loading or has failed.
- Public content information architecture must keep long-lived learning material
  under the tutorial/help surfaces instead of adding more top-level navigation
  channels. Do not expose standalone "partners" or "news" entries in the public
  header/footer unless product explicitly reintroduces them. News-style content
  may remain on legacy routes for link stability, but normal discovery should
  happen from `/tutorials`.
- Public help centers should follow a knowledge-base layout: a search/header
  area, a compact directory, and grouped article/question links. Avoid rigid
  three-column icon grids for FAQ categories because they read like a table and
  slow down scanning. Use the tutorial article directory pattern as the reference
  when redesigning `/faq`.
- Use `Typography.Title level={4}` for section headings.
- Use `message.success(...)` for transient success feedback; use `Alert` for
  persistent inline errors.

### Table Surfaces

- Use `shared/ui/ListPage` for standard admin/customer list tables. It provides
  the shared table shell, loading state, error state, and the default compact
  pagination contract.
- `ListPage` tables should inherit the shared `ipx-list-table-card` chrome and
  the global Ant Design table tokens. Do not restyle header, row hover, selected
  row, or pagination chrome inside a feature unless the surface truly needs a
  distinct workspace.
- For custom table workspaces that are not a plain `ListPage`, wrap the table in
  a named surface class such as `ipx-customer-table-card` or
  `ipx-reseller-table-card` so the shared theme can target it consistently.
- Page-specific table styling should stay exceptional and namespaced. If a page
  needs different chrome, add a surface class and document it instead of copying
  table CSS into the feature file.

### Admin Dashboard Workspaces

Admin dashboard pages are audit surfaces. Every metric must have an obvious
server-state source:

- KPI values must come from real admin queries. If the backend does not return a
  delta, trend, health score, or conversion rate, omit that badge instead of
  showing `+0`, `0%`, or another placeholder.
- Admin resource, pricing, dashboard, assisted-order, and provider setup pages
  must not present inventory snapshots, stale/expired inventory, zero-stock
  counts, or manual stock editing as product state. Keep these surfaces focused
  on configured resources, pricing, saleability, upstream sync action results,
  and order/purchase records. If a sync fails, show the backend failure result;
  do not turn snapshot freshness into a purchase-readiness signal.
- Revenue or wallet totals may only be aggregated when the source rows share the
  same currency. Mixed-currency data should be shown as separate values or
  omitted from the aggregate.
- Provider, proxy, request-log, and API-key panels may group fields for scanning,
  but must keep traceable identifiers visible: provider code/account id,
  resource id/source code, request id, order id, API key prefix, status, and
  created/updated timestamps.
- Admin order list rows should read as compact purchase records, not an audit
  dump. Keep high-frequency scanning fields in the table: short copyable order
  id, user, tenant, product/resource, provider/upstream marker, amount, status,
  and the action menu. Do not show low-frequency detail such as tenant-admin
  email, update time, fulfillment job id, or missing-cost warnings in the main
  table; those belong in the order detail/fulfillment surfaces.
- Admin resource list rows should keep the main product card to the localized
  location title plus compact copyable code/id. Do not render repeated type
  tags, missing-city/line fallback tags, raw English upstream names, or full
  UUIDs in the primary scan path; full identifiers belong in copy affordances or
  detail panels.
- Error, sync, and health panels must clear stale success summaries when a new
  backend failure occurs. A failed sync or health check must never leave the last
  green success block as the only visible result.

### Admin Provider Resource Setup

The provider sale configurator is an operator setup surface for real upstream
resources. It must render the current server page as individual upstream resource
rows so operators can choose exactly which returned resource is saleable:

- The drawer query must scope `/api/pricing/matrix` by the current
  `providerCode` and use `pageSize=20`. Do not load a global matrix page and
  then filter by provider in the browser; providers that do not appear on that
  global page will render as empty while pagination still shows unrelated rows.
- Do not background-load every matrix page from the drawer. Fetch page 1 quickly,
  request another page only when the operator clicks the pager, and keep the
  page-size switcher hidden.
- Each table row represents one real `resourceId`. Duplicate country/region
  resources must remain separate rows because provider saleability is now chosen
  at the upstream-resource level, not by a merged customer-facing location group.
- Keep the backend source of truth unchanged: sale toggles call
  `PUT /api/providers/:id/resources/saleability` with only the changed loaded
  resource ids, while the backend rebuilds `enabledCountryCodes` from the final
  full provider resource set. Do not derive provider country codes from the
  current frontend page.
- Price saves call the existing pricing override mutation for the exact
  `resourceId` row being edited. Do not fan out one row's price to hidden
  duplicates.
- All/select-clear actions in the drawer operate on the currently loaded page
  only. They must not imply hidden pages were selected or cleared.
- When server-page data is temporarily empty during a page switch, do not clamp
  pagination back to page 1 until the new page request has finished; otherwise
  page 2 immediately reverts to page 1 and operators cannot reach later resources.
- Show localized country/region labels through `formatResourceLocationZh(...)`
  and keep one traceable source code visible for support. Do not add manual
  inventory snapshot editing to this operator setup surface.
- Filtering/searching must be pushed into the matrix query and still match
  resource codes, names, and display names.
- Tests must cover fixed `pageSize=20`, no background all-page load, current-page
  select/clear saves, duplicate-region resources rendering as separate rows, and
  price saves targeting one real resource id.
- Sync failure and health error surfaces must replace stale success summaries
  instead of stacking a new error block under the old green result.

Bad: opening the drawer and looping over every matrix page before rendering, or
using a transient `total=0` during page 2 loading to jump the pager back to page 1.

Good: rendering the first 20 scoped provider resources immediately, then fetching
page 2 only after the operator clicks page 2 and saving changes for the exact
resource ids the operator touched.

### Customer Purchase Workspaces

Customer purchase pages are transactional tools, not marketing pages. Keep the
first screen focused on the real selection path and checkout state:

- Show real server-backed resource selectors (`/api/resources`) and quote/order
  state prominently; do not add duplicate "product intro" cards that do not
  affect the submitted request.
- Use a dense console layout for high-cardinality resources: grouped selectors
  on the left/middle and a sticky checkout summary on desktop.
- The checkout panel may be visually emphasized when a real resource is selected,
  but it must still submit only through the backend order mutation and refresh
  server state.
- Preserve existing query/mutation contracts while changing layout. UI polish must
  not remove country/region labels, quote loading/error states, or the disabled
  reason shown before the order can be submitted.
- Keep the primary selector focused on purchase actions. Do not surface internal
  implementation notes such as the initial resource page size, stale inventory
  snapshot policy, or backend pricing authority as large inline callouts in the
  selection area; retain search, quote status, and actionable error states.
- For static proxy purchase, customers select country/region and then, only when
  needed, an anonymous cost line such as `Line 1` / `Line 2` generated from the
  backend `costGroupKey`. A selected line still auto-assigns a real saleable
  resource through `getPreferredResource(...)` and refreshes
  `/api/pricing/quote`; do not render raw network/SKU/upstream-resource cards or
  expose upstream cost amounts to customers. Keep continent filtering and region
  search in the region panel, keep quantity and checkout in the sticky order
  panel, and keep resource ids as trace/copy details instead of primary customer
  choices.
- `getPreferredResource(...)` must prefer a resource with configured price and
  fresh positive inventory before falling back to a more specific region resource
  that only has price. Specificity must not cause the UI to auto-quote a
  zero-stock or stale resource when another resource in the same line can pass
  the backend quote inventory gate.
- Admin assisted-order and user-specific pricing surfaces must use the same
  country/region grouping. Operators can bulk price every saleable resource in a
  selected region, but the UI should not expose per-network selection as the
  normal path.
- Admin resource quick pricing groups concrete resources by country/region for
  the operator-facing selector. Same location + different upstream costs should
  remain one region card with the cost shown as a range/summary, not separate
  "line" cards. The frontend must still keep the hidden real cost-group
  selectors from the backend and fan out price saves to each cost group so no
  concrete resource is missed. Do not append operator-facing `Line 1` / `Line 2`
  labels in the admin resource pricing path.
- Resource labels must distinguish upstream line codes from generic product codes.
  Compact upstream codes like `USAVIRASH` or `US:USACALLAX` may be parsed into
  Chinese city labels, but generic product identifiers/names like `US_STATIC` or
  `US Static` must remain country-level labels rather than being guessed as city
  lines. Add regression coverage in `shared/resource/resource-labels.spec.ts`
  when changing this parser.

### Customer Dashboard Workspaces

Customer dashboard pages should read like operational consoles while staying
strictly server-backed:

- KPI strips and summary cards must be derived from the feature's real queries
  (`/api/wallet`, `/api/proxies`, `/api/orders`, `/api/api-keys`, reseller and
  ticket endpoints). Do not invent growth percentages, health scores, or counts
  that the backend did not return.
- When a page needs a process hint (for example reseller setup or ticket support
  flow), present it as navigation/workflow context only. Do not turn the hint into
  fake status data or a fake completed step.
- Status chips, recent activity, and "last reply" fields must either use real
  response fields or visibly fall back to a real timestamp such as `updatedAt`.
  Never synthesize human replies, fulfillment messages, or upstream availability.
- High-density customer tables may merge related facts into one column for scan
  speed, but must keep real identifiers visible enough for support: order id,
  proxy id/endpoint, resource/source, status, and created/updated timestamps.
- Copy/export/lifecycle actions must call the existing real endpoints or reuse the
  existing copy modal. Do not add shortcut buttons for backend actions that do not
  exist for the customer role.
- Customer proxy list pages should avoid extra metric strips that duplicate the
  status tabs or table header. Keep row-derived counts in the tabs/header, and do
  not surface debug delivery counters, raw i18n keys, or English implementation
  hints in the work area.
- Customer proxy list pages should default to the actionable list: filters,
  status tabs, selection tools, and rows. Do not render an always-visible
  selected/first proxy credential panel above the list; connection credentials
  belong in an explicit row detail or copy modal.
- Customer proxy-check pages may show localized backend `reasonKey`, latency, and
  reachability state, but must not render machine error codes such as
  `PROXY_UNREACHABLE` or raw `NOT_FOUND` as normal customer-facing copy. Keep
  those values in logs, audit records, and backend payloads rather than the
  customer result card.
- Customer wallet overview cards should stay focused on the available balance and
  wallet actions such as top-up and refresh. Do not put account ids, wallet API
  source strings, balance-composition bars, or duplicated frozen/available metric
  cards in the primary wallet summary; those details belong in admin/audit views
  or explicit support/detail surfaces.
- Customer wallet/ledger pages must translate backend ledger reasons into
  customer-readable business labels. Known reasons such as
  `payment_order_confirmed`, `static_proxy_order`, and
  `fulfillment_failed_refund` should render as "充值到账", "购买静态代理", and
  "购买失败退款" (plus matching English i18n). Do not show raw reason keys as the
  primary row title.
- Ledger identifiers are support handles, not the customer-facing title. Show a
  short recognizable transaction suffix such as `交易号尾号 {{id}}` and keep the
  full id out of the main scan path. Backend/audit views may still show full ids.
- Customer wallet/ledger pages must translate backend ledger `reason` values into
  customer-readable business actions (for example `static_proxy_order` ->
  "购买静态代理") and avoid showing full UUIDs as the main row copy. Keep a short
  transaction suffix visible for support lookup, while preserving the full ledger
  id only in backend/audit data or explicit copy/detail affordances.

### Display Pagination

- Display-oriented queries and selector option lists must default to `pageSize`
  20. Do not fetch hundreds of rows for cards, dashboards, dropdowns, modal
  pickers, or summary panels just to filter them in the browser.
- When a selector can exceed 20 records, push search terms into the API query and
  show a pager in the picker surface. Keep selected values stable across page
  changes with an explicit selected-item snapshot when the current page no
  longer contains the chosen record.
- Shared table/list surfaces should not expose a page-size changer unless the
  product explicitly needs it; the default operational contract is 20 rows per
  page.

### Convention: Purchase Page Hierarchy Labels

**What**: Static proxy purchase pages must render the hierarchy as
country-first, then region/SKU, and derive display labels from
`formatResourceLocationZh(...)`.

**Why**: This keeps the selector stable for Chinese users and prevents random
English fallback labels from leaking into card titles, summaries, or selected
resource pills.

The visible card stack should render the country on the first line and the
region/SKU detail on the second line. When only a country exists, keep the
second line empty rather than inventing a region label.

**Example**:
```tsx
const location = formatResourceLocationZh(resource);
const title = location.city ?? location.line ?? location.detail ?? location.country;
const subtitle = location.city && location.line
  ? `${location.country} · ${location.line}`
  : location.country;
```

**Do not**:
```tsx
const title = index === 0 ? 'Random' : resource.displayName;
```

### Convention: Admin Resource Location + Price Copy

**What**: Admin resource tables should show location text through
`formatResourceLocationEn(...)`, while price-edit actions and labels stay in
Chinese via `shared/i18n/zh.ts`.

**Why**: Operators need a stable English location scan path, but the action
surface must remain Chinese for the team that edits prices every day.

**Example**:
```tsx
const location = formatResourceLocationEn(row);
<Typography.Text>{location.title}</Typography.Text>
<Button>{t('resources.modifyPrice')}</Button>
```

**Do not**:
```tsx
<Button>Modify Price</Button>
<Tag>{row.countryCode}</Tag>
```

---

## Accessibility

- Rely on antd's built-in accessible roles; do not strip ARIA attributes.
- For E2E stability, prefer stable selectors like `button[type="submit"]` over
  localized accessible names (Chinese labels with antd spacing are brittle) —
  see the smoke-test scenario in `quality-guidelines.md`.

---

## Common Mistakes

- Writing a near-duplicate feature for a sibling area instead of adding a `mode`
  prop to the existing one.
- Putting data fetching in the route file instead of the feature component.
- Hardcoding user-visible strings instead of routing them through `t(key)` (see
  `type-safety.md` / i18n rules).
- Reaching for a non-antd UI library or raw HTML form controls when an antd
  equivalent exists.
- Adding per-feature table chrome when the same surface can reuse
  `ListPage` + shared table tokens.
