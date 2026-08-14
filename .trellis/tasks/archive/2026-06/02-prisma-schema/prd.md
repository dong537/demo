# Task 02 — PostgreSQL + Prisma Schema / Migration（第一阶段）

## 目标

在 `packages/db` 建立 Prisma schema，覆盖第一阶段 11 张核心表，生成初始 migration，导出 `PrismaClient` 供 `apps/api` 和 `apps/worker` 使用。

## 实现要求

### packages/db/prisma/schema.prisma

datasource: PostgreSQL，url from `DATABASE_URL`  
generator: `prisma-client-js`，output: `../generated/client`

**11 张核心表字段规范：**

**sites** — 站点（主站或 Reseller 分站）
- `id` UUID PK
- `code` String unique（例如 `MAIN`, `RESELLER_DEMO`）
- `name` String
- `domain` String unique
- `status` Enum: `ACTIVE | MAINTENANCE | DISABLED`
- `brandConfig` Json（品牌名、logo、主色等，nullable）
- `createdAt` DateTime default now
- `updatedAt` DateTime @updatedAt

**tenants** — 代理商租户（主站也有默认 tenant）
- `id` UUID PK
- `siteId` String -> sites.id
- `code` String
- `name` String
- `status` Enum: `ACTIVE | SUSPENDED | CLOSED`
- `createdAt` DateTime, `updatedAt` DateTime
- Unique: `[siteId, code]`

**users** — 终端客户
- `id` UUID PK
- `siteId` String -> sites.id
- `tenantId` String -> tenants.id
- `email` String unique
- `passwordHash` String
- `status` Enum: `ACTIVE | SUSPENDED | BANNED`
- `kycStatus` Enum: `NONE | PENDING | APPROVED | REJECTED`
- `riskStatus` Enum: `NORMAL | FLAGGED | BLOCKED`
- `createdAt` DateTime, `updatedAt` DateTime

**admin_users** — 平台/租户后台操作者
- `id` UUID PK
- `siteId` String -> sites.id
- `tenantId` String nullable -> tenants.id（null = platform admin）
- `email` String unique
- `passwordHash` String
- `role` Enum: `PLATFORM_ADMIN | TENANT_ADMIN | OPERATOR`
- `status` Enum: `ACTIVE | SUSPENDED`
- `createdAt` DateTime, `updatedAt` DateTime

**sessions** — 登录会话
- `id` UUID PK
- `ownerType` Enum: `USER | ADMIN_USER`
- `ownerId` String
- `siteId` String -> sites.id
- `tenantId` String nullable
- `token` String unique（存 hash）
- `expiresAt` DateTime
- `createdAt` DateTime
- `revokedAt` DateTime nullable

**api_keys** — OpenAPI 鉴权凭据
- `id` UUID PK
- `siteId` String -> sites.id
- `tenantId` String -> tenants.id
- `ownerId` String（userId 或 adminUserId）
- `ownerType` Enum: `USER | TENANT_ADMIN`
- `keyHash` String unique（明文 SHA-256 hash）
- `keyPrefix` String（明文前 8 位，用于展示）
- `scopes` String[]
- `ipWhitelist` String[]
- `status` Enum: `ACTIVE | REVOKED`
- `createdAt` DateTime, `updatedAt` DateTime
- `revokedAt` DateTime nullable
- `lastUsedAt` DateTime nullable

**wallets** — 余额 Source of Truth
- `id` UUID PK
- `siteId` String -> sites.id
- `tenantId` String -> tenants.id
- `userId` String unique -> users.id（一用户一钱包）
- `available` Decimal(20,8)（不用 Float）
- `frozen` Decimal(20,8)
- `currency` String（固定为 platformCurrency，如 CNY）
- `version` Int default 0（乐观锁）
- `createdAt` DateTime, `updatedAt` DateTime

**ledger_entries** — 审计账本（不允许删除）
- `id` UUID PK
- `siteId` String
- `tenantId` String
- `walletId` String -> wallets.id
- `userId` String
- `type` Enum: `DEPOSIT | DEBIT | REFUND | ADJUSTMENT | FREEZE | UNFREEZE | RENEWAL | COMMISSION`
- `amount` Decimal(20,8)（正数=入账，负数=出账）
- `balanceAfter` Decimal(20,8)
- `currency` String
- `relatedId` String nullable（payment_order.id 或 order.id）
- `reason` String nullable
- `idempotencyKey` String unique
- `createdAt` DateTime
- `meta` Json nullable

**payment_orders** — 充值单
- `id` UUID PK
- `siteId` String
- `tenantId` String
- `userId` String -> users.id
- `amount` Decimal(20,8)
- `currency` String
- `channel` Enum: `MANUAL | YIPAY | ALIPAY`
- `status` Enum: `PENDING | CONFIRMING | COMPLETED | FAILED | REFUNDED`
- `idempotencyKey` String unique
- `channelOrderId` String nullable（支付渠道订单号）
- `confirmedBy` String nullable（admin_user.id，人工确认时写入）
- `confirmedAt` DateTime nullable
- `failReason` String nullable
- `createdAt` DateTime, `updatedAt` DateTime
- `meta` Json nullable（渠道原始通知留档）

**audit_logs** — 高危操作审计（不允许删除）
- `id` UUID PK
- `siteId` String
- `tenantId` String nullable
- `actorType` Enum: `USER | ADMIN_USER | SYSTEM | APIKEY`
- `actorId` String
- `targetType` String nullable（例如 `user`, `wallet`, `api_key`, `payment_order`）
- `targetId` String nullable
- `action` String（例如 `wallet.adjust`, `api_key.revoke`, `admin.impersonate`）
- `reason` String nullable
- `requestId` String
- `ipAddress` String nullable
- `meta` Json nullable
- `createdAt` DateTime

**system_settings** — 系统配置
- `id` UUID PK
- `siteId` String -> sites.id
- `key` String
- `value` String
- `description` String nullable
- `updatedBy` String nullable
- `updatedAt` DateTime
- Unique: `[siteId, key]`

### packages/db/src/index.ts

```ts
export { PrismaClient } from '../generated/client';
export type { Prisma } from '../generated/client';
// 单例：用于生产环境防止连接池耗尽
import { PrismaClient } from '../generated/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

### packages/db/package.json

```json
{
  "name": "@ipeasy/db",
  "main": "src/index.ts",
  "scripts": {
    "migrate:dev": "prisma migrate dev --schema prisma/schema.prisma",
    "migrate:deploy": "prisma migrate deploy --schema prisma/schema.prisma",
    "generate": "prisma generate --schema prisma/schema.prisma",
    "studio": "prisma studio --schema prisma/schema.prisma"
  }
}
```

## 验证步骤

```bash
cd packages/db
pnpm prisma migrate dev --name init   # 生成 migrations/TIMESTAMP_init/migration.sql
pnpm generate                          # generated/client 生成成功
pnpm typecheck                         # src/index.ts 类型无错
# 连接检查（需要 docker-compose up -d）
pnpm prisma db execute --stdin <<< "SELECT 1"
```

## 禁止

- 不用 `prisma db push`（必须走 migration）
- 不用 Float 类型存金额（必须 Decimal(20,8)）
- 不在 schema 里加任何 mock seed 数据
- `ledger_entries` 和 `audit_logs` 不加 delete 相关方法
