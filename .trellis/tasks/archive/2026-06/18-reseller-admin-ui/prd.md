# Task 18: Reseller 管理 UI

## 目标
在 admin 前端新增 Reseller 管理页面，支持 PLATFORM_ADMIN 管理所有分站，TENANT_ADMIN 管理自己分站。

## 页面清单

### PLATFORM_ADMIN 视角
- `/admin/resellers` — 分站列表（名称、状态、用户数、余额汇总、操作）
- `/admin/resellers/new` — 创建分站
- `/admin/resellers/:id` — 分站详情（概览 + 用户列表 + 订单列表）
- `/admin/resellers/:id/brand` — 品牌配置编辑

### TENANT_ADMIN 视角
- `/admin/dashboard` — 显示本租户数据（用户数、余额、订单）
- `/admin/brand` — 品牌配置编辑

## 技术要求
- 使用 Task 07 建立的 admin 前端框架
- API 调用使用 openapi-ts 生成的 client
- 权限按角色前端隐藏/跳转保护
