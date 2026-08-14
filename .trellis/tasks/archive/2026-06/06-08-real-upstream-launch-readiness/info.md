# 上线验收实现记录

## 本轮已完成

- 写入 Railway 三服务配置：`apps/api/railway.json`、`apps/web/railway.json`、`apps/worker/railway.json`。
- 新增 `.railwayignore`，排除本地 env、dist、coverage、日志、临时文件和 Prisma generated client。
- 后端支持显式 `CORS_ORIGINS`，为空时不启用 CORS，不做 silent fallback。
- 前端 API client 支持 `VITE_API_BASE_URL`，同源/本地测试仍可使用相对 `/api/*`。
- 前端生产静态服务使用 Railway `PORT`，并提供 `/healthz`。
- 履约 worker 回到既有 `apps/worker` 包，使用 `@ipeasy/api/worker` 导出的履约模块，不暴露 HTTP。
- worker 支持 `WORKER_FULFILLMENT_POLL_INTERVAL_MS`、`WORKER_FULFILLMENT_BATCH_SIZE`，并在 `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false` 时不扫描队列。
- 真实履约开启时增加 allowlist 门禁：生产启动时若 provider/account allowlist 均为空会失败；use case 未命中 allowlist 时返回 `UPSTREAM_DISABLED`。
- 写入 `docs/railway-deployment-runbook.md`，记录 Railway 配置、变量、部署、smoke、真实上游验收和回滚步骤，不包含 secret。

## 已运行验证

- `pnpm --filter @ipeasy/db generate`
- `pnpm --filter @ipeasy/api typecheck`
- `pnpm --filter @ipeasy/api lint`
- `pnpm --filter @ipeasy/api test`
- `pnpm --filter @ipeasy/api build`
- `pnpm --filter @ipeasy/worker typecheck`
- `pnpm --filter @ipeasy/worker lint`
- `pnpm --filter @ipeasy/worker test`
- `pnpm --filter @ipeasy/worker build`
- `pnpm --filter @ipeasy/web typecheck`
- `pnpm --filter @ipeasy/web lint`
- `pnpm --filter @ipeasy/web test`
- `pnpm --filter @ipeasy/web build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @ipeasy/api test:integration`

## 注意事项

- 初次集成测试曾因手动注入的 `APP_ENCRYPTION_KEY` 只有 32 个 hex 字符失败；已改用 64 个 hex 字符后通过。
- `rtk pnpm --filter @ipeasy/api typecheck` 会因 rtk 对 pnpm filter 的识别限制返回非零，但原始 `pnpm --filter @ipeasy/api typecheck` 通过。

## 仍需在真实环境执行

- Railway Dashboard 中将三项服务分别指向对应 config path。
- 设置生产变量，尤其是 `VITE_API_BASE_URL`、`CORS_ORIGINS`、数据库/Redis、加密密钥、JWT secret、履约门禁变量。
- 通过 `PROVIDER_CREDENTIAL_JSON` 写入 PR / IPIPD / 985Proxy 凭据，写入后清理临时变量。
- 对三个 provider 运行 health check、inventory sync、dry-run buy、小额真实 buy。
- 真实履约前只打开目标 provider/account allowlist；验收失败路径时先缩小 allowlist 或停用对应 provider account。
- 部署后运行 runbook 中的 `/health`、`/ready`、`/openapi.json`、`/healthz` 和人工业务 smoke。
