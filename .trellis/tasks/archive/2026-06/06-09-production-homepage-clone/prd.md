# 生产首页复刻与域名访问

## Goal

让生产前端一访问根路径 `/` 就进入公开首页，并将 `https://ipipx.365proxy.net/` 现有首页视觉与结构迁移到当前重写项目的前端。当前 Railway 前端根路径仍进入受登录保护的客户区，不能作为公开首页。

## What I Already Know

- 当前生产前端：`https://frontend-production-9279.up.railway.app/`。
- 目标参考站：`https://ipipx.365proxy.net/`，返回 Vite/React 单页应用 HTML。
- 旧项目源码位于 `C:\Users\Lenovo\Desktop\家宽代理平台`，其中：
  - `apps/web/src/App.tsx` 包含 `IpeasyLandingPage`、`BrandLogo`、`LandingMiniIcon`。
  - `apps/web/src/styles.css` 包含 `.ipeasy-landing` / `.landing-*` 首页样式。
  - `reference-home.png` 是目标首页参考截图。
- 当前项目 `apps/web/src/app/router.tsx` 中，`customerLayoutRoute` 没有 `path`，其子路由 `path: '/'` 受 `user_token` 保护，导致根路径不是公开首页。
- 当前项目使用 React + Vite + TanStack Router + TanStack Query + Ant Design。
- 当前 `Providers` 会读取 `/api/sites/current` 的 `brandConfig` 并设置 Ant Design 主色和文档标题。

## Assumptions

- 用户说“一比一复刻这个前端页面”指复刻 `https://ipipx.365proxy.net/` 当前公开首页首屏和主要区块，而不是迁移旧项目的客户区、后台和所有业务页面。
- 生产根域名 `https://ipipx.365proxy.net/` 后续会指向当前 Railway frontend 服务；本任务负责代码和 Railway 部署，DNS/Cloudflare/Zeabur 迁移若需要控制台权限则记录为外部操作。
- 公开首页可以调用现有 `/api/sites/current` 获取公开站点配置；接口失败时显示明确未加载状态，不伪造库存、国家数或价格。

## Requirements

- 新增公开首页路由：访问 `/` 直接渲染公开首页，不要求登录，不跳转 `/login`。
- 保留现有客户区登录后入口；客户区首页改为明确路径，例如 `/overview`，不能继续占用公开根路径。
- 迁移旧项目首页的主要视觉结构：
  - 顶部导航、品牌标识、语言按钮、登录/注册 CTA。
  - Hero：全球原生住宅 IP / 动静态全覆盖。
  - 平台能力统计卡。
  - 为什么选择、产品方案、覆盖地区、业务场景、FAQ、CTA、浮动快捷入口、Footer。
- 首页样式应限定在公开首页命名空间内，不能污染 Admin/Customer 的 Ant Design 页面。
- 不迁移旧项目的大量业务逻辑、旧 API client 或旧路由系统。
- 生产部署后完成 smoke：
  - Railway frontend `/` 返回 200 且页面可见首页关键文案。
  - Railway frontend `/healthz` 返回 200。
  - 若能完成域名绑定，则 `https://ipipx.365proxy.net/` 根路径也应进入同一首页。

## Acceptance Criteria

- [ ] 本地构建通过：`pnpm --filter @ipeasy/web typecheck`、`pnpm --filter @ipeasy/web lint`、`pnpm --filter @ipeasy/web build`。
- [ ] `/` 是公开首页，不需要 `user_token`。
- [ ] `/login`、`/admin/login`、客户区 `/overview` 等现有入口不被破坏。
- [ ] 公开首页视觉接近旧项目目标站，包含目标站主要区块和文案。
- [ ] 不引入假库存、假价格、假国家覆盖；公开数据缺失时显示真实状态。
- [ ] Railway frontend 部署成功并通过 smoke。
- [ ] 如生产自定义域名没有指向 Railway，记录需要用户在 DNS/Railway 中完成的外部操作。

## Definition of Done

- Trellis 任务记录实现、验证、部署和任何外部阻塞。
- 相关代码和文档提交。
- 工作树干净。

## Out of Scope

- 不迁移旧项目全部 `App.tsx`、旧后台、旧客户区和旧 API client。
- 不新增真实库存/价格/国家数据。
- 不修改 Railway secret 值。
- 不在前端 bundle 中加入任何 secret。
- 不做大规模 SEO、埋点和多语言完整实现。

## Technical Approach

- 在当前项目新增 `apps/web/src/routes/public/home.tsx`，封装公开首页组件。
- 新增 `apps/web/src/routes/public/home.css`，只使用 `.ipeasy-landing` / `.landing-*` 命名空间，避免影响后台/客户区。
- 在 `apps/web/src/app/router.tsx` 新增根路由 `/` 指向 `PublicHomePage`。
- 将 `customerLayoutRoute` 改为明确 `path: '/customer'` 或保留无路径但删除其 `/` 子路由，避免公开根路径被客户区守卫拦截；现有 `/overview` 等客户路由需要继续可用。
- 首页通过 `buildApiUrl('/api/sites/current')` 读取公开配置；失败时仅显示“公开库存未加载/暂无公开可售库存”。
- 部署沿用 Railway CLI monorepo 临时根 `railway.json` 流程。

## Technical Notes

- 目标旧首页源码：
  - `C:\Users\Lenovo\Desktop\家宽代理平台\apps\web\src\App.tsx`
  - `C:\Users\Lenovo\Desktop\家宽代理平台\apps\web\src\styles.css`
- 当前前端入口：
  - `apps/web/src/app/router.tsx`
  - `apps/web/src/app/providers.tsx`
  - `apps/web/src/main.tsx`
- 相关规范：
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/testing-deployment.md`
