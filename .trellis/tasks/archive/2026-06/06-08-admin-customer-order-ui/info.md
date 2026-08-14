# 管理端代客下单前端实现记录

## Technical Design

- Admin users list owns the entry point and passes the selected row as target customer context.
- `AdminCustomerOrderDrawer` owns form state, local required-field validation, idempotency key generation, and the mutation to `POST /api/orders/users/:userId/static-proxy`.
- Resource options come from `GET /api/resources?pageSize=200&status=ACTIVE`.
- Target wallet currency and balance come from `GET /api/wallet/:userId`; the currency field is displayed as read-only form state.
- Backend remains the source of truth for quote, wallet debit, order creation, fulfillment job, and audit log.
- Successful mutations invalidate `['admin-orders']`, `['users']`, and `['admin-user-wallet', userId]`.
- Admin order list now exposes `userId` filtering so operators can inspect the newly created customer order without leaving the admin UI flow.
- A predeploy smoke integration spec covers `/health`, `/ready`, `/openapi.json`, login, assisted order, wallet debit, order list, and audit log through real HTTP and a real PostgreSQL/Redis-backed app.

## Affected Files

- `apps/web/src/features/admin-users/admin-customer-order-drawer.feature.tsx`
- `apps/web/src/features/admin-users/user-list.feature.tsx`
- `apps/web/src/features/admin-orders/order-list.feature.tsx`
- `apps/web/src/features/admin-users/tests/admin-customer-order.spec.tsx`
- `apps/web/src/features/admin-tenants/tests/tenant-scoped-lists.spec.tsx`
- `apps/web/src/shared/i18n/en.ts`
- `apps/web/src/shared/i18n/zh.ts`
- `apps/api/src/common/tests/predeploy-smoke-integration.spec.ts`
- `.trellis/spec/frontend/state-management.md`

## Verification

- `corepack pnpm --filter @ipeasy/web typecheck`
- `corepack pnpm --filter @ipeasy/web lint`
- `corepack pnpm --filter @ipeasy/web test`
- `corepack pnpm --filter @ipeasy/web build`
- `corepack pnpm --filter @ipeasy/api typecheck`
- `corepack pnpm --filter @ipeasy/api lint`
- `corepack pnpm --filter @ipeasy/api test`
- `DATABASE_URL=postgresql://ipipx:ipipx@localhost:15432/ipipx DATABASE_URL_TEST=postgresql://ipipx:ipipx@localhost:15432/ipipx REDIS_URL=redis://localhost:6379 corepack pnpm --filter @ipeasy/api exec vitest run --config vitest.integration.config.ts src/modules/orders/tests/admin-customer-order-integration.spec.ts src/common/tests/predeploy-smoke-integration.spec.ts`

## Notes

- Local smoke reused the existing `ipipx-postgres-1` and `ipipx-redis-1` Docker containers because ports `15432` and `6379` were already bound by them.
- `corepack pnpm --filter @ipeasy/db migrate:deploy` was run against the local smoke database before smoke.
- The first smoke attempt timed out before progress output because local dependencies were not reachable/migrated; after explicit local env and migration, the smoke passed.
