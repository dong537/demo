# Implementation Notes

## Summary

- Added `POST /api/orders/users/:userId/static-proxy` for admin-assisted static proxy purchase.
- Refactored `CreateStaticProxyOrderUseCase` so the buyer context and actor/audit context are separate:
  - buyer context owns quote, wallet debit, order, ledger, and fulfillment job.
  - actor context owns audit `actorType`, `actorId`, action, reason, and metadata.
- Added `UsersRepository.findOrderContextByIdInSite()` and exported `UsersRepository` through `UsersModule`.
- Added Swagger DTOs and regenerated OpenAPI/contracts.
- Added real PostgreSQL integration coverage for platform admin success, tenant admin same/cross-tenant behavior, user denial, required reason, same-user idempotency, and cross-user idempotency conflict.
- Updated `.trellis/spec/backend/database-guidelines.md` and `.trellis/spec/api-contract.md`.

## Verification

- `corepack pnpm --filter @ipeasy/api typecheck` passed.
- `corepack pnpm --filter @ipeasy/api lint` passed.
- `corepack pnpm --filter @ipeasy/api test` passed.
- `corepack pnpm --filter @ipeasy/api build` passed.
- Target integration passed:
  - `corepack pnpm --filter @ipeasy/api exec vitest run --config vitest.integration.config.ts src/modules/orders/tests/admin-customer-order-integration.spec.ts --reporter verbose --bail 1 --testTimeout 60000 --hookTimeout 60000`
  - Result: 7 tests passed.
- Order-related integration suites passed:
  - `corepack pnpm --filter @ipeasy/api exec vitest run --config vitest.integration.config.ts src/modules/orders/tests/purchase-flow-integration.spec.ts src/modules/orders/tests/admin-order-ops-integration.spec.ts src/modules/orders/tests/admin-customer-order-integration.spec.ts --reporter verbose --bail 1 --testTimeout 60000 --hookTimeout 60000`
  - Result: 3 files / 18 tests passed.
- Additional integration batches passed:
  - API/admin/auth/openapi/api-keys/system guard: 6 files / 26 tests passed.
  - wallet/payments/site-scope: 3 files / 20 tests passed.
  - tenant brand/provider accounts/tenants: 3 files / 15 tests passed.
- `corepack pnpm --filter @ipeasy/api export:openapi` passed.
- `corepack pnpm --filter @ipeasy/contracts generate` passed.
- `corepack pnpm --filter @ipeasy/contracts typecheck` passed.
- `git diff --check` passed.

## Notes

- Full `@ipeasy/api test:integration` was attempted with `.env` loaded, but timed out. Splitting suites showed `src/modules/providers/tests/provider-registry-integration.spec.ts` times out by itself before producing test output; that appears unrelated to this order-task change. Timed-out Node worker processes were stopped after each attempt.
