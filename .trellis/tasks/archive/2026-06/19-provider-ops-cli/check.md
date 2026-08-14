# Task 19 Check

## Commands

- `pnpm --filter @ipeasy/api typecheck` - pass.
- `pnpm --filter @ipeasy/api lint` - pass (`eslint src`).
- `pnpm --filter @ipeasy/api test` - pass, 14 files / 58 tests.
- `pnpm --filter @ipeasy/api build` - pass.
- `pnpm --filter @ipeasy/api exec tsc --noEmit --pretty false --target ES2022 --module CommonJS --moduleResolution node --strict --skipLibCheck --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --strictPropertyInitialization false scripts/_provider-ops.ts scripts/provider-credential.ts scripts/providers-health-check.ts scripts/providers-sync-inventory.ts scripts/providers-test-buy.ts` - pass.
- `pnpm --filter @ipeasy/api exec eslint scripts src` - blocked by existing ESLint project-service scope because `scripts/**/*.ts` is not included in `apps/api/tsconfig.json`; covered by the dedicated script `tsc` command above.

## Review

- Native provider CLI accepts only `IPIPD`, `NINE_EIGHT_FIVE`, and `PR`; `UPSTREAM_API` remains in `upstream_api_accounts`.
- `provider:set-credential` encrypts credentials before DB write, validates provider-specific credential shapes, validates base URL through SSRF guard, and prints only metadata.
- `--tenant` is explicit and tenant-scoped writes/read paths include `tenantId`; omitted tenant means site-global account.
- `providers:health-check` deduplicates historical provider account rows to the latest row per scope and judges the registry's effective config, preserving tenant-disabled -> site-global fallback.
- `providers:sync-inventory` delegates write behavior to `SyncInventoryUseCase` instead of duplicating resource/snapshot/mapping logic.
- `providers:test-buy` defaults to dry-run, requires `--execute`/`--no-dry-run` plus `--confirm` for real purchase, includes required `currency`, and redacts delivered proxy passwords.
- Added `provider-ops.validation` unit tests for credential narrowing, CLI usage error classification, and secret redaction.

## Residual Risk

- Real upstream CLI smoke checks require live `DATABASE_URL`, `APP_ENCRYPTION_KEY`, site/provider accounts, and provider credentials, so they were not executed in this local verification pass.
