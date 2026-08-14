# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Data fetching and server state are handled exclusively with **TanStack Query**
(`@tanstack/react-query`). Routing hooks come from **TanStack Router**
(`@tanstack/react-router`). i18n comes from **react-i18next**. Custom hooks are
thin wrappers that encapsulate a query plus its invariants (e.g. auth identity).

---

## Custom Hook Patterns

- Custom hooks are named `use*` and live in `shared/` when cross-cutting (e.g.
  `useCurrentAdmin`, `useCurrentCustomer` in
  [shared/auth/current-user.ts](../../../apps/web/src/shared/auth/current-user.ts)).
- A custom hook wraps a `useQuery` and enforces a contract inside `queryFn`. For
  example, `useCurrentAdmin` calls `/api/auth/me` and throws
  `ApiError('PERMISSION_DENIED', ...)` if the owner type is not an admin role.
- Keep feature-specific query logic inline in the feature component; only promote
  to a shared hook when reused across domains.

---

## Data Fetching

- **Reads:** `useQuery` with a structured `queryKey` and a `queryFn` that calls
  `apiRequest` / `userApiRequest` from [shared/api/client.ts](../../../apps/web/src/shared/api/client.ts).
  Never call `fetch` directly in a feature.
- **Writes:** `useMutation` whose `mutationFn` calls `apiRequest`, with
  `onSuccess` invalidating affected queries via `queryClient.invalidateQueries`.
- **Never optimistically rewrite server state** (order status, wallet balance,
  proxy rows). Submit intent, then invalidate and re-read. The backend is the
  source of truth (see `state-management.md` scenarios).
- Build query strings with `buildQuery({ ... })`, which drops `undefined`/`null`/
  empty values.

### Query key conventions

Query keys are arrays starting with a stable domain string, followed by the
variables that scope the data, e.g.:

- `['tenants', page, pageSize]`
- `['tenant-brand', tenantId]`
- `['auth', 'me', 'admin']`
- `['admin-orders', tenantId, page, pageSize, status]`

Invalidate with the broadest stable prefix that covers the affected data (e.g.
`['admin-orders']`) plus any specific detail key (`['order-fulfillment', id]`).

---

## Naming Conventions

- All hooks start with `use`.
- Identity/role hooks: `useCurrentAdmin`, `useCurrentCustomer`.
- TanStack hooks are used directly (`useQuery`, `useMutation`, `useQueryClient`,
  `useNavigate`, `useLocation`, `useTranslation`); they are not re-wrapped unless
  adding a contract.

---

## Common Mistakes

- Calling `fetch` directly instead of `apiRequest`/`userApiRequest` (loses the
  envelope unwrapping, token header, and `ApiError` mapping).
- Forgetting to `invalidateQueries` after a mutation, leaving stale UI.
- Parsing `sessionStorage.admin_token` as a JWT to read the role — it is an opaque
  token. Always use `useCurrentAdmin()` / `/api/auth/me`.
- Over-broad or unstable query keys that prevent correct cache invalidation.
