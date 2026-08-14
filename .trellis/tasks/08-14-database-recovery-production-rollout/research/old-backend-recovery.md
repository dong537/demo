# Old Railway backend recovery findings

Date: 2026-08-15 (Asia/Shanghai)

## Scope

The old Railway project and service were inspected only to recover the API contract needed by the frozen frontend. The inspection was limited to the user-owned Railway project; no unrelated resources were accessed.

## Confirmed contract

- Project: `fba9046c-e92e-462c-a695-0751efc46a10`
- Test backend service: `ec1a6b7f-cdd8-44f2-8b8c-6da6284d5fad`
- Public backend host: `backend-test-0dcb.up.railway.app`
- `GET /api/v1/health` returned HTTP 200.
- `GET /api/v1/settings/capabilities` returned HTTP 200 and reported dedicated UI and dedicated purchase enabled, while residential UI/purchase and self-service recharge were disabled.
- Dedicated catalog endpoints returned HTTP 401 without a session, confirming that the old service exposes the route family expected by the frozen frontend.

The frozen frontend still requests `https://backend-test-0dcb.up.railway.app/api/v1`. The current production backend uses the newer `/api` prefix and does not expose the old `/api/v1` contract. A shallow proxy alias would not restore the old semantics safely.

## Runtime risk

Old backend logs repeatedly showed 3x-ui preflight and traffic queries timing out at the client timeout, followed by dedicated deployment failures and order auto-repair activity. This service is executing real background workflows and is not a safe production fallback until 3x-ui connectivity, credentials, and idempotent order state are verified.

The initial current-worker deployment also observed an IPIPD HTTP 401 during inventory sync. The current production worker was redeployed with all provider, fulfillment, dedicated-line, migration, projection, health, and Bark execution flags disabled; no order execution is currently allowed.

## Source extraction blocker

Railway build metadata reveals the old build layout (`backend/Dockerfile.railway`, `packages/proxyhub-sdk`, `reseller-backend`, and Prisma build steps), but does not include a Git commit or source archive. Railway SSH was attempted against the old deployment and instance; the session timed out during the SSH banner exchange. No source files were recovered from the container. Repeated retries with the same connection path are not useful without a Railway/network-side change.

The old Railway production environment was also checked. It contains only a stopped/failed `ipipd-panel`; there is no old production backend or frontend deployment to switch back to.

## Decision

With the frontend frozen, the production path must recover or rebuild a compatible `/api/v1` backend contract and then validate its external adapters. The current backend cannot be used by the frozen frontend without an authorized frontend API endpoint change, and the old backend cannot be promoted while its 3x-ui and order-repair failures remain.
