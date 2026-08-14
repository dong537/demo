# Phase 8 专线控制面验收证据

日期：2026-08-13（Asia/Shanghai）

## 已验证

- `pnpm --filter @ipeasy/api lint`、`typecheck`、`build` 通过。
- API 全量测试：87 个测试文件、476 个测试通过。
- `pnpm --filter @ipeasy/web lint`、`typecheck`、`build` 通过。
- Web 全量测试：61 个测试文件、358 个测试通过。
- `pnpm --filter @ipeasy/worker lint`、`typecheck`、`build` 通过。
- Worker 全量测试：5 个测试文件、18 个测试通过。
- 专线投影回归测试覆盖 NODE_ONLY 使用当前 `ASSIGNED` 出口的边界，5 个投影测试通过。
- Prisma schema 校验通过；生产数据库已应用 `20260813090000_add_dedicated_line_migrations`，当前迁移部署包含 18 个 migration。
- Zeabur API、Worker、Web、OpenUI、PostgreSQL、Redis 均为 `RUNNING`。
- `https://365proxy-untitled.zeabur.app/health`、`/ready`、`/openapi.json` 返回 200；未认证的迁移管理路由返回 401。
- Playwright headless 浏览器访问线上 Web 返回 200，首页标题与主要内容正常渲染，未捕获 console/page error。
- API 线上启动日志已映射专线迁移、迁移推荐、线路限制与域名管理路由；Worker 日志确认生产执行开关关闭，没有触发供应商、Bark 或 3x-ui 外部副作用。

## 本轮修复

- 提交迁移时将目标投影提升为当前投影，并重置 observed 状态、重建 `ACTIVE` desired hash、创建新的 projection external job，确保最终配置真的再次下发到 3x-ui。
- NODE_ONLY 迁移继续使用当前 `ASSIGNED` 出口，只有 EXIT_ONLY/FULL 的新出口才要求迁移期间的 `RESERVED` 状态。
- 目标投影创建时按线路真实当前状态生成 hash，避免 Worker 读取 `ACTIVE` 时出现 hash mismatch。
- 最后一个迁移目标投影回读成功后，自动推进迁移状态机：普通迁移进入 `CANARY_ROUTE`，EXIT_ONLY 进入 `VERIFY`。
- 清理未使用变量/类型，修复 Web `crypto` 全局 lint 问题。

## 未验证与上线门槛

- 未执行真实 3x-ui/OpenUI 节点协议 smoke、NY route/domain 导入真实链路、985Proxy/ipipd 真实下单、Bark 真实推送或 Xray 实际流量连通性。
- 原因：当前生产执行开关关闭，且用户提供的服务器/Provider 凭据曾在聊天中暴露，不应直接写入部署；正式上线前必须轮换凭据，并由用户在受控 secret store 注入。
- 因此本阶段可以确认“控制面代码、数据库、API/UI、部署健康”已验证，不能确认“真实跨境专线已交付”。

## 只读网络核验

- `test-sv-1.yisukj.top` 与 `test-zb-1.yisukj.top` 均解析到 `14.116.138.238`。
- 香港目标机 `91.149.237.33` 的 `22/60701/60702` TCP 端口可达；该结果不证明 SSH 认证、3x-ui API、NY 转发或 Xray 流量协议可用。
- 入口端口探测存在等待超时，未把 TCP 超时解释为线路故障，也未执行任何远程修改。
