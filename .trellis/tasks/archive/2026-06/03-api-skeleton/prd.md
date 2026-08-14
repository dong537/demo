# Task 03 — NestJS API 骨架

## 目标

初始化 `apps/api`，安装 NestJS + Fastify adapter，建立 `common/` 公共层，设置统一 envelope 拦截器、异常过滤器、requestId、`/health`、`/ready` 端点，以及生产启动门禁检查。

## 实现要求

### 依赖

```json
{
  "@nestjs/core": "^11",
  "@nestjs/common": "^11",
  "@nestjs/platform-fastify": "^11",
  "@nestjs/config": "^4",
  "@nestjs/swagger": "^8",
  "fastify": "^5",
  "zod": "^3",
  "@ipeasy/db": "workspace:*",
  "@ipeasy/config": "workspace:*"
}
```

### apps/api/src/main.ts

- 创建 `FastifyAdapter` 实例
- 设置全局 prefix `/api`（health 和 ready 不加 prefix）
- 注册 `EnvelopeInterceptor`（全局）
- 注册 `AppExceptionFilter`（全局）
- 调用 `ConfigGuard.verify()` — 生产启动门禁（见下）
- 监听 `PORT`（默认 3000）

### apps/api/src/common/config/env.schema.ts

用 zod 定义并 `parse` 的环境变量 schema，必须覆盖：

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  JWT_SECRET: z.string().min(16),
  APP_PLATFORM_CURRENCY: z.string().length(3),
  ALLOW_PLACEHOLDER_APIKEYS: z.enum(['true', 'false']).default('false'),
  ALLOW_LOCAL_DEV_APIKEY: z.enum(['true', 'false']).default('false'),
});
```

启动时若 parse 失败，打印 zod 错误并 `process.exit(1)`。

### apps/api/src/common/config/config.service.ts

- `@Injectable()` 单例
- 封装 `get<T>(key: keyof EnvConfig): T` 方法
- 内部从已 parse 的 `envSchema` 读取，不直接暴露 `process.env`
- 其他模块通过注入此服务读取配置，禁止直接 `process.env.*`

### apps/api/src/common/errors/error-codes.ts

导出稳定 `ErrorCode` 枚举（string enum），至少包含：

```ts
AUTH_REQUIRED = 'AUTH_REQUIRED',
PERMISSION_DENIED = 'PERMISSION_DENIED',
TENANT_SCOPE_VIOLATION = 'TENANT_SCOPE_VIOLATION',
VALIDATION_ERROR = 'VALIDATION_ERROR',
IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
WALLET_INSUFFICIENT_BALANCE = 'WALLET_INSUFFICIENT_BALANCE',
CURRENCY_NOT_SUPPORTED = 'CURRENCY_NOT_SUPPORTED',
RESOURCE_MAPPING_MISSING = 'RESOURCE_MAPPING_MISSING',
PRICE_MISSING = 'PRICE_MISSING',
UPSTREAM_DISABLED = 'UPSTREAM_DISABLED',
UPSTREAM_ERROR = 'UPSTREAM_ERROR',
UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
UPSTREAM_OUT_OF_STOCK = 'UPSTREAM_OUT_OF_STOCK',
UNSUPPORTED_CAPABILITY = 'UNSUPPORTED_CAPABILITY',
INTERNAL_ERROR = 'INTERNAL_ERROR',
NOT_FOUND = 'NOT_FOUND',
```

### apps/api/src/common/errors/app-error.ts

```ts
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly reasonKey: string,
    public readonly httpStatus: number,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) { super(message ?? reasonKey); }
}
```

### apps/api/src/common/errors/exception-filter.ts

`@Catch()` 全局过滤器：

- `AppError` → 对应 httpStatus，body 使用统一 envelope（code, msg, data.reasonKey, requestId）
- `ZodError` → 422，`VALIDATION_ERROR`，details 包含 zod issues
- 未知错误 → 500，`INTERNAL_ERROR`，不暴露内部堆栈（生产环境）

### apps/api/src/common/logging/request-id.middleware.ts

- 从 `x-request-id` header 读取或生成 UUID v4
- 写入 `x-request-id` 响应 header
- 存入 `AsyncLocalStorage` 供整个请求链路使用

### apps/api/src/common/logging/logger.service.ts

- 结构化 JSON 日志（`{ level, message, requestId, timestamp, ...context }`）
- 封装 `info`, `warn`, `error`, `debug` 方法
- 生产环境 level >= info；开发环境 level >= debug

### apps/api/src/common/interceptors/envelope.interceptor.ts

`NestInterceptor` 把 use case 返回值包装成：

```ts
{ code: 0, msg: "success", data: <返回值>, requestId: <从 AsyncLocalStorage 取> }
```

注意：异常由 `AppExceptionFilter` 处理，此处只处理成功响应。

### apps/api/src/common/auth/auth-context.ts

定义统一认证上下文类型：

```ts
type OwnerType = 'USER' | 'TENANT_ADMIN' | 'PLATFORM_ADMIN' | 'SYSTEM';

