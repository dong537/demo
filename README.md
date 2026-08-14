# IPEasy Platform

家宽代理平台 — 全球原生住宅 IP，支持静态/动态代理购买、订单管理、钱包充值、多供应商履约。

## 技术栈

- Monorepo：pnpm workspace + Turborepo
- 后端：NestJS + TypeScript + Prisma + PostgreSQL
- 缓存/队列：Redis
- 前端：React + Vite + TanStack Router/Query + Ant Design
- 测试：Vitest + Supertest + Playwright

## 本地启动

```bash
# 1. 启动数据库和缓存
docker-compose up -d

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入真实值

# 4. 启动开发服务
pnpm dev
```

数据库连接：`postgresql://ipipx:ipipx@localhost:15432/ipipx`  
Redis 连接：`redis://localhost:6379`
