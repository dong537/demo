# 365Proxy Control-Plane Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-shaped slice of the dedicated-line control plane: durable line/exit/node/projection state, a stock 3x-ui Adapter contract, and a recoverable reconcile worker boundary without changing the existing static-proxy purchase behavior.

**Architecture:** PostgreSQL owns desired state and every external 3x-ui object is an observed projection. The API owns validation and use cases, the Adapter owns 3x-ui HTTP/auth/error mapping, and the worker owns scheduling only. Residential exit credentials and node credentials are encrypted at rest; API DTOs never return those secrets to reseller operators.

**Tech Stack:** TypeScript, NestJS/Fastify, Prisma/PostgreSQL, Vitest, pnpm/Turborepo, stock 3x-ui HTTP API.

## Global Constraints

- Do not reuse `proxy_instances` as the dedicated-line aggregate.
- Do not add production mocks, fake inventory, silent fallbacks, dual-read compatibility, or runtime auto-migrations.
- Every scoped query includes `siteId`; customer data also includes `tenantId` and `userId` where applicable.
- External writes use stable idempotency identities and persist desired/observed state before reporting success.
- Credentials are AES-GCM encrypted with `APP_ENCRYPTION_KEY`; API keys remain hash-only where the caller authenticates to this platform.
- Money remains decimal string; traffic uses bytes; rate uses bit/s; timestamps use UTC.
- This plan is phase 1 of the full PRD. Reseller upstream, SK5/provider gating, imported NY routes and domains,
  rate-limit data plane and Zeabur online verification remain required later phases.

---

## File Map

- `packages/db/prisma/schema.prisma`: durable enums and aggregates for exit resources, dedicated lines, control nodes and per-node projections.
- `packages/db/prisma/migrations/202608110001_dedicated_line_control_plane/migration.sql`: explicit PostgreSQL migration matching the Prisma schema.
- `apps/api/src/modules/dedicated-lines/dedicated-line.domain.ts`: state transition invariants and immutable desired configuration types.
- `apps/api/src/modules/dedicated-lines/dedicated-lines.repository.ts`: site/tenant/user-scoped persistence and atomic desired-version updates.
- `apps/api/src/modules/dedicated-lines/dedicated-lines.module.ts`: Nest ownership boundary.
- `apps/api/src/modules/node-control/node-control.types.ts`: narrow Adapter and projection contracts.
- `apps/api/src/modules/node-control/three-x-ui.adapter.ts`: stock 3x-ui Bearer-token HTTP implementation.
- `apps/api/src/modules/node-control/three-x-ui.adapter.spec.ts`: request/auth/envelope/error tests with injected transport.
- `apps/api/src/modules/node-control/reconcile-line.use-case.ts`: desired-to-observed orchestration for one projection.
- `apps/api/src/modules/node-control/reconcile-line.use-case.spec.ts`: idempotency, verification and partial-failure tests.
- `apps/api/src/modules/node-control/node-control.module.ts`: Adapter/repository/use-case DI boundary.
- `apps/api/src/worker.ts`: worker-safe exports.
- `apps/worker/src/line-reconcile-worker.ts`: side-effect-free poller with bounded concurrency.
- `apps/worker/src/line-reconcile-worker.spec.ts`: concurrency, isolation and disabled-state tests.
- `apps/worker/src/main.ts`: wire the poller without moving business writes into the worker.

### Task 1: Persist Dedicated-Line Desired and Observed State

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202608110001_dedicated_line_control_plane/migration.sql`
- Create: `apps/api/src/modules/dedicated-lines/dedicated-line.domain.spec.ts`
- Create: `apps/api/src/modules/dedicated-lines/dedicated-line.domain.ts`

**Interfaces:**
- Produces: `DedicatedLineDesiredStatus`, `DedicatedLineRuntimeStatus`, `ExitHealthStatus`, `ControlNodeKind`, `LineProjectionStatus` Prisma enums.
- Produces: `assertDedicatedLineTransition(from, to): void`.
- Produces: `nextDedicatedLineDesiredVersion(current: number): number`.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { assertDedicatedLineTransition, nextDedicatedLineDesiredVersion } from './dedicated-line.domain';

describe('dedicated line domain', () => {
  it('allows queued provisioning to become active after every projection verifies', () => {
    expect(() => assertDedicatedLineTransition('PROVISIONING', 'ACTIVE')).not.toThrow();
  });

  it('rejects a cancelled line returning directly to active', () => {
    expect(() => assertDedicatedLineTransition('CANCELLED', 'ACTIVE')).toThrow('dedicated_line_transition_invalid');
  });

  it('increments desired versions monotonically', () => {
    expect(nextDedicatedLineDesiredVersion(4)).toBe(5);
    expect(() => nextDedicatedLineDesiredVersion(-1)).toThrow('dedicated_line_desired_version_invalid');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/dedicated-lines/dedicated-line.domain.spec.ts`

