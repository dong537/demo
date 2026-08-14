# Type Safety

> Type safety patterns in this project.

---

## Overview

The frontend is **TypeScript** in strict mode. There is a generated API contract
(`packages/contracts` via openapi-ts) that is the canonical source for request/
response shapes. In practice, feature components also declare **local DTO
interfaces** matching the slice of the contract they consume, kept close to the
component that uses them.

---

## Type Organization

- **Generated contract types** live in `packages/contracts/src/generated/api.ts`
  and are the source of truth for the HTTP surface.
- **Local DTO interfaces** are declared at the top of the feature file that uses
  them (e.g. `TenantDto`, `TenantBrandDto`). Use these for the specific fields a
  component renders.
- **Shared cross-cutting types** live in `shared/` (e.g. `CurrentUser` in
  [shared/auth/current-user.ts](../../../apps/web/src/shared/auth/current-user.ts),
  `ApiEnvelope` / `ApiError` in [shared/api/client.ts](../../../apps/web/src/shared/api/client.ts)).
- The API envelope is typed once (`ApiEnvelope<T>`) and unwrapped centrally so
  features only ever see `T`.

---

## Validation

- Runtime validation of API responses is handled centrally in `requestEnvelope`:
  a non-zero `code` throws `ApiError(code, reasonKey, details)`.
- Form input validation uses antd `Form` rules for simple cases, and **React Hook
  Form + Zod** for flows with non-trivial constraints (login, wallet top-up). antd
  inputs in those flows are wired through RHF `Controller` (see the forms scenario
  in `quality-guidelines.md`).
- Business validation must reach the schema, not be silently coerced by antd input
  props (e.g. do not rely on `InputNumber min` as the validation source of truth).

---

## Common Patterns

- Discriminated unions for role/state: `ownerType: 'USER' | 'TENANT_ADMIN' |
  'PLATFORM_ADMIN' | 'SYSTEM'`.
- Variant props as string-literal unions: `mode?: 'tenant' | 'reseller'`.
- Generic shared components: `ListPage<T extends object>` and `PageResult<T>`.
- `instanceof ApiError` narrowing in `onError` / `catch` to read `reasonKey`.

---

## Forbidden Patterns

- `any` in feature code. The one sanctioned exception is the `AnyRoute` cast in
  [app/router.tsx](../../../apps/web/src/app/router.tsx), localized behind an
  eslint-disable for TanStack Router's parent-route typing.
- Casting API responses with `as` to skip the envelope; always go through
  `apiRequest`/`userApiRequest`.
- Decoding opaque session tokens (`atob(token.split('.')[1])`) to infer types or
  roles.
- Hardcoded magic strings for user-facing text — they belong in i18n, not the
  type/render layer.
