import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppError } from './app-error';
import { ErrorCode } from './error-codes';
import { requestIdStorage } from '../logging/request-id.context';
import { isResStaticRequest } from '../http/res-static-compat';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<unknown>();
    const request = ctx.getRequest<{ url?: string; originalUrl?: string }>();
    const requestId = requestIdStorage.getStore() ?? '';
    const isProd = process.env['NODE_ENV'] === 'production';
    const resStatic = isResStaticRequest(request);

    if (exception instanceof AppError) {
      sendJsonResponse(reply, exception.httpStatus, errorPayload({
        code: exception.code,
        message: exception.message,
        reasonKey: exception.reasonKey,
        details: exception.details,
        requestId,
        resStatic,
      }));
    } else if (exception instanceof ZodError) {
      sendJsonResponse(reply, 422, errorPayload({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        reasonKey: 'validation_failed',
        details: { issues: exception.issues },
        requestId,
        resStatic,
      }));
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const mapped = mapHttpException(status);
      sendJsonResponse(reply, status, errorPayload({
        code: mapped.code,
        message: mapped.message ?? exception.message,
        reasonKey: mapped.reasonKey,
        details: httpExceptionDetails(status, exception),
        requestId,
        resStatic,
      }));
    } else {
      const err = exception as Error;
      sendJsonResponse(reply, HttpStatus.INTERNAL_SERVER_ERROR, errorPayload({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        reasonKey: 'internal_error',
        details: isProd ? undefined : { stack: err?.stack },
        requestId,
        resStatic,
      }));
    }
  }
}

type ErrorEnvelope = {
  code: ErrorCode;
  msg: string;
  data: { reasonKey: string; details?: Record<string, unknown> } | null;
  requestId?: string;
};

type JsonResponseLike = {
  status?: (statusCode: number) => unknown;
  code?: (statusCode: number) => unknown;
  send?: (payload: unknown) => unknown;
  raw?: RawResponseLike;
  sent?: boolean;
  statusCode?: number;
  headersSent?: boolean;
  writableEnded?: boolean;
};

type RawResponseLike = {
  statusCode?: number;
  headersSent?: boolean;
  writableEnded?: boolean;
  setHeader?: (name: string, value: string) => unknown;
  end?: (payload?: string) => unknown;
};

function errorPayload(input: {
  code: ErrorCode;
  message: string;
  reasonKey: string;
  details?: Record<string, unknown>;
  requestId: string;
  resStatic: boolean;
}): ErrorEnvelope {
  return {
    code: input.code,
    msg: input.message,
    data: input.resStatic ? null : errorData(input.reasonKey, input.details),
    ...(input.resStatic ? {} : { requestId: input.requestId }),
  };
}

function sendJsonResponse(reply: unknown, status: number, body: ErrorEnvelope): void {
  const response = reply as JsonResponseLike | undefined;
  if (!response || isResponseClosed(response)) {
    return;
  }

  if (typeof response.status === 'function' && typeof response.send === 'function') {
    response.status(status);
    response.send(body);
    return;
  }

  if (typeof response.code === 'function' && typeof response.send === 'function') {
    response.code(status);
    response.send(body);
    return;
  }

  if (typeof response.send === 'function') {
    response.statusCode = status;
    response.send(body);
    return;
  }

  const raw = toRawResponse(response);
  if (isRawResponseClosed(raw) || typeof raw.end !== 'function') {
    return;
  }
  raw.statusCode = status;
  if (typeof raw.setHeader === 'function' && !raw.headersSent) {
    raw.setHeader('content-type', 'application/json; charset=utf-8');
  }
  raw.end(JSON.stringify(body));
}

function isResponseClosed(response: JsonResponseLike): boolean {
  return Boolean(response.sent || response.headersSent || response.writableEnded || isRawResponseClosed(response.raw));
}

function toRawResponse(response: JsonResponseLike): RawResponseLike {
  return (response.raw ?? response) as RawResponseLike;
}

function isRawResponseClosed(response: RawResponseLike | undefined): boolean {
  return Boolean(response?.headersSent || response?.writableEnded);
}

function mapHttpException(status: number): { code: ErrorCode; reasonKey: string; message?: string } {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return { code: ErrorCode.AUTH_REQUIRED, reasonKey: 'auth_required' };
    case HttpStatus.FORBIDDEN:
      return { code: ErrorCode.PERMISSION_DENIED, reasonKey: 'permission_denied' };
    case HttpStatus.NOT_FOUND:
      return { code: ErrorCode.NOT_FOUND, reasonKey: 'not_found', message: 'Not found' };
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return { code: ErrorCode.VALIDATION_ERROR, reasonKey: 'invalid_request' };
    default:
      if (status >= 400 && status < 500) {
        return { code: ErrorCode.VALIDATION_ERROR, reasonKey: 'invalid_request' };
      }
      return { code: ErrorCode.INTERNAL_ERROR, reasonKey: 'http_exception' };
  }
}

function httpExceptionDetails(status: number, exception: HttpException): Record<string, unknown> | undefined {
  if (status === HttpStatus.NOT_FOUND) {
    return undefined;
  }
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
    return response as Record<string, unknown>;
  }
  return undefined;
}

function errorData(reasonKey: string, details?: Record<string, unknown>): { reasonKey: string; details?: Record<string, unknown> } {
  return details ? { reasonKey, details } : { reasonKey };
}