Expected: FAIL because `dedicated-line.domain.ts` does not exist.

- [ ] **Step 3: Add explicit schema aggregates and migration**

Add models with these ownership fields and unique keys:

```prisma
enum ResidentialExitSource {
  IPIPD
  NINE_EIGHT_FIVE
  MANUAL_IMPORT
  UPSTREAM_API
}

enum ResidentialExitStatus {
  AVAILABLE
  ALLOCATED
  SUSPENDED
  EXPIRED
  FAILED
}

enum ExitHealthStatus {
  UNKNOWN
  HEALTHY
  UNHEALTHY
  GEO_MISMATCH
}

enum DedicatedLineDesiredStatus {
  ENABLED
  DISABLED
  REMOVED
}

enum DedicatedLineRuntimeStatus {
  QUEUED
  PROVISIONING
  ACTIVE
  DEGRADED
  SUSPENDED
  EXPIRED
  CANCELLING
  CANCELLED
  FAILED
}

enum DedicatedLineProtocol {
  VLESS
  VMESS
}

enum ControlNodeKind {
  THREE_X_UI
}

enum ControlNodeTlsMode {
  VERIFY
  SKIP_VERIFY
  PIN
  MTLS
}

enum ControlNodeStatus {
  ACTIVE
  DEGRADED
  DISABLED
}

enum LineProjectionStatus {
  PENDING
  APPLYING
  APPLIED
  RETRYING
  PERMANENT_FAILURE
  REMOVING
}

model residential_exits {
  id                String   @id @default(uuid())
  siteId            String
  providerCode      String
  upstreamAccountId String?
  upstreamResourceId String?
  countryCode       String
  regionCode        String?
  host              String
  port              Int
  usernameEncrypted String
  passwordEncrypted String
  identityHash      String
  source            ResidentialExitSource
  status            ResidentialExitStatus
  healthStatus      ExitHealthStatus
  expiresAt         DateTime?
  lastCheckedAt     DateTime?
  observedExitIp    String?
  observedCountryCode String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  assignments       dedicated_line_exit_assignments[]

  @@unique([siteId, providerCode, upstreamAccountId, host, port, identityHash], map: "residential_exits_source_endpoint_key")
  @@index([siteId, countryCode, status, healthStatus])
}

model dedicated_lines {
  id                 String   @id @default(uuid())
  siteId             String
  tenantId           String
  userId             String
  orderId             String?
  clientEmail         String
  clientCredentialEncrypted String
  countryCode         String
  desiredStatus       DedicatedLineDesiredStatus
  runtimeStatus       DedicatedLineRuntimeStatus
  protocol            DedicatedLineProtocol
  trafficQuotaBytes   BigInt?
  uploadRateBitsPerSecond BigInt?
  downloadRateBitsPerSecond BigInt?
  desiredVersion      Int      @default(1)
  expiresAt           DateTime?
  lastError           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  projections         dedicated_line_projections[]
  exitAssignments     dedicated_line_exit_assignments[]

  @@unique([siteId, clientEmail])
  @@index([siteId, tenantId, userId, runtimeStatus])
}

model control_nodes {
  id                  String   @id @default(uuid())
  siteId              String
  name                String
  kind                ControlNodeKind
  regionCode          String
  baseUrl             String
  credentialEncrypted String
  tlsMode             ControlNodeTlsMode
  status              ControlNodeStatus
  timeoutMs           Int      @default(15000)
  capacity             Int?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  projections          dedicated_line_projections[]

  @@unique([siteId, name])
  @@index([siteId, kind, status])
}

model dedicated_line_projections {
  id                 String   @id @default(uuid())
  siteId             String
  dedicatedLineId    String
  nodeId              String
  externalInboundId  String
  externalClientId   String?
  externalClientEmail String
  desiredVersion     Int
  observedVersion    Int      @default(0)
  status             LineProjectionStatus
  attempts           Int      @default(0)
  scheduledAt        DateTime @default(now())
  leaseOwner         String?
  leaseExpiresAt     DateTime?
  lastError          String?
  lastObservedAt     DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  line               dedicated_lines @relation(fields: [dedicatedLineId], references: [id])
  node               control_nodes @relation(fields: [nodeId], references: [id])

  @@unique([siteId, dedicatedLineId, nodeId])
  @@index([status, scheduledAt, leaseExpiresAt])
}

model dedicated_line_exit_assignments {
  id              String @id @default(uuid())
  siteId          String
  dedicatedLineId String
  exitId          String
  active          Boolean @default(true)
  assignedAt      DateTime @default(now())
  releasedAt      DateTime?
  line            dedicated_lines @relation(fields: [dedicatedLineId], references: [id])
  exit            residential_exits @relation(fields: [exitId], references: [id])

  @@unique([siteId, dedicatedLineId, exitId])
  @@index([siteId, exitId, active])
}
```

