# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend lives in `apps/web` (Vite + React + TypeScript). Code is organized
into three layers: thin **route** files, fat **feature** components, and
cross-cutting **shared** utilities. Routes only wire URLs to features; all data
fetching and UI lives in features; anything reused across feature domains lives
in `shared`.

---

## Directory Layout

```
apps/web/src/
├── app/
│   ├── providers.tsx        # React Query client, antd config, i18n provider
│   └── router.tsx           # All TanStack Router routes + role guards (single file)
├── features/
│   └── <domain>/            # e.g. admin-tenants, admin-orders, wallet, auth
│       ├── <name>.feature.tsx     # business component (data + UI)
│       ├── <name>.feature.spec.ts # co-located unit spec (optional)
│       └── tests/                 # co-located component/integration specs
│           └── *.spec.tsx
├── routes/
│   ├── admin/
│   │   ├── _layout.tsx      # admin shell: Sider menu + Header, role-based items
│   │   ├── login.tsx
│   │   └── <section>/
│   │       ├── index.tsx           # list/landing page
│   │       ├── new.tsx             # create page
│   │       ├── $tenantId.tsx       # dynamic-segment detail page
│   │       └── $tenantId.brand.tsx # nested dynamic page
│   └── customer/
│       ├── _layout.tsx
│       └── <section>/index.tsx
├── shared/
│   ├── api/client.ts        # apiRequest / userApiRequest / buildQuery / ApiError
│   ├── auth/current-user.ts # useCurrentAdmin / useCurrentCustomer
│   ├── i18n/{index,zh,en}.ts
│   └── ui/list-page.tsx     # shared <ListPage> (loading/error/perm/pagination)
├── main.tsx
└── test-setup.ts
```

---

## Module Organization

A new feature is added in two steps:

1. **Create a feature component** under `features/<domain>/<name>.feature.tsx`.
   It owns data fetching (React Query), mutations, and the rendered UI.
2. **Create a thin route file** under `routes/<area>/...` that imports and renders
   the feature. Route files should be a single component that returns the feature
   with any props — see [routes/admin/resellers/index.tsx](../../../apps/web/src/routes/admin/resellers/index.tsx),
   which is just `<TenantListFeature mode="reseller" />`.
3. **Register the route** in [app/router.tsx](../../../apps/web/src/app/router.tsx)
   (all routes are declared in this one file) and add a menu entry in the relevant
   `_layout.tsx` if it needs navigation.

**Reuse over duplication.** When two areas share behavior (e.g. `tenants` and
`resellers`), parameterize one feature with a `mode` prop rather than copying the
component. The reseller pages reuse the admin-tenants features this way.

---

## Naming Conventions

- Feature files: `kebab-case.feature.tsx`; exported component is `PascalCase` +
  `Feature` suffix (e.g. `TenantListFeature`).
- Route page components: `PascalCase` + `Page` suffix (e.g. `AdminResellersPage`).
- Dynamic route segments use TanStack file naming: `$paramName.tsx`, with nested
  segments as `$paramName.child.tsx`.
- Layout/pathless routes: `_layout.tsx`.
- Tests: `*.spec.ts(x)`, co-located in the feature's `tests/` folder (or next to
  the file for pure-logic specs).

---

## Examples

- Thin route → feature: [routes/admin/resellers/index.tsx](../../../apps/web/src/routes/admin/resellers/index.tsx)
- Parameterized reuse: [features/admin-tenants/tenant-list.feature.tsx](../../../apps/web/src/features/admin-tenants/tenant-list.feature.tsx)
- Shared list scaffold: [shared/ui/list-page.tsx](../../../apps/web/src/shared/ui/list-page.tsx)
- Central routing + guards: [app/router.tsx](../../../apps/web/src/app/router.tsx)
