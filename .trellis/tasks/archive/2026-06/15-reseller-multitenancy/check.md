# Task 15 Check

## Summary

- Implemented tenant/admin site-scope hardening for tenants, wallets, payments, orders, fulfillment refunds, and 985 wallet records.
- Added tenant API DTO/OpenAPI schemas and regenerated contracts.
- Added real-DB integration regression specs for tenant listing/detail/status scope and platform-admin cross-site payment/wallet denial.

## Validation

- PASS `pnpm --filter @ipeasy/api typecheck`
- PASS `pnpm --filter @ipeasy/api lint`
- PASS `pnpm --filter @ipeasy/api test`
- PASS `pnpm --filter @ipeasy/api build`
- PASS `pnpm --filter @ipeasy/api export:openapi`
- PASS `pnpm --filter @ipeasy/contracts generate`
- PASS `pnpm --filter @ipeasy/contracts typecheck`
- PASS `git diff --check`
- BLOCKED `pnpm --filter @ipeasy/api test:integration`

## Integration Blocker

`test:integration` fails before running assertions because local env validation rejects `DATABASE_URL` as an invalid URL:

```text
Environment validation failed: { DATABASE_URL: { _errors: [ 'Invalid url' ] } }
```

The new integration specs are discovered by Vitest, but they cannot execute without a valid PostgreSQL `DATABASE_URL_TEST`/`DATABASE_URL`.

## Key Assertions Added

- `PLATFORM_ADMIN` tenant list returns a paged result scoped to current `siteId`.
- `TENANT_ADMIN` tenant list returns only its own tenant.
- Tenant detail stats are scoped by `(siteId, tenantId)` and use decimal aggregation.
- `PLATFORM_ADMIN` cannot read/update a tenant from another site.
- `PLATFORM_ADMIN` payment list cannot include another site's payment orders.
- `PLATFORM_ADMIN` cannot confirm another site's payment order.
- `PLATFORM_ADMIN` cannot adjust another site's wallet.