`identityHash` is an HMAC/SHA-256 fingerprint of the normalized username identity used only for
deduplication; AES-GCM ciphertext must not participate in semantic uniqueness because its nonce is
random. `clientCredentialEncrypted` stores the VLESS UUID or VMess identity encrypted at rest.

The migration must create the same enum values, tables, foreign keys, compound unique indexes and lookup indexes. It must not alter or reinterpret `proxy_instances`.

- [ ] **Step 4: Implement the transition map**

```ts
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

const transitions = {
  QUEUED: new Set(['PROVISIONING', 'CANCELLED', 'FAILED']),
  PROVISIONING: new Set(['ACTIVE', 'DEGRADED', 'FAILED', 'CANCELLING']),
  ACTIVE: new Set(['DEGRADED', 'SUSPENDED', 'EXPIRED', 'CANCELLING']),
  DEGRADED: new Set(['ACTIVE', 'SUSPENDED', 'FAILED', 'CANCELLING']),
  SUSPENDED: new Set(['ACTIVE', 'EXPIRED', 'CANCELLING']),
  EXPIRED: new Set(['PROVISIONING', 'CANCELLING']),
  CANCELLING: new Set(['CANCELLED', 'FAILED']),
  CANCELLED: new Set<string>(),
  FAILED: new Set(['PROVISIONING', 'CANCELLING']),
} as const;

export function assertDedicatedLineTransition(from: keyof typeof transitions, to: string): void {
  if (!transitions[from].has(to as never)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_transition_invalid', 409);
  }
}

export function nextDedicatedLineDesiredVersion(current: number): number {
  if (!Number.isSafeInteger(current) || current < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'dedicated_line_desired_version_invalid', 400);
  }
  return current + 1;
}
```

- [ ] **Step 5: Generate Prisma and verify GREEN**

Run: `rtk pnpm --filter @ipeasy/db generate`

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/dedicated-lines/dedicated-line.domain.spec.ts`

Expected: Prisma generate succeeds and the focused domain suite passes.

### Task 2: Add Scoped Repositories and Lease-Based Projection Claims

**Files:**
- Create: `apps/api/src/modules/dedicated-lines/dedicated-lines.repository.ts`
- Create: `apps/api/src/modules/dedicated-lines/dedicated-lines.repository.spec.ts`
- Create: `apps/api/src/modules/dedicated-lines/dedicated-lines.module.ts`

**Interfaces:**
- Produces: `DedicatedLinesRepository.findOwnedLine(id, siteId, tenantId, userId)`.
- Produces: `DedicatedLinesRepository.claimDueProjections(owner, limit, leaseMs)`.
- Produces: `DedicatedLinesRepository.completeProjection(id, owner, desiredVersion, external)`.
- Produces: `DedicatedLinesRepository.failProjection(id, owner, reasonKey, scheduledAt)`.

- [ ] **Step 1: Write repository contract tests** using a Prisma mock only for query-shape verification; assert every ownership lookup includes `id`, `siteId`, `tenantId`, `userId`, and every completion update includes `leaseOwner` plus `desiredVersion` in its conditional `where`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/dedicated-lines/dedicated-lines.repository.spec.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement atomic claims** with a short Prisma transaction: select due `PENDING|RETRYING` ids ordered by `scheduledAt`, conditionally `updateMany` each id where the lease is absent/expired, then return only rows whose `leaseOwner` equals the caller. Never return rows that failed the conditional claim.

- [ ] **Step 4: Implement conditional completion/failure** so stale workers cannot overwrite a newer desired version. `completeProjection` sets `observedVersion=desiredVersion`, `status='APPLIED'`, clears lease/error and writes external ids. `failProjection` increments attempts, sets `RETRYING`, schedules explicit backoff and clears the lease.

- [ ] **Step 5: Verify the repository suite**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/dedicated-lines/dedicated-lines.repository.spec.ts`

