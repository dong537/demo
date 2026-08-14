# Task 11 — 资源树 / 库存快照 / 价格系统

## 目标

实现 PlatformResource 树（国家/地区/可用区）、InventorySnapshot 库存快照、ResourceMapping 上游映射，以及价格优先级链（user_override > user_template > tier > resource_override > global_template > price_rule），提供 quote use case 和 Admin 管理 API。

## Prisma schema 新增表（追加到 packages/db/prisma/schema.prisma）

**platform_resources**
- `id` UUID PK
- `siteId` String -> sites.id
- `parentId` String nullable（自引用，国家->省->城市）
- `type` Enum: `COUNTRY | REGION | ZONE`
- `code` String（如 `CN`, `US-CA`）
- `name` String
- `displayName` String nullable（本层展示名，可覆盖）
- `providerCode` String（来源 Provider）
- `ipType` Enum: `NATIVE | BROADCAST | BOTH`
- `protocol` Enum: `HTTP | SOCKS5 | BOTH`
- `status` Enum: `ACTIVE | HIDDEN | DISABLED`
- `sortOrder` Int default 0
- `isVisible` Boolean default true
- `isSaleable` Boolean default true
- `unsaleableReason` String nullable
- `createdAt` DateTime, `updatedAt` DateTime
- `@@unique([siteId, providerCode, code, ipType])`

**inventory_snapshots**
- `id` UUID PK
- `siteId` String
- `resourceId` String -> platform_resources.id
- `providerCode` String
- `stock` Int
- `capturedAt` DateTime
- `freshnessTtlSeconds` Int default 300
- `isStale` Boolean default false

**resource_mappings**
- `id` UUID PK
- `siteId` String
- `resourceId` String -> platform_resources.id（本层资源）
- `providerCode` String
- `providerResourceId` String（上游内部 ID）
- `weight` Int default 100（路由权重）
- `@@unique([siteId, resourceId, providerCode])`

**price_templates**
- `id` UUID PK
- `siteId` String -> sites.id
- `name` String
- `description` String nullable
- `isDefault` Boolean default false
- `createdAt` DateTime, `updatedAt` DateTime

**price_rules** — 基础价格
- `id` UUID PK
- `siteId` String
- `templateId` String -> price_templates.id
- `resourceId` String -> platform_resources.id
- `durationDays` Int（30/60/90）
- `unitPrice` Decimal(20,8)（每 IP 每周期价格）
- `currency` String
- `minQty` Int default 1
- `createdAt` DateTime, `updatedAt` DateTime
- `@@unique([siteId, templateId, resourceId, durationDays])`

**price_overrides** — 资源级覆盖价
- `id` UUID PK
- `siteId` String
- `resourceId` String -> platform_resources.id
- `durationDays` Int
- `unitPrice` Decimal(20,8)
- `currency` String
- `@@unique([siteId, resourceId, durationDays])`

**user_price_bindings** — 用户绑定价格模板
- `id` UUID PK
- `siteId` String
- `tenantId` String
- `userId` String -> users.id
- `templateId` String -> price_templates.id
- `@@unique([siteId, userId])`

**user_resource_price_overrides** — 用户级覆盖价
- `id` UUID PK
- `siteId` String
- `tenantId` String
- `userId` String -> users.id
- `resourceId` String -> platform_resources.id
- `durationDays` Int
- `unitPrice` Decimal(20,8)
- `currency` String
- `@@unique([siteId, userId, resourceId, durationDays])`

## pricing/domain.ts — 价格优先级

```ts
// 优先级（高到低）：
// 1. user_resource_price_overrides（用户+资源覆盖）
// 2. user_price_bindings → price_rules（用户绑定模板）
// 3. price_overrides（资源级覆盖）
// 4. 默认 price_template → price_rules
// 5. 上游参考价

export interface QuoteInput {
  siteId: string;
  tenantId: string;
  userId: string;
  resourceId: string;
  durationDays: number;
  quantity: number;
  currency: string;
}

export interface QuoteResult {
  unitPrice: string;       // Decimal string
  totalPrice: string;      // unitPrice * quantity
  currency: string;
  resourceId: string;
  durationDays: number;
  quantity: number;
  priceSource: 'USER_OVERRIDE' | 'USER_TEMPLATE' | 'RESOURCE_OVERRIDE' | 'DEFAULT_TEMPLATE';
  isSaleable: boolean;
  unsaleableReason?: string;
}
```

失败规则：
- 资源不存在 → `AppError(NOT_FOUND, 'resource_not_found')`
- 资源 isSaleable=false → `AppError(UPSTREAM_OUT_OF_STOCK, unsaleableReason)`
- 库存快照存在但 stock=0 → `AppError(UPSTREAM_OUT_OF_STOCK, 'no_stock')`
- 库存快照缺失或过期（isStale=true）→ `AppError(UPSTREAM_ERROR, 'inventory_stale')`
- 无任何价格规则 → `AppError(PRICE_MISSING, 'no_price_rule')`
- 币种不匹配 → `AppError(CURRENCY_NOT_SUPPORTED)`

## quote.use-case.ts

按优先级链查价格，计算 totalPrice（Decimal.js），返回 QuoteResult。调用者（下单 use case）保存 quote 镜像到订单。

## resources.controller.ts — Admin API

```
GET  /api/resources                     → 列出本 siteId 所有资源（分页+filter）
POST /api/resources                     → Admin 创建资源
PUT  /api/resources/:id                 → 更新（可售状态/展示名/排序）
GET  /api/resources/:id/inventory       → 查库存快照
POST /api/resources/sync-inventory      → 手动触发同步（调 Provider Adapter）
```

## pricing.controller.ts — Admin API

```
GET  /api/pricing/templates             → 模板列表
POST /api/pricing/templates             → 创建模板
POST /api/pricing/templates/:id/rules   → 批量写入价格规则
POST /api/pricing/overrides             → 设置资源级覆盖价
POST /api/pricing/user-overrides        → 设置用户级覆盖价
POST /api/pricing/quote-sandbox         → Admin 报价沙盒（模拟某用户某资源报价）
GET  /api/pricing/quote                 → Customer 报价（RequireUser）
```

## 验证步骤

```bash
pnpm --filter @ipeasy/api typecheck
# 创建资源 + 价格规则后：
# GET /api/pricing/quote?resourceId=xxx&durationDays=30&quantity=1 → 返回正确报价
# GET /api/resources → 返回真实资源列表（非空且非假数据）
```

## 禁止

- 不使用静态假库存（库存必须来自 inventory_snapshots）
- 价格必须来自数据库，不硬编码
- 库存过期时返回 UPSTREAM_ERROR，不返回假余量
