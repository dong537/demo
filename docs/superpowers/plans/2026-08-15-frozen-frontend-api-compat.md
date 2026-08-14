# Frozen Frontend API Compatibility Implementation Plan

> **For agentic workers:** Execute this plan inline with the project Trellis workflow. Do not modify `apps/web/**` or the frozen frontend bundle.

**Goal:** Serve the frozen May frontend through a tested `/api/v1` compatibility contract and the existing hardcoded backend hostname, without enabling unsafe provider execution.

**Architecture:** Add a focused Nest module under `apps/api/src/modules/api-v1-compat/` that adapts old DTOs to current auth/catalog/dedicated-line use cases. Deploy a small Node HTTP proxy to the old backend service so the hardcoded hostname forwards to the current production API. Keep business rules in existing modules and preserve Railway rollback deployments.

**Tech Stack:** NestJS/Fastify, Prisma/PostgreSQL, Vitest/Supertest, Node 22 `fetch`, Docker/Railway.

## Global Constraints

- `apps/web/**` and `frozen/frontend-railway-6f71aaa1/**` remain unchanged.
- Dedicated-line only; residential UI/purchase stay disabled.
- No mock or silent fallback in production paths.
- Real PostgreSQL/Redis integration is required for workflow tests.
- Worker/provider execution remains disabled until external smoke evidence exists.

---

### Task 1: Freeze the compatibility contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-15-frozen-frontend-api-compat-design.md`
- Create: `docs/superpowers/plans/2026-08-15-frozen-frontend-api-compat.md`
- Modify: `.trellis/tasks/08-14-database-recovery-production-rollout/prd.md`

- [x] Record source of truth, route scope, rollout, and rollback boundaries.
- [x] Record that the frontend stays frozen and the compatibility layer cannot duplicate domain logic.

### Task 2: RED tests for compatibility behavior

**Files:**
- Create: `apps/api/src/modules/api-v1-compat/api-v1-compat.controller.spec.ts`
- Create: `apps/api/src/modules/api-v1-compat/api-v1-compat.mapper.spec.ts`

**Interfaces:**
- `toCapabilitiesResponse()` returns dedicated enabled and residential disabled flags.
- `toLegacySkuDto()` preserves SKU code, name, protocol capabilities, and active/visible state.
- Controller tests assert the old routes require the same user/admin guards as current use cases.

- [ ] Write the failing mapper tests for capabilities and SKU response shape.
- [ ] Write the failing controller test for `/api/v1/settings/capabilities` and the unauthenticated 401 behavior of `/api/v1/dedicated-skus`.
- [ ] Run `pnpm --filter @ipeasy/api test -- api-v1-compat` and observe failures caused by missing module/export.

### Task 3: Implement the compatibility module

**Files:**
- Create: `apps/api/src/modules/api-v1-compat/api-v1-compat.module.ts`
- Create: `apps/api/src/modules/api-v1-compat/api-v1-compat.controller.ts`
- Create: `apps/api/src/modules/api-v1-compat/api-v1-compat.mapper.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: existing dedicated-line use-case files only when a missing lifecycle command is required by a tested legacy route.

**Interfaces:**
- Public capability response: `{ smtpConfigured, otpLoginEnabled, residentialUiEnabled, residentialPurchaseEnabled, dedicatedUiEnabled, dedicatedPurchaseEnabled, selfServiceRechargeEnabled }`.
- Compatibility routes call existing `LoginUseCase`, `CatalogRepository`, `SkuQuoteUseCase`, `CreateDedicatedLineOrderUseCase`, and dedicated delivery/lifecycle use cases.
- Legacy purchase requests are validated and converted to current `CreateDedicatedLineOrderDto`; no direct Prisma order insert is allowed.

- [ ] Implement the minimal mapper and module registration.
- [ ] Implement auth and capability routes.
- [ ] Implement dedicated SKU, locations, preview, purchase, and owned-line routes using current use cases.
- [ ] Implement lock/QR/remark only after locating current lifecycle persistence seams; otherwise return a typed unsupported error and cover it explicitly rather than silently succeeding.
- [ ] Run focused tests, then API typecheck/lint/build.

### Task 4: Add the old-host proxy

**Files:**
- Create: `infra/legacy-api-proxy/server.mjs`
- Create: `infra/legacy-api-proxy/Dockerfile`
- Create: `infra/legacy-api-proxy/railway.json`
- Create: `infra/legacy-api-proxy/server.spec.mjs`

**Interfaces:**
- `LEGACY_PROXY_TARGET` is the only required runtime setting and must be an HTTPS URL.
- Proxy forwards request method/path/query/body and safe headers, strips hop-by-hop headers, and returns upstream status/body/headers.
- Proxy exposes `/healthz` locally and never logs authorization or target URL credentials.

- [ ] Write a failing forwarding test with a local HTTP upstream.
- [ ] Implement the proxy and health endpoint.
- [ ] Run the proxy test and Docker build.
- [ ] Deploy it to the existing old backend Railway service only after preserving its current deployment ID for rollback.

### Task 5: Local real-data and browser contract verification

**Files:**
- Modify: `.trellis/tasks/08-14-database-recovery-production-rollout/validation.md`
- Create: `e2e/legacy-api-compat-smoke.spec.ts` only if existing e2e harness can run without frontend source changes.

- [ ] Verify current backend `/api/v1/health` and capabilities.
- [ ] Verify authenticated catalog and quote against recovered PostgreSQL.
- [ ] Verify empty/stale inventory returns explicit 422 and does not create a provider job.
- [ ] Verify repeated purchase idempotency does not double debit.
- [ ] Verify frozen frontend login and dedicated buy route in Playwright through the old hostname.
- [ ] Verify no `apps/web/**` diff and no runtime/page errors.

### Task 6: Provider gates and production rollout

**Files:**
- Modify Railway variables only after smoke evidence; no secrets in Git.
- Modify: `.trellis/tasks/08-14-database-recovery-production-rollout/validation.md`

- [ ] Rotate exposed credentials in the provider dashboards and Railway variables, preserving encryption-key compatibility until encrypted data migration is planned.
- [ ] Run read-only 3x-ui connectivity and NY routing checks.
- [ ] Run one controlled 985/IPIPD inventory smoke; confirm SK5 shortage refuses purchase.
- [ ] Configure and test Bark alert delivery.
- [ ] Enable inventory sync first, then projection, then dedicated order execution, each with provider/account allowlists and log evidence.
- [ ] Capture rollback commands and final health/readiness evidence.

### Task 7: Quality gate and commit proposal

- [ ] Run `rtk pnpm typecheck`, `rtk pnpm lint`, `rtk pnpm test`, `rtk pnpm build`, focused API tests, and proxy tests.
- [ ] Run `rtk pnpm frontend:frozen:verify`.
- [ ] Run Trellis check and update relevant specs.
- [ ] Inspect `git diff --name-only -- apps/web` and confirm empty.
- [ ] Propose commits and wait for explicit user confirmation before committing or pushing.
