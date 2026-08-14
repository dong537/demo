import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthenticatedContext } from './auth-context';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedContext => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.authContext) {
      throw new AppError(ErrorCode.AUTH_REQUIRED, 'AUTH_REQUIRED', 401);
    }
    return req.authContext;
  },
);
