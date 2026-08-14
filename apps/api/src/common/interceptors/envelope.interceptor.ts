import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { requestIdStorage } from '../logging/request-id.context';
import { isResStaticRequest } from '../http/res-static-compat';
import { isLegacyApiV1Request } from '../http/legacy-api-v1';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const request = ctx.switchToHttp().getRequest<{ url?: string; originalUrl?: string }>();
        if (isLegacyApiV1Request(request)) {
          return data;
        }
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
