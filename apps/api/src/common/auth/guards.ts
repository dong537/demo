import {
  Injectable,
  CanActivate,
  ExecutionContext,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { AuthenticatedContext } from './auth-context';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeyStrategy } from './apikey.strategy';

// Attach parsed context to request so @CurrentContext() can read it
declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthenticatedContext;
    sessionId?: string;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtStrategy,
    private readonly apiKey: ApiKeyStrategy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = req.headers['authorization'];
    const apikeyHeader = req.headers['apikey'] as string | undefined;

    let ctx: AuthenticatedContext | undefined;

    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice(7);
      const result = await this.jwt.authenticate(token);
      req.sessionId = result.sessionId;
      ctx = result;
    } else if (apikeyHeader) {
      const clientIp = req.ip ?? '';
      ctx = await this.apiKey.authenticate(apikeyHeader, clientIp);
    } else {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'AUTH_REQUIRED', 401);
    }

    req.authContext = ctx;
    return true;
  }
}

@Injectable()
export class UserGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = req.authContext;
    if (!ctx || ctx.ownerType !== 'USER') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    return true;
  }
}

@Injectable()
export class OperatorGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = req.authContext;
    if (!ctx || (ctx.ownerType !== 'PLATFORM_ADMIN' && ctx.ownerType !== 'SYSTEM')) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    return true;
  }
}

@Injectable()
export class TenantAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = req.authContext;
    if (!ctx || ctx.ownerType !== 'TENANT_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = req.authContext;
    if (!ctx || ctx.ownerType !== 'PLATFORM_ADMIN') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    return true;
  }
}

@Injectable()
export class SystemGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = req.authContext;
    // Deny USER ownerType even if they somehow hold system:* scopes
    if (!ctx || ctx.ownerType === 'USER' || ctx.ownerType !== 'SYSTEM') {
      throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
    }
    return true;
  }
}

export function RequireAuth() {
  return applyDecorators(UseGuards(AuthGuard));
}

export function RequireUser() {
  return applyDecorators(UseGuards(AuthGuard, UserGuard));
}

export function RequireOperator() {
  return applyDecorators(UseGuards(AuthGuard, OperatorGuard));
}

export function RequireTenantAdmin() {
  return applyDecorators(UseGuards(AuthGuard, TenantAdminGuard));
}

export function RequirePlatformAdmin() {
  return applyDecorators(UseGuards(AuthGuard, PlatformAdminGuard));
}

export function RequireSystem() {
  return applyDecorators(UseGuards(AuthGuard, SystemGuard));
}