interface AuthenticatedContext {
  ownerId: string;
  ownerType: OwnerType;
  siteId: string;
  tenantId: string | null;
  scopes: string[];
  requestId: string;
}
```

导出 5 个 guard 函数（纯函数，不是 NestJS guard，task 05 升级为 decorator）：

```ts
function requireAuthenticatedContext(ctx: unknown): AuthenticatedContext
function requireUserContext(ctx: AuthenticatedContext): void  // ownerType === USER
function requireOperatorContext(ctx: AuthenticatedContext): void  // PLATFORM_ADMIN or SYSTEM
function requireTenantAdminContext(ctx: AuthenticatedContext, tenantId: string): void
function requirePlatformAdminContext(ctx: AuthenticatedContext): void
function requireSystemContext(ctx: AuthenticatedContext): void
```

每个函数在校验失败时 `throw new AppError(ErrorCode.PERMISSION_DENIED, ...)`.

### apps/api/src/common/pagination/pagination.dto.ts

```ts
class PageQueryDto {
  @IsOptional() page?: number = 1;
  @IsOptional() pageSize?: number = 20;
  @IsOptional() search?: string;
  @IsOptional() sortBy?: string;
  @IsOptional() sortOrder?: 'asc' | 'desc';
  @IsOptional() status?: string;
  @IsOptional() from?: string;
  @IsOptional() to?: string;
}

interface PageResult<T> {
  page: number; pageSize: number; total: number; items: T[];
}
```

### apps/api/src/common/money/money.ts

```ts
// 所有金额运算必须通过这些函数，不用 JS number 做货币计算
import Decimal from 'decimal.js';
export function toDecimalString(value: string | number | Decimal): string
export function addMoney(a: string, b: string): string
export function subtractMoney(a: string, b: string): string
export function isPositive(value: string): boolean
export function isNonNegative(value: string): boolean
export function assertCurrency(actual: string, expected: string): void  // throw AppError if mismatch
```

依赖：`decimal.js`

### apps/api/src/common/time/time.ts

```ts
export function nowUtc(): Date   // new Date()
export function toIso(d: Date): string  // d.toISOString()
export function isExpired(d: Date): boolean
```

### apps/api/src/modules/health/health.controller.ts

- `GET /health` → `{ status: 'ok', timestamp }` — 始终 200（进程存活）
- `GET /ready` → 检查 DB 连接（`prisma.$queryRaw\`SELECT 1\`` ）和 Redis ping，失败返回 503

两个端点不加全局 prefix `/api`，不套 envelope 拦截器，直接返回 plain JSON。

## 验证步骤

```bash
cd apps/api
pnpm typecheck                    # 无类型错误
pnpm build                        # 编译成功，dist/ 生成
# 启动（需要 docker-compose up -d 先跑 postgres+redis）
pnpm dev
curl http://localhost:3000/health  # {"status":"ok",...}
curl http://localhost:3000/ready   # {"status":"ok",...} 或 503
curl http://localhost:3000/api/nonexistent  # 404 envelope: {code:"NOT_FOUND",...}
```

### 生产门禁测试

```bash
DATABASE_URL="" NODE_ENV=production pnpm start:prod
# 期望：启动失败，打印 zod 错误，exit code 1
```

## 禁止

- 不在 controller/use case 里直接读 `process.env`（必须注入 ConfigService）
- 不在 `AppExceptionFilter` 生产环境暴露 stack trace
- health/ready 路由不进 `/api` prefix
