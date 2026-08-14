# 数据库恢复与生产上线

## 目标

将当前无法确认可启动的 Railway Postgres 数据恢复为可验证、可回滚的生产部署基础，并在不修改现有前端的前提下完成后端、worker 与专线业务的上线前检查。

## 用户与成功标准

- 用户：365Proxy 平台运营者和管理员。
- 成功标准：
  1. 本地文件级备份在隔离 PostgreSQL 18 实例中完成正常启动或形成明确的不可恢复证据；
  2. 若可启动，完成 globals 与每个业务库的逻辑导出，并在全新空库中恢复通过；
  3. Railway 使用新卷/新数据库或官方备份恢复路径承载已验证数据，旧卷保持可回滚；
  4. backend 与 worker 使用 GitHub `master` 构建并健康运行，迁移、Redis、前端 API 契约和关键错误告警通过；
  5. 不改动 `apps/web/**`；专线页面仍使用现有五月版本前端；
  6. 真实供应商、3x-ui、NY 转发和 Bark 的小额/单条 smoke 在管理员确认后通过；
  7. 生产 secrets 完成轮换，旧凭据不再有效，备份、监控、回滚步骤可执行。

## 明确不做

- 不恢复或引入家宽业务，不新增家宽前端入口。
- 不直接覆盖 Railway 当前损坏或已满的 Postgres 卷。
- 不在生产路径使用 mock、默认值、静默 catch 或假库存。
- 不修改现有前端源码、文案、样式、路由或生成物。
- 不在真实供应商验证前开启自动下单、自动迁移或高风险执行开关。

## 当前事实与根因

- Railway `Postgres-CVre` 日志持续报告 `pg_wal/xlogtemp.*: No space left on device`，随后恢复中断并退出；该卷约 10GB，已满。
- 本地文件级备份约 9.73GB，PG_VERSION 为 18，包含完整 PGDATA 目录结构和 Railway 锁/清单文件；Windows 文件复制不保留 Unix mode，因此恢复副本必须在 Linux 容器内重新设置属主和权限。
- Railway GraphQL 备份恢复接口对当前 OAuth 身份返回 `Not Authorized`；CLI 仅能查看服务/卷，不能替代控制台的备份恢复和在线扩容审核。

## Source of Truth 与数据流

1. 备份源：`C:\Users\Lenovo\Desktop\365-backups\postgres-volume-2026-08-14`，只读，不作为运行目录。
2. 恢复副本：唯一命名的 Docker volume；副本内的 PostgreSQL 实例是恢复验证期间的临时权威源。
3. 逻辑备份：`pg_dumpall --globals-only` 加每业务库 `pg_dump -Fc`；恢复验证以全新空 PostgreSQL 实例为权威源。
4. Railway：只向新卷/新数据库导入已验证逻辑备份；应用通过 Railway 注入的数据库 URL 连接，不把凭据写入仓库。
5. 应用：迁移状态由数据库记录和现有迁移 state machine 负责；backend 提供 API，worker 负责异步任务，前端只消费稳定 API。

## 模块边界

- 恢复脚本/命令：只负责副本创建、启动探针、导出和校验，不改业务代码。
- 数据库：PostgreSQL 数据与迁移是唯一业务状态源；Redis 只承载缓存/队列。
- backend/worker：沿用现有 provider adapter、订单状态机、库存门和审计日志边界。
- Railway adapter：只执行已授权的卷/服务配置和部署操作，任何权限错误必须显式失败。
- 前端：只读验证，禁止改动 `apps/web/**`。

## 风险与验证

- WAL/控制文件损坏或备份不完整：先正常恢复；失败时保留日志和 `pg_controldata` 证据，禁止对原始备份执行 `pg_resetwal`。
- 逻辑导出大于 Railway 卷容量：停止导入，先扩容或创建更大新库。
- 账号密码未知：优先容器内 Unix socket 管理连接，不猜测线上密码。
- 线上权限不足：记录 GraphQL/CLI 错误，要求用户在 Railway 控制台完成恢复或授权后再继续。
- 生产风险：高风险 provider/3x-ui/NY/Bark 开关默认关闭，先做无副作用连接和单条 smoke。

## 验证命令与交付证据

- 备份结构、文件计数、字节数、零长度/缺失/重解析点审计；
- Docker PostgreSQL 18 条件探针、`pg_controldata`、`pg_isready`、`pg_dump`；
- 全新空库逻辑恢复、迁移状态和关键表计数；
- Railway 服务/卷状态、部署日志、healthcheck、API/worker smoke；
- root typecheck/lint/test/build、API/worker/真实 PostgreSQL 集成测试保持通过；
- Git diff 确认 `apps/web/**` 未修改；
- secrets 轮换、备份恢复演练、监控告警与回滚记录。
