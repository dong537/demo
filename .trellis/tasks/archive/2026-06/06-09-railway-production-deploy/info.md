# 部署记录

## 2026-06-09 预检

- `railway --version` 成功：Railway CLI `4.66.0`。
- `git status --short --untracked-files=all` 仅显示当前 Trellis 部署任务文件，业务代码工作树保持 clean。
- `railway status` 失败：OAuth token refresh `invalid_grant`，CLI 返回 `Unauthorized. Please run railway login again.`
- `railway service list` 失败：同样未授权。

## 当前阻塞

需要在本机重新登录 Railway CLI。

可执行方式：

```powershell
railway login
```

如果浏览器登录不方便：

```powershell
railway login --browserless
```

登录完成后继续从以下步骤恢复：

```powershell
railway status
railway service list
railway up --service backend --environment production --message "deploy backend"
railway up --service frontend --environment production --message "deploy frontend"
railway up --service worker --environment production --message "deploy worker"
```

## 2026-06-09 恢复预检

- `railway status` 成功，当前链接到 project `ipipx-platform-live-20260526` / environment `production`。
- Railway 服务在线：`backend`、`frontend`、`worker`、Postgres、Redis。
- `git status --short --untracked-files=all` 仅显示当前 Trellis 部署任务文件，业务代码工作树保持 clean。

## 2026-06-09 部署执行

### 关键发现

- 直接执行 `railway up --service backend --environment production --message "deploy backend"` 时，Railway CLI 没有读取 `apps/api/railway.json`，而是按仓库根目录默认 Railpack 构建，生成 deployment `58494a8d-e654-4a07-98dc-610af4586487`，状态 `FAILED`。
- 失败 deployment 的 `fileServiceManifest` 为空，`serviceManifest.build.builder` 为 `RAILPACK`；这说明 CLI 上传路径没有自动使用包内 Railway 配置。
- 三个服务的 `apps/*/railway.json` 都依赖 monorepo 根目录执行 `pnpm install` 和 `pnpm --filter ...`，因此不能直接使用 `railway up apps/api --path-as-root` 把包目录当作根目录上传。
- 本次采用临时根目录 `railway.json` 作为 CLI 上传配置：部署每个服务前写入对应服务配置，部署后删除。该临时文件没有提交。

### backend

- 临时根配置来源：`apps/api/railway.json`。
- 部署命令：`railway up --service backend --environment production --message "deploy backend"`。
- CLI 上传阶段出现一次 request timeout，但 Railway 已创建 deployment。
- Deployment ID: `741dbf25-6d54-4fc8-8aaf-ce18a3acbd95`。
- 最终状态：`SUCCESS`。
- 服务状态：`Online`。
- URL: `https://backend-production-43893.up.railway.app`。

### frontend

- 临时根配置来源：`apps/web/railway.json`。
- 部署命令：`railway up --service frontend --environment production --message "deploy frontend"`。
- 第一次执行时 Railway GraphQL TLS handshake EOF，未创建新 deployment；重试成功。
- Deployment ID: `8746cca3-bdec-4b6a-9d28-926593dd038a`。
- 最终状态：`SUCCESS`。
- 服务状态：`Online`。
- URL: `https://frontend-production-9279.up.railway.app`。

### worker

- 临时根配置来源：`apps/worker/railway.json`。
- 部署命令：`railway up --service worker --environment production --message "deploy worker"`。
- Deployment ID: `979c32f7-5289-4ba2-8286-ff183876e9e3`。
- 最终状态：`SUCCESS`。
- 服务状态：`Online`。
- worker 不暴露 HTTP healthcheck。

## 2026-06-09 Smoke 验证

- `curl.exe -fsS -o NUL -w "%{http_code}" https://backend-production-43893.up.railway.app/health` -> `200`。
- `curl.exe -fsS -o NUL -w "%{http_code}" https://backend-production-43893.up.railway.app/ready` -> `200`。
- `curl.exe -fsS -o NUL -w "%{http_code}" https://backend-production-43893.up.railway.app/openapi.json` -> `200`。
- `curl.exe -fsS -o NUL -w "%{http_code}" https://frontend-production-9279.up.railway.app/healthz` -> `200`。

## 结果

- Railway `production` 环境中 `backend`、`frontend`、`worker` 均已部署成功并处于 `Online`。
- 未输出或记录任何 Railway secret / provider secret / JWT secret / 加密密钥。
- 工作树仅保留当前 Trellis 部署任务记录，业务代码未改动。
