# Railway 生产部署

## Goal

把当前 `main` 上已经通过验证的真实上游上线运行门禁部署到 Railway `production` 环境，覆盖 `backend`、`frontend`、`worker` 三个服务，并完成部署后 smoke 验证。

## What I Already Know

- 工作树在开始部署前是 clean。
- 最近工作提交：
  - `d40937b feat(platform): 补齐真实上游上线运行门禁`
  - `a01a8c2 chore(task): 记录真实上游上线验收上下文`
- 部署 runbook 位于 `docs/railway-deployment-runbook.md`。
- Railway project: `ipipx-platform-live-20260526`。
- Environment: `production`。
- 服务配置路径：
  - backend: `apps/api/railway.json`
  - frontend: `apps/web/railway.json`
  - worker: `apps/worker/railway.json`
- worker 不暴露 HTTP healthcheck。

## Assumptions

- Railway CLI 已登录并可访问目标项目。
- Railway Dashboard 已将三个服务指向对应 config path，或 `railway up --service` 能使用已配置的服务配置。
- 生产变量已经在 Railway 中配置完成；本任务不在聊天或文档中输出 secret。
- 第一版保持 `PAYMENT_CONFIRMATION_ENABLED=false` 和 `PROVIDER_FULFILLMENT_EXECUTION_ENABLED=false`。

## Requirements

- 只部署当前已提交代码，不在部署过程中改业务代码。
- 发布 `backend`、`frontend`、`worker` 三个服务。
- 发布前做只读预检：git clean、Railway 目标环境、服务存在性。
- 发布后运行 smoke：
  - backend `/health`
  - backend `/ready`
  - backend `/openapi.json`
  - frontend `/healthz`
- 记录部署命令、结果、失败原因和 smoke 结果到 `info.md`。

## Acceptance Criteria

- [x] `railway up --service backend --environment production` 成功。
- [x] `railway up --service frontend --environment production` 成功。
- [x] `railway up --service worker --environment production` 成功，或明确记录服务不存在/配置缺失的阻塞原因。
- [x] 部署后 smoke 命令通过或失败原因可执行。
- [x] 不泄漏 Railway 变量值、provider secret、JWT secret、加密密钥。

## Definition of Done

- Trellis task 记录部署结果。
- 工作树没有未提交代码改动；仅部署记录如有必要单独提交。
- 若部署失败，记录具体阻塞点和下一步操作。

## Out of Scope

- 不写入真实 provider 凭据。
- 不开启真实履约。
- 不执行真实购买。
- 不修改 Railway secret 值。
- 不做大规模压测。

## Technical Notes

- 部署命令按 runbook 执行：
  - `railway up --service backend --environment production --message "deploy backend"`
  - `railway up --service frontend --environment production --message "deploy frontend"`
  - `railway up --service worker --environment production --message "deploy worker"`
- Smoke endpoints:
  - `https://backend-production-43893.up.railway.app/health`
  - `https://backend-production-43893.up.railway.app/ready`
  - `https://backend-production-43893.up.railway.app/openapi.json`
  - `https://frontend-production-9279.up.railway.app/healthz`
