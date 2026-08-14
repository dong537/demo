# 最终本地与线上验证记录

日期：2026-08-14

## 代码质量

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- `pnpm test`：通过；存在既有 React Testing Library `act(...)` warning，不影响断言结果，后续应清理测试噪声。
- `pnpm test:security`：3/3 通过。
- `pnpm test:operations`：11/11 通过，包含 CI 加密密钥 YAML 类型回归契约。
- `pnpm security:secrets`：冻结前端纳入 Git 后共 1,443 个当前文件通过，无已知 secret 命中。
- `pnpm frontend:frozen:verify`：279 个冻结文件通过。
- `pnpm audit --prod --audit-level high`：改用 npm 官方 registry 后通过，无已知生产依赖漏洞；默认 npmmirror audit endpoint 不可用。
- `git diff --check`：通过，只有 Windows LF/CRLF 提示。

## 行为与真实基础设施测试

- Playwright E2E：8/8 通过，真实 API/Web 进程由 Playwright 管理并在结束后释放。
- PostgreSQL/Redis 集成：本地隔离 Docker PostgreSQL `15432` 与 Redis `6379`；使用与 CI 相同的 64 位字符串密钥，33 个文件、162 个测试通过。
- Railway 在线浏览器 smoke：1440x900、390x844、320x844 三个视口通过。
- Railway capability 回读：家宽 UI/购买为 false，专线 UI/购买为 true。

## 容器验证

- Web image build 通过；`/healthz` 正常；`/proxy/dedicated/buy` 返回 200；返回入口与冻结 `index.html` 一致；Vue 入口存在且 React 入口不存在。
- API image build 通过；隔离 PostgreSQL/Redis 下 `/health` 与 `/ready` 均为 200，release SHA 匹配，未知 API route 返回 404。
- Worker image build 通过；所有真实执行开关关闭时正常启动，并出现预期 worker 启动信号。

## 发布门状态

`pnpm predeploy:check` 在当前开发工作树上按设计拒绝脏状态。交付采用不继承旧提交历史的单一根提交；将在该干净快照中再次执行 predeploy、secret scan 和冻结前端校验后才推送。

GitHub 目标仓库的默认分支是 `master`；`production-gate` 已同时监听 `main` 与 `master`，避免覆盖推送后因分支名不一致而跳过完整 CI。

首次远程 CI 暴露 YAML 标量类型问题：未加引号的 64 个零被 GitHub Actions 解析成数字 `0`，集成测试在环境校验阶段拒绝该 1 字符密钥。工作流现将测试密钥显式声明为字符串，并由运维契约测试锁定 64 位十六进制格式。

第二次远程 CI 的集成测试为 32/33 文件、161/162 用例通过；唯一失败依赖 TEST-NET 外网地址在 20 秒内超时。代理探测 fixture 已改为本机关闭端口并增加 `PROXY_UNREACHABLE` 精确断言，使失败快速、确定，同时继续覆盖凭据脱敏和审计写入；生产探测实现未改。

这些结果证明当前代码快照可构建、可测试、可容器化，且原版线上专线页面可用；它们不证明第三方真实采购和线路数据面已经通过生产验收。真实执行仍受凭据轮换、价格、Provider、3x-ui/OpenUI、NY 转发/DNS、Bark 和协议握手门控。
