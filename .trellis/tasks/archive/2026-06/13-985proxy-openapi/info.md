# Task 13 Technical Design

## Goal

Expose a 985Proxy-compatible customer OpenAPI under `/res_static/*` so a reseller site can be used as an upstream provider by another site. The API must authenticate with the existing user API key or bearer-token guard and return the 985-style envelope:

```ts
{ code: 0, msg: "success", data: T }
{ code: ErrorCode, msg: string, data: null }
```

## Source of Truth

- Auth context: existing `AuthGuard` + `UserGuard`; OpenAPI code does not re-implement permission logic.
- Resource list and inventory: `ResourcesRepository`; missing/stale inventory is an error, not stock `0`.
- Quote: `QuoteUseCase`; pricing and inventory checks stay behind the use case.
- Orders: `CreateStaticProxyOrderUseCase` and `OrdersRepository`; no direct order writes in the OpenAPI controller.
- Proxy delivery: `ProxiesRepository`; passwords are decrypted only at the response mapping boundary.
- Wallet: `WalletRepository`; balances and ledger pages come from the ledger source of truth.

## Boundaries

- `res-static.controller.ts`: HTTP orchestration, body validation, tenant ownership checks, 985 envelope wrapping.
- `res-static.dto.ts`: TypeScript request/response shapes for the compatibility API.
- `res-static.mapper.ts`: stable 985 field names and reversible public identifiers.
- `upstream-api.adapter.ts`: consumes the same 985 envelope when this platform is configured as an upstream.
- Bootstrap/test/export setup: global `/api` prefix excludes `/res_static/*`.

## Interface Contracts

- Public order number: `ORD_<uuid-without-dashes>`.
- Public proxy id: `IP_<uuid-without-dashes>`.
- Public resource id: `RS_<uuid-without-dashes>`.
- Incoming ids must decode back to UUIDs; invalid ids return `VALIDATION_ERROR`.
- `/res_static/order_result` accepts `order_no`; `order_id` is accepted only as a transitional alias for internal callers that already exist in this repo.
- `/res_static/ip_detail`, `renew`, `change_auth`, and `switch_ip` accept `proxy_id` in the public id format.

## Data Flow

External caller -> `apikey`/Bearer auth -> controller body validation and id decode -> existing repository/use case -> mapper -> 985 envelope.

When another site uses this site as `UPSTREAM_API`: provider adapter -> `/res_static/*` -> parse `code/msg/data` -> provider-domain result.

## Risks And Verification

- Route prefix drift: verify OpenAPI contains `/res_static/*` and not `/api/res_static/*`.
- Hidden UUID leak: mapper tests must cover public id encoding/decoding.
- False inventory: inventory endpoints return `UPSTREAM_ERROR / inventory_stale` for missing or stale snapshots.
- Adapter mismatch: `UpstreamApiAdapter` must parse 985 envelope and field names.
- Checks: API typecheck, lint, unit tests, OpenAPI export, contracts generation/typecheck.