Expected: PASS, including stale-owner and stale-version rejection cases.

### Task 3: Implement the Stock 3x-ui Adapter Seam

**Files:**
- Create: `apps/api/src/modules/node-control/node-control.types.ts`
- Create: `apps/api/src/modules/node-control/three-x-ui.adapter.ts`
- Create: `apps/api/src/modules/node-control/three-x-ui.adapter.spec.ts`
- Create: `apps/api/src/modules/node-control/node-control.module.ts`

**Interfaces:**
- Consumes: decrypted node credential only inside `NodeControlModule`.
- Produces:

```ts
export type ThreeXuiCredential = { bearerToken: string };
export type DesiredClient = {
  email: string;
  protocol: 'VLESS' | 'VMESS';
  credential: string;
  enabled: boolean;
  expiresAt: Date | null;
  trafficQuotaBytes: bigint | null;
};
export interface NodeControlAdapter {
  getClient(node: NodeRuntimeConfig, inboundId: string, email: string): Promise<ObservedClient | null>;
  upsertClient(node: NodeRuntimeConfig, inboundId: string, desired: DesiredClient): Promise<ObservedClient>;
  removeClient(node: NodeRuntimeConfig, inboundId: string, email: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing transport tests** asserting the Adapter sends `Authorization: Bearer <token>`, never logs the token, uses `/panel/api/inbounds/get/:id` for read-back, and maps non-2xx, timeout, invalid envelope and missing client to stable `AppError` codes.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/node-control/three-x-ui.adapter.spec.ts`

Expected: FAIL because the Adapter is absent.

- [ ] **Step 3: Implement an injected HTTP transport** with `AbortSignal.timeout(node.timeoutMs)`, HTTPS-only production URL validation, Bearer auth, JSON envelope parsing and response size cap. Use a narrow `ThreeXuiTransport` function in tests rather than starting a fake server.

- [ ] **Step 4: Implement read-before-write idempotency**. If observed email/config already matches desired state, return it without a write. Otherwise call the documented client add/update endpoint, then re-read and compare email, enabled, expiry, quota and protocol-specific credential identity before reporting success.

- [ ] **Step 5: Verify Adapter and app type contracts**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/node-control/three-x-ui.adapter.spec.ts`

Run: `rtk pnpm --filter @ipeasy/api typecheck`

Expected: both pass; no credential value appears in snapshots or logger assertions.

### Task 4: Reconcile One Dedicated-Line Projection

**Files:**
- Create: `apps/api/src/modules/node-control/reconcile-line.use-case.ts`
- Create: `apps/api/src/modules/node-control/reconcile-line.use-case.spec.ts`
- Modify: `apps/api/src/modules/node-control/node-control.module.ts`

**Interfaces:**
- Consumes: claimed client projection row, line desired state and node runtime config.
- Produces: `ReconcileLineResult = APPLIED | NOOP | RETRYING | PERMANENT_FAILURE` with stable `reasonKey`.

- [ ] **Step 1: Write failing behavior tests** for: already-observed NOOP; active desired state applies and verifies; suspended desired state disables the client; removed desired state deletes the client; Adapter timeout schedules retry; missing `externalInboundId` is permanent `dedicated_line_inbound_missing`; stale desired version cannot complete.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/node-control/reconcile-line.use-case.spec.ts`

Expected: FAIL because the use case is absent.

- [ ] **Step 3: Implement deterministic desired client config building**. The Xray client Email is `dedicated_lines.clientEmail`; the VLESS/VMess credential is decrypted only inside the node-control use case and never returned in the result or audit meta. This first projection does not claim to configure the residential SOCKS outbound/route; those require a separately researched 3x-ui Adapter contract. NY forwarding remains an imported external route and is never written by this Adapter.

- [ ] **Step 4: Implement apply-and-read-back**. Persist `APPLYING`, call the Adapter, verify observed state, then conditionally complete with the claim owner and desired version. Map validation/auth/not-found configuration errors to permanent failure; map timeout/5xx to retry with bounded exponential backoff.

- [ ] **Step 5: Run the use-case suite**

Run: `rtk pnpm --filter @ipeasy/api test -- src/modules/node-control/reconcile-line.use-case.spec.ts`

Expected: PASS for all state, retry and stale-worker cases.

### Task 5: Add a Bounded-Concurrency Reconcile Worker

