# Frozen Frontend API Compatibility Design

## Goal

Make the May frozen frontend usable in the recovered production environment without changing `apps/web/**` or the frozen dist. The frontend must reach a compatible `/api/v1` contract while the current backend remains the source of truth for authentication, catalog, inventory, wallet, order, and dedicated-line state.

## Constraints

- `apps/web/**` and `frozen/frontend-railway-6f71aaa1/**` are read-only for this task.
- Residential UI and purchase remain disabled.
- No provider purchase, migration, projection, or Bark execution is enabled before explicit smoke evidence.
- No mock data, silent fallback, shallow route aliases, or duplicated order/inventory rules.
- Existing old backend deployment remains available for rollback until the proxy is verified.

## Source of truth and data flow

The current PostgreSQL database owns users, sessions, wallets, SKUs, inventory snapshots, reservations, orders, dedicated lines, and audit records. The current API use cases own validation, permissions, pricing, inventory reservation, wallet debit, idempotency, and lifecycle transitions. The compatibility module only translates the frozen request/response shapes into those use cases.

Browser -> old generated backend hostname -> legacy API proxy -> current backend `/api/v1` compatibility controllers -> current domain use cases/repositories -> recovered PostgreSQL and Redis.

The proxy is infrastructure glue only. It forwards method, path, body, authorization, content type, and CORS-relevant response headers. It does not inspect credentials or implement business behavior.

## Compatibility surface

The first production surface is the dedicated-line customer workflow and authentication:

- `GET /api/v1/health`
- `GET /api/v1/settings/capabilities`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/dedicated-skus`
- `GET /api/v1/dedicated/locations`
- `POST /api/v1/dedicated/preview`
- `POST /api/v1/dedicated/purchase-v2`
- `GET /api/v1/dedicated/my`
- `POST /api/v1/dedicated/:id/renew`
- `POST /api/v1/dedicated/:id/lock`
- `GET /api/v1/dedicated/:id/qrcode`
- `PATCH /api/v1/dedicated/:id/remark`

Residential and unrelated admin routes remain disabled or out of scope until their current-domain contracts are mapped and tested.

## Error and security contract

Compatibility controllers preserve the existing application error envelope and HTTP status. Missing or stale inventory returns an explicit out-of-stock error and creates the existing Bark outbox record; it never calls a provider purchase API. The proxy must reject non-HTTP upstream responses, preserve upstream status, and expose no target credentials in logs.

## Rollout and rollback

1. Run unit and integration tests against real PostgreSQL/Redis fixtures.
2. Deploy the current API compatibility module with worker execution disabled.
3. Deploy the proxy to the existing old backend service. Keep the old deployment available for Railway rollback.
4. Browser smoke login, capabilities, catalog, quote, inventory-empty refusal, and idempotency checks.
5. Only after provider/3x-ui/NY/Bark smoke evidence, enable one worker capability at a time with explicit allowlists.
6. Roll back by restoring the previous old backend deployment and disabling all worker flags; the current database remains untouched.

## Acceptance criteria

- Frozen frontend login no longer reports the old CORS/404 error.
- Dedicated catalog and quote render from current database data.
- Inventory shortage does not call an upstream provider and creates an auditable alert.
- Repeated purchase request with the same idempotency key does not double-debit or create a second order.
- `apps/web/**` remains unchanged.
- Existing root typecheck, lint, test, and build remain green.
