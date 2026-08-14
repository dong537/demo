# 阶段 6：Web 质量基线与线上阻塞点

## 已验证

- Web Vitest：59 个测试文件，353 个测试，353 通过（包含专线启停真实端点回归）。
- API Vitest：71 个测试文件，412 个测试，412 通过；API typecheck/lint 通过。
- OpenAPI export 已包含 `/api/dedicated-lines/{id}/suspend` 与 `/resume`；Contracts generate/typecheck 通过。导出同时补齐了此前未同步的历史 API 路由，因此生成文件 diff 较大，需在提交前作为同一份契约审阅。
- Web typecheck：通过。
- Web lint：通过。
- Web production build：通过（Vite 6.3.5，4112 modules）。
- `git diff --check`：通过。
- 管理端订单列表现在显示租户上下文、Provider 展示名和上游订单号，便于多上游分配后的排障。
- 管理端工单与审计列表保留后端 `reasonKey`，不再把可诊断错误静默变成通用错误。
- 客户端错误映射在缺少本地翻译时保留后端原因；已补充未知原因回归测试。
- 客户目录仓储和报价用例现在强制 `capabilities.delivery=dedicated-line`；旧家宽 SKU 即使仍处于可见状态，也不会出现在客户目录或报价路径，管理员目录仍可读取历史 SKU。
- 该降级边界已同步到 `.trellis/spec/api-contract.md`，包含接口、错误矩阵、测试断言和错误/正确示例。
- 测试环境将 Testing Library async query timeout 提高到 5 秒，原因是 Ant Design + jsdom 在全量并发套件中的真实渲染耗时；这只影响测试 harness，不改变产品运行时超时或业务逻辑。
- 专线生命周期已补齐客户 `POST /api/dedicated-lines/:id/suspend|resume`：PostgreSQL desired state、`suspendedAt`、投影 desiredVersion/hash 和每节点 job 在一个事务内更新；重复目标状态只读重放。真实集成覆盖启停、任务幂等、过期拒绝和 `SUSPENDED -> PROVISIONING`。
- 当前 OpenUI/Xray 可验证边界是累计 quota、到期和 client enable；精确到 Email 的 bit/s 限速仍未进入可验收数据面，因此没有在客户 UI 暴露“限速”假能力。流量扩容也尚无独立价格/计费契约，继续保持未开放。

## Zeabur 发布状态

- CLI 已认证，当前账号可访问两个项目：`ipeasy-platform`（ID `6a4012ad68aa348ebd0f25d8`）和 `untitled`（ID `6a786d80e4a69d66638d62e1`）。
- 当前 CLI 版本不支持 `project list --json`；部署命令支持指定 `--service-id` 或交互式创建服务，不能从本地目录自动推导完整 API/Web/Worker 拓扑。
- 目标项目尚未确认，因此没有执行部署或创建服务。
- 本地发布前检查会拒绝脏工作树；当前仍有本轮 Web 修复和回归测试未提交，不能宣称已满足发布前检查。
- 本地 `365-phase4-postgres` 测试库补齐 2 个未应用 migration 后，目录集成测试 2/2 通过；未使用内存或伪造数据库。
- `pnpm run predeploy:check` 已按预期拒绝当前未提交工作树；这不是部署失败，而是发布门禁仍未满足。

## 线上验收阻塞

以下项目必须在用户确认目标项目并以 Zeabur Secret 注入后才能进行真实验收：

1. PostgreSQL/Redis 服务连接与 Prisma migration。
2. API、Worker、Web 三个服务的真实环境变量和域名。
3. 985Proxy/IPIPD 的生产凭据与库存读取。
4. OpenUI/3x-ui 节点地址、管理凭据和投影回读。
5. NY 面板导入的线路快照、多个入口域名及 DNS。
6. Bark 管理员设备密钥与 outbox worker 投递。
7. 外部客户端从入口域名完成 SV/ZB 真实连通性测试，以及续费、停用后的回读。

## 只读线上探测（2026-08-12）

- `https://ipeasy-platform.zeabur.app/health`、`/ready`、`/healthz` 返回 200，数据库和 Redis 健康；但 `/health` 的 build 标识仍是旧的 `2026-07-22-read-only-ops-diagnostics`。
- 该旧线上版本的 `/api/catalog/skus` 与 `/api/openapi/dedicated/skus` 返回 404，不能作为当前代码已部署的证据。
- `test-sv-1.yisukj.top` 和 `test-zb-1.yisukj.top` 当前解析到 `14.116.138.238`，60701/60702 未完成可用的 HTTP/TLS 响应。
- `sv-1.365proxy.net` 与 `zb-1.365proxy.net` 当前 CNAME 链路没有呈现需求中的 `cntcgz-lb` / `cntcgz-lb-vip` 入口组。
- 香港 3x-ui 主机 `91.149.237.33:22` 从当前网络连接超时；只读 SSH 探测未进入认证阶段，未执行任何远程修改。

在上述依赖没有通过 smoke check 前，必须保持：

- `DEDICATED_LINE_ORDER_EXECUTION_ENABLED=false`
- `DEDICATED_LINE_PROJECTION_EXECUTION_ENABLED=false`
- Provider allowlist 为空或仅包含已验证账号

用户此前在聊天中暴露过多组生产凭据，正式上线前应全部轮换；本文件不保存任何密钥、Token 或密码。
