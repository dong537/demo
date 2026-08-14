import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { requestIdStorage } from '../logging/request-id.context';
import { isResStaticRequest } from '../http/res-static-compat';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const request = ctx.switchToHttp().getRequest<{ url?: string; originalUrl?: string }>();
        if (isResStaticRequest(request)) {
          return { code: 0, msg: 'success', data };
        }
        return {
          code: 0,
          msg: 'success',
          data,
          requestId: requestIdStorage.getStore() ?? '',
        };
      }),
    );
  }
}
