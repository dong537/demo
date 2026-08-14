# Railway 原版前端恢复与边界分析

日期：2026-08-14

## 结论

`https://frontend-test-a8da.up.railway.app` 当前运行的 Vue/Element Plus 静态制品已完整冻结到 `frozen/frontend-railway-6f71aaa1/dist`。其 `/proxy/dedicated/buy` 路由、专线购买页面和视觉结构与用户提供的截图一致，生产 Web 镜像只复制这份制品，不编译或发布仓库中的 React 前端源码。

Railway 可见部署历史里没有 2026-05-15 之前仍能下载的成功部署，因此无法证明现存制品就是 5 月源码。本次恢复保存的是 Railway 当前可访问的原版运行制品，不对冻结文件进行推测性修改。

## Source of Truth

- Railway project：`fba9046c-e92e-462c-a695-0751efc46a10`
- Railway environment：`test` (`3553098c-3f6f-4e8a-9c1f-92ac9544cd2d`)
- Railway frontend service：`ef9b2601-1477-4e9a-8ce8-8cb9518e7be8`
- 捕获 deployment：`6f71aaa1-d3b7-4dc9-8395-0ac5f513eeb0`
- 镜像摘要：`sha256:58d7e2b4827fe4535b681a78b3ada2ef3038aeb38edc71e28b7a4b028dd7985a`
- 文件清单与 SHA-256：`frozen/frontend-railway-6f71aaa1/manifest.json`

冻结制品共 279 个文件、8,220,582 bytes。`pnpm frontend:frozen:verify` 会逐文件验证数量、大小和 SHA-256，并拒绝多余或被篡改的文件。

## 前后端兼容边界

冻结前端在构建产物中固定调用 `https://backend-test-0dcb.up.railway.app/api/v1`。本仓库新控制面的公开前缀是 `/api`，两者不是可直接互换的 contract。没有新增经过测试的 legacy adapter 前，不能把冻结前端改指向新 API，否则会破坏登录、目录、余额和购买流程。

因此当前合并结果是：

1. 原版前端字节冻结并作为 Web 发布制品。
2. 新专线控制面代码、数据库模型、worker 和运维能力保存在同一仓库。
3. 线上原版前端继续连接旧 `/api/v1` 后端；新控制面不得在未完成兼容层和真实端到端验收前替换它。

## 专线平台纠正

线上旧后端此前缺少四个 capability setting，代码默认值导致家宽 UI 与购买能力被错误启用。已在 Railway `test` 数据库的单个事务中写入显式值：

- `feature.residential.ui.enabled=false`
- `feature.residential.purchase.enabled=false`
- `feature.dedicated.ui.enabled=true`
- `feature.dedicated.purchase.enabled=true`

公开 capability 接口回读确认上述状态生效。静态家宽入口被隐藏且购买被禁用；旧动态住宅代理入口仍存在于桌面菜单，但其购买 CTA 是 `javascript:void(0)`，不会发起购买请求，属于显示级降级。由于用户要求不修改原版前端，本次没有改菜单源码。

## 线上浏览器证据

真实 Chromium 在 1440x900、390x844、320x844 三个视口完成登录和 `/proxy/dedicated/buy` 验证：专线页面可见、静态家宽入口不可见、无横向溢出、无核心 console/page/request failure。临时测试用户在 `finally` 中删除。

截图与结构化结果位于 `evidence/railway-online-smoke/`。已知但未修改的原版问题：Google Fonts 在当前网络可能失败并回退系统字体；320/390 宽度下页头较拥挤。两项均不阻塞桌面专线流程，但属于原版前端质量风险。

## 仍未解决的生产依赖

- Railway 环境中的 `SUPER_ADMIN_*` 与数据库现有管理员账户已漂移，旧值不能登录，需要在受控窗口重置并轮换。
- 聊天中出现过的服务器密码、985Proxy API key、ipipd App Secret 必须在各服务端轮换，旧凭据失效后才能上线真实执行。
- 985Proxy/IPIPD 真实库存和采购、Bark 真机投递、香港 3x-ui/OpenUI 投影回读、NY 转发/DNS 和 SV/ZB 协议握手尚未完成。
- 在这些检查通过前，订单、投影、库存同步、支付确认和 Bark 的真实执行开关必须保持关闭。
