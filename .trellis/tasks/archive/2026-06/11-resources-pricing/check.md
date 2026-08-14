# Check Results

## Passed

- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test` (6 files, 25 tests)
- `pnpm --filter @ipeasy/api build`
- `pnpm --filter @ipeasy/api export:openapi`
- `pnpm --filter @ipeasy/contracts generate`
- `pnpm --filter @ipeasy/contracts typecheck`
- `git diff --check`

## Not Passed / Environment Blocked

- `pnpm --filter @ipeasy/api test:integration`

Reason: the integration runner exits during config import because the local environment has an invalid `DATABASE_URL` value:

```text
Environment validation failed: { DATABASE_URL: { _errors: [ 'Invalid url' ] } }
```

No integration test body executed. Re-run with a valid PostgreSQL test URL in `DATABASE_URL` or `DATABASE_URL_TEST`.

## Notes

- OpenAPI export initially exposed a real Nest DI issue: `UpstreamAccountsModule` re-declared `UpstreamApiAdapter` without `UpstreamLogRepository`. Fixed by exporting the adapter from `ProvidersModule` and importing `ProvidersModule` from `UpstreamAccountsModule`.
- Resource and pricing APIs now use `ctx.siteId` as source of truth, not client-supplied `siteId`.
- Quote logic now treats missing/stale inventory as `UPSTREAM_ERROR / inventory_stale` and does not fall through to lower-priority pricing after a higher-priority currency mismatch.
- `UpstreamAccountsController` now writes synced upstream resources through `ResourcesRepository` instead of skipping unmapped items and reporting a misleading synced count.
