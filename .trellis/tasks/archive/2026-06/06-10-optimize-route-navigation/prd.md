# Optimize Route Navigation

## Goal

Make page-to-page navigation feel immediate inside the admin and customer consoles.

## Problem

The current route guards call `/api/auth/me` during layout/role checks. For customer routes this happens at the layout boundary, and for admin role routes it also happens in multiple `beforeLoad` hooks. This can make normal menu navigation wait on a network round trip before rendering the next page.

## Requirements

- Avoid blocking every same-session route transition on a fresh `/api/auth/me` request.
- Keep real backend auth as the source of truth; do not decode opaque tokens.
- Token changes must invalidate cached auth state.
- Role checks must still redirect when the current user role is not allowed.
- Page components using `useCurrentCustomer()` / `useCurrentAdmin()` should share the same auth fetch semantics as route guards.

## Acceptance Criteria

- [x] Repeated customer route navigation reuses cached current-user data within a short TTL.
- [x] Repeated admin route navigation and role checks reuse cached current-admin data within a short TTL.
- [x] Changing/removing the session token forces a fresh auth check or redirect.
- [x] Existing auth and route-guard behavior remains intact.
- [x] Relevant frontend tests, typecheck, lint, and build pass.

## Out of Scope

- Backend auth/session changes.
- Route-level code splitting.
- Large dashboard data prefetching.
- Changing page feature queries.

## Technical Approach

- Move current-user fetching into exported helper functions with a module-local token-aware TTL cache.
- Use those helpers from both TanStack Query hooks and TanStack Router `beforeLoad` guards.
- Keep `sessionStorage` tokens opaque and compare only the raw token string for cache invalidation.
- Add focused tests for the auth cache behavior.
