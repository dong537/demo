# 365Proxy 专线平台生产运行手册

## 发布准入

每次发布必须满足以下条件：

1. Git 工作树干净，目标 commit 已推送并经过 `production-gate`。
2. secret scan、生产依赖 audit、typecheck、lint、API/worker/web 单元测试、真实 PostgreSQL/Redis 集成测试及 build 全部通过。
3. API、worker、web 镜像使用同一个完整 Git SHA 构建，并保存 `release-manifest.json` 中的三个镜像 digest。
4. `/health` 返回的 `releaseGitSha` 与发布清单一致，`/ready` 的 PostgreSQL 与 Redis 检查均为 `ok`。
5. 平台管理员访问 `/api/admin/production-readiness`，所有业务检查通过后才能进入灰度。
6. 前端采用从 Railway 当前可访问部署冻结、且与用户截图路由和视觉一致的原版制品；没有证据证明它来自 2026-05-15 前构建。发布任务不得改动页面、交互、样式或文案。

## 执行开关顺序

新环境和回滚后默认关闭真实执行：

```text
PAYMENT_CONFIRMATION_ENABLED=false
PROVIDER_INVENTORY_SYNC_ENABLED=false
DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false
DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=false
DEDICATED_LINE_HEALTH_EXECUTION_ENABLED=false
BARK_ALERTS_ENABLED=false
```

灰度时按以下顺序逐项开启并留存审计证据：

1. `DEDICATED_LINE_HEALTH_EXECUTION_ENABLED`
2. `PROVIDER_INVENTORY_SYNC_ENABLED`
3. `BARK_ALERTS_ENABLED`
4. 仅包含一个测试 Provider 账号的订单 allowlist
5. `DEDICATED_LINE_ORDER_EXECUTION_ENABLED`
6. `DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED`
7. 最后才开启 `PAYMENT_CONFIRMATION_ENABLED`

任何一步失败，立即关闭订单、投影和支付执行开关；不得用默认值、假库存或手工改库绕过生产就绪检查。

## PostgreSQL 备份

运行环境必须安装与生产数据库主版本匹配的 `pg_dump` 和 `pg_restore`。密码只通过 `DATABASE_URL` 解析后注入 `PGPASSWORD`，不会出现在命令参数中。

```bash
DATABASE_URL='postgresql://...' pnpm db:backup -- --output backups/pre-release.dump
```

脚本生成 custom-format dump 和同名 `.json` 元数据，包含大小与 SHA-256。备份完成后会执行 `pg_restore --list` 验证格式。备份文件必须复制到独立加密存储，并配置保留策略，不能只留在应用容器临时磁盘。

## 隔离恢复演练

先新建隔离数据库，确认目标库名后恢复：

```bash
NODE_ENV=test DATABASE_URL='postgresql://.../platform_recovery' \
  pnpm db:restore -- --input backups/pre-release.dump --confirm-database platform_recovery
```

恢复后至少验证：

- `_prisma_migrations` 已完成数量与生产一致；
- public 表数量一致；
- 站点、租户、钱包、订单、专线、投影、路由、outbox 和审计记录数量合理；
- API 指向隔离库时 `/ready` 成功，生产就绪接口能读取但不产生写操作。

生产库恢复必须额外传入 `--allow-production`，且 `--confirm-database` 必须与 URL 中数据库名完全一致。只有事故指挥人批准后才能执行。

## 灰度与回滚

灰度只允许一个测试用户、一个 SKU、一个 Provider 账号和明确金额上限。必须验证报价、扣款、库存预留、Provider 单次采购、固定节点投影、主备域名、协议握手、出口国家、续费、暂停/恢复及迁移。

应用回滚使用 `release-manifest.json` 中上一个已知正常 digest，同时将真实执行开关关闭。数据库采用 forward-only corrective migration，不删除订单、账本、库存预留、outbox 或审计记录。

## 事故与监控

至少对以下信号配置告警：worker 心跳停止、库存快照过期、Provider 健康失败、控制节点不可达、projection 长时间未收敛、outbox 堆积、订单终态失败、数据库/Redis readiness 失败、生产就绪检查由 true 变 false。

已在聊天、历史提交或部署导出中出现过的凭据一律视为泄漏。发布前必须在对应服务端轮换，并确认旧凭据不可用；仓库历史清理需要独立审计和协作者重新同步。
