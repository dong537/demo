# 2026-06-25 生产库恢复调查

## 背景

- 线上 `backend` 已修复全局异常过滤器二次崩溃问题，之前被放大的 `502` 已止血。
- 当前真正阻塞登录、购买和站点初始化的是生产数据库 `Postgres-CVre` 崩溃。

## 当前生产故障结论

- 崩溃服务：`Postgres-CVre`
- 现象：
  - `backend /health` 返回 `200`
  - `backend /ready` 返回 `503`
  - `backend /api/sites/current`、`/api/auth/me` 返回后端自己的 `500 JSON`
- 日志关键信号：
  - `No space left on device`
  - `database system was interrupted while in recovery`
  - `you will have to use the last backup for recovery`
- 卷占用：
  - 旧库 `Postgres` 卷约 `231.95 MB / 5000 MB`
  - Redis 卷约 `149.72 MB / 5000 MB`
  - 崩库 `Postgres-CVre` 卷约 `4896.50 MB / 5000 MB`

## 旧库 `Postgres` 只读核查结果

使用旧库公开连接串加 `sslmode=require` 做只读查询，确认旧库并非空库，但结构明显落后于当前 Prisma schema。

### 核心表行数

- `sites`: 1
- `tenants`: 0
- `users`: 22
- `admin_users`: 1
- `orders`: 20
- `platform_resources`: 352

### 关键数据

- `users.email = 971159243@qq.com` 的账号在旧库中存在

### 当前购买链路相关表

- 存在：
  - `wallets` 29
  - `payment_orders` 1
  - `resource_mappings` 429
  - `inventory_snapshots` 1858
  - `price_templates` 0
  - `price_rules` 303
  - `price_overrides` 0
  - `user_price_bindings` 0
  - `upstream_order_mirrors` 22
  - `proxy_instances` 12
- 不存在：
  - `provider_accounts`
  - `user_resource_price_overrides`
  - `fulfillment_jobs`
  - `upstream_api_accounts`
  - `notifications`
  - `tickets`

### 数据新鲜度

- `users.updated_at` 最新约 `2026-06-05T14:43:57Z`
- `orders.updated_at` 最新约 `2026-06-04T19:07:52Z`
- `platform_resources.updated_at` 最新约 `2026-06-05T12:40:12Z`
- `sites.updated_at` 最新约 `2026-05-26T15:03:59Z`

结论：旧库数据大约只停留在 2026-06-05，无法代表当前线上最近二十天的真实配置和业务状态。

## 旧库与当前 schema 的关键不兼容

旧库字段命名和当前 Prisma schema 差异很大，不是补一两个列就能直接切换：

- `sites` 旧字段：
  - `mode`, `brand_name`, `logo_url`, `support_contact`, `settings`, `created_at`, `updated_at`
  - 缺当前代码依赖的 `code`, `status`, `brandConfig`, `maintenanceMessage`, `createdAt`, `updatedAt`
- `users` 旧字段：
  - `customer_ref`, `price_level`, `created_at`, `updated_at`, `deleted_at`
  - 不是当前驼峰列名
- `admin_users` 旧字段没有 `email`，而是 `username`
- `platform_resources` 旧字段是：
  - `public_id`, `tenant_id`, `level`, `country_name`, `region`, `city`, `line`, `visible`, `sellable`
  - 与当前 `code`, `name`, `displayName`, `providerCode`, `protocol`, `status`, `upstreamCost` 等结构不同

## 旧库迁移历史结论

旧库 `_prisma_migrations` 中既有更早一套迁移，也有当前仓库迁移失败记录：

- 成功：
  - `20260526000000_init`
  - `20260528000000_reseller_sync_outbox`
  - `20260528010000_admin_coupons_support`
  - `20260602010000_api_key_session_expiry`
- 失败：
  - `20260607181728_init`
  - 错误：`type "ApiKeyOwnerType" already exists`

结论：旧库不是当前这套 Prisma 迁移链的干净前置版本，不能直接跑当前 `migrate deploy` 作为低风险应急恢复。

## Railway 恢复入口排查结论

### 已确认

- GraphQL 存在：
  - `volumeInstanceBackupRestore`
  - `volumeInstancePITRRestore`
  - `volumeInstanceUpdate`
  - `volumeUpdate`
- 当前 token 对 `volumeInstancePITRRestore` 返回 `Not Authorized`
- 公开查询里未看到该项目卷备份计划和备份记录

### 卷扩容能力

- CLI `railway volume update` 只能改：
  - 卷名称
  - 挂载路径
- GraphQL：
  - `volumeInstanceUpdate` 只能改 `mountPath` / `serviceId` / `state`
  - `volumeUpdate` 只能改 `name`
- Railway Agent 结论：
  - 生产卷实时扩容是 **Dashboard-only**
  - 没有 CLI / GraphQL / IaC 可用入口

## 已证伪的路径

1. **把后端直接切到旧 `Postgres`**
   - 旧库结构和当前代码明显不兼容
   - 即使勉强启动，也会丢失 2026-06-05 之后的数据

2. **用当前 token 做 PITR/备份恢复**
   - GraphQL mutation 已验证权限不足

3. **通过 CLI / GraphQL 直接扩容崩库卷**
   - 当前公开程序化接口不支持

4. **通过 volume files 检查或操作崩库卷文件**
   - `railway volume files list` 对崩库卷初始化 SFTP 超时

## 当前最现实的恢复路径

1. 进入 Railway Dashboard
2. 打开 `Postgres-CVre` 的卷设置
3. 对 `postgres-volume-qG6g` 做实时扩容
4. 等 PostgreSQL 重新完成 recovery
5. 验证：
   - `/ready`
   - `/api/sites/current`
   - `/api/auth/me`
   - 购买链路

如果 Dashboard 也无法扩容或扩容后仍无法恢复，则只能继续走 Railway 支持/人工恢复路径；旧库最多只能作为“数据参考源”，不适合作为直接生产接管库。