**Files:**
- Modify: `apps/api/src/worker.ts`
- Create: `apps/worker/src/line-reconcile-worker.ts`
- Create: `apps/worker/src/line-reconcile-worker.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/common/config/env.schema.ts`
- Modify: `apps/api/src/test-utils/integration-setup.ts`

**Interfaces:**
- Produces: `LineReconcileWorker.poll(): Promise<number>`.
- Environment: `LINE_RECONCILE_ENABLED`, `LINE_RECONCILE_BATCH_SIZE`, `LINE_RECONCILE_CONCURRENCY`, `LINE_RECONCILE_LEASE_MS`, `LINE_RECONCILE_POLL_INTERVAL_MS`.

- [ ] **Step 1: Write failing worker tests** with deferred promises proving no more than configured concurrency executes, one projection failure does not stop siblings, a second overlapping poll returns zero, and disabled mode never claims work.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk pnpm --filter @ipeasy/worker test -- line-reconcile-worker`

Expected: FAIL because the worker is absent.

- [ ] **Step 3: Implement bounded scheduling** with an in-process worker pool over already atomically claimed rows. The worker logs projection id, line id, node id, status, attempts and reasonKey only; it does not decrypt credentials or update Prisma directly.

- [ ] **Step 4: Wire the worker-safe exports and runtime**. Export `NodeControlModule`, `DedicatedLinesRepository`, and `ReconcileLineUseCase` through `@ipeasy/api/worker`; instantiate one `LineReconcileWorker` in `apps/worker/src/main.ts`; clear its interval during graceful shutdown.

- [ ] **Step 5: Verify worker behavior and builds**

Run: `rtk pnpm --filter @ipeasy/worker test -- line-reconcile-worker main`

Run: `rtk pnpm --filter @ipeasy/worker typecheck`

Run: `rtk pnpm --filter @ipeasy/worker build`

Expected: tests, typecheck and build pass; compiled entry remains `apps/worker/dist/worker/src/main.js`.

### Task 6: Cross-Layer Gate and Migration Proof

**Files:**
- Modify only files needed to fix failures found by the checks above.
- Update: `.trellis/tasks/08-11-full-stack-audit-delivery/research/current-state-audit.md`

**Interfaces:**
- Produces: verified foundation without exposing new unfinished customer UI routes.

- [ ] **Step 1: Apply the migration to a disposable PostgreSQL database**

Run: `rtk pnpm --filter @ipeasy/db exec prisma migrate deploy`

Expected: the new migration applies once and a second run reports no pending migration.

- [ ] **Step 2: Run focused test suites**

Run: `rtk pnpm --filter @ipeasy/api test -- dedicated-line three-x-ui reconcile-line`

Run: `rtk pnpm --filter @ipeasy/worker test -- line-reconcile-worker main`

Expected: all focused suites pass.

- [ ] **Step 3: Run repository quality gates**

Run: `rtk pnpm lint`

Run: `rtk pnpm typecheck`

Run: `rtk pnpm test`

Run: `rtk pnpm build`

Expected: all commands exit zero. Integration tests requiring `DATABASE_URL_TEST` must run against the disposable database; a missing test database is a visible blocker, not a skipped success.

- [ ] **Step 4: Verify absence of forbidden leakage and coupling**

Run: `rg -n "bearerToken|credentialEncrypted|passwordEncrypted" apps/api/src/modules/node-control apps/worker/src`

Expected: credential fields appear only at decryption/transport boundaries, never in response DTOs, worker logs or audit metadata.

Run: `rg -n "proxy_instances" apps/api/src/modules/dedicated-lines apps/api/src/modules/node-control`

Expected: no matches; the new domain remains independent from static-proxy delivery rows.

- [ ] **Step 5: Record verified facts** in the task research document: migration name, commands run, pass/fail counts, unresolved external credential requirements, and the next phase entry contract.

## Later Phase Boundaries

The following are separate implementation plans after this foundation passes its gate:

1. Exit pool/import/GeoIP observation and only-used-exit scheduling.
2. Dedicated-line order/quote/wallet saga and delivery-link API/UI.
3. Reseller upstream APIKey binding, upstream balance/inventory/pricing, tenant fulfillment and secret redaction.
4. 3x-ui residential SOCKS outbound/route projection plus imported NY forwarding/domain validation;
   the platform does not write NY configuration.
5. Xray quota telemetry, instantaneous rate-limit data-plane benchmark, and connection-flood protection.
6. Zeabur service manifests/migration/startup order, deploy, browser E2E and real external connectivity test.

Each later plan must retain the full PRD acceptance matrix and cannot mark the overall task complete from foundation tests alone.
