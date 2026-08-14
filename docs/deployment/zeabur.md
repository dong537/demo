# Zeabur 部署

本文只描述服务拓扑和变量边界，不保存数据库、Provider、Bark、OpenUI 或 JWT 密钥。

## 服务拓扑

在已确认的 Zeabur 项目中创建以下服务，所有应用服务的 Root Directory 使用仓库根目录 `/`：

| 服务 | Dockerfile | 端口/检查 | 运行职责 |
| --- | --- | --- | --- |
| `api` | `Dockerfile.api` | `8080`, `/health`, `/ready` | NestJS API、迁移后提供业务接口 |
| `web` | `Dockerfile.web` | `8080`, `/healthz` | Vite 静态站点和 `/api/*` 反向代理 |
| `worker` | `Dockerfile.worker` | 无公开端口 | 订单、库存、Bark、OpenUI 投影 worker |
| PostgreSQL | Zeabur 数据库服务 | 内部连接串 | Prisma 数据源 |
| Redis | Zeabur Redis 服务 | 内部连接串 | 队列/限流/运行时依赖 |

如果 Zeabur 使用服务名匹配 Dockerfile，服务名应保持 `api`、`web`、`worker`；否则显式指定对应 Dockerfile 路径。官方配置支持仓库 Root Directory 和自定义构建/启动命令：[Service Configuration](https://zeabur.com/docs/en-US/deploy/config)、[Custom Root Directory](https://zeabur.com/docs/en-US/deploy/config/root-directory)。

## 首次发布顺序

1. 创建 PostgreSQL 和 Redis，读取平台生成的连接变量到 API/worker。
2. 部署 API，注入 `DATABASE_URL`、`REDIS_URL`、`APP_ENCRYPTION_KEY`、`JWT_SECRET`、`APP_PLATFORM_CURRENCY`。
3. 运行一次 `pnpm --filter @ipeasy/db migrate:deploy`，确认迁移完成后再启动 worker。
4. 部署 worker，保持 `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false`、`DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=false`，先验证健康检查和库存同步。
5. 部署 web，把 `WEB_API_PROXY_TARGET` 指向 API 的内部服务地址，并把 API 的 `CORS_ORIGINS` 限定为正式前端域名。
6. 只有 Provider 账户、SKU 库存、3x-ui/OpenUI 节点和 NY 路由导入均完成验收后，才逐项打开真实执行开关。

## 必填变量边界

- API/worker：`NODE_ENV=production`、`DATABASE_URL`、`REDIS_URL`、`APP_ENCRYPTION_KEY`、`JWT_SECRET`、`APP_PLATFORM_CURRENCY`。
- API：`CORS_ORIGINS`、`API_RATE_LIMIT_*`、`API_BODY_LIMIT_BYTES`、`PAYMENT_CONFIRMATION_ENABLED`。
- Provider：`UPSTREAM_985PROXY_*`、`UPSTREAM_IPIPD_*` 只通过 Zeabur Secret 注入；状态默认 `DISABLED`。
- 线路执行：`DEDICATED_LINE_ORDER_EXECUTION_ENABLED`、`DEDICATED_LINE_ORDER_PROVIDER_ALLOWLIST`、`DEDICATED_LINE_ORDER_ACCOUNT_ALLOWLIST`、`DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED`。
- Bark：`BARK_ALERTS_ENABLED`、`BARK_SERVER_URL`、`BARK_DEVICE_KEYS`；启用前必须验证设备密钥和 outbox worker。
- Web：`WEB_API_PROXY_TARGET`、`API_PUBLIC_URL`、`VITE_API_BASE_URL=/api`。

真实密钥不得进入 Dockerfile、git、构建日志、前端 bundle 或截图。曾在聊天或历史环境中公开的密钥应在上线前轮换。

## 上线检查

- API：`GET /health` 返回进程健康，`GET /ready` 同时验证 PostgreSQL 和 Redis。
- Web：`GET /healthz` 返回 200，登录后 `/api/sites/current` 能解析真实站点。
- 业务：SKU、quote、钱包充值确认、专线下单幂等、库存不足 Bark outbox、OpenUI 投影回读。
- 线路：NY 导入快照包含唯一主域名、多个备用域名、正确监听端口和已分配节点；客户响应只返回前门域名和 client identity。
- 运行期：观察 `requestId`、`external_jobs`、`dedicated_line_projections`、`outbox_events` 和 worker 日志，不用空数组或默认成功掩盖依赖故障。
