# Task 13 Check

## Summary

Implemented the 985Proxy-compatible `/res_static/*` backend surface and made this platform consumable as a reseller upstream through `UPSTREAM_API`.

## Verification

- `pnpm --filter @ipeasy/api typecheck` — pass
- `pnpm --filter @ipeasy/api lint` — pass
- `pnpm --filter @ipeasy/api test` — pass
- `pnpm --filter @ipeasy/api build` — pass
- `pnpm --filter @ipeasy/api export:openapi` — pass
- `pnpm --filter @ipeasy/contracts generate` — pass
- `pnpm --filter @ipeasy/contracts typecheck` — pass
- `rg '"/api/res_static' packages/contracts/openapi.json packages/contracts/src/generated/api.ts -n` — no matches
- `git diff --check` — pass, with Windows LF/CRLF warnings only

## Notes

- `/res_static/*` now uses the 985-compatible envelope without `requestId`; the normal `/api/*` envelope keeps `requestId`.
- Public ids use `ORD_`, `IP_`, and `RS_` prefixes. Raw UUID inputs are rejected at the compatibility boundary.
- `business` does not invent stock. `inventory` requires fresh inventory snapshots.
- `UPSTREAM_API` consumes `/res_static/inventory`, `/res_static/buy`, and `/res_static/order_result` using `code/msg/data`, `resource_id`, `order_no`, and `proxy_list`.

## Not Run

- `pnpm --filter @ipeasy/api test:integration` was not rerun in this task because this local workspace still lacks a valid `DATABASE_URL`/`DATABASE_URL_TEST` PostgreSQL connection. Previous task 12 hit the same environment blocker before test execution.
