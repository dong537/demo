import { HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from './app-error';
import { ErrorCode } from './error-codes';
import { AppExceptionFilter } from './exception-filter';

describe('AppExceptionFilter', () => {
  it('uses code().send() when the response does not expose status()', () => {
    const code = vi.fn(() => undefined);
    const send = vi.fn(() => undefined);
    const response = { code, send };

    new AppExceptionFilter().catch(
      new AppError(ErrorCode.UPSTREAM_ERROR, 'inventory_stale', 422, 'inventory_stale'),
      httpHost(response, { url: '/api/providers/health-check' }),
    );

    expect(code).toHaveBeenCalledWith(422);
    expect(send).toHaveBeenCalledWith({
      code: ErrorCode.UPSTREAM_ERROR,
      msg: 'inventory_stale',
      data: { reasonKey: 'inventory_stale' },
      requestId: '',
    });
  });

  it('falls back to the raw node response when no framework helpers exist', () => {
    const setHeader = vi.fn(() => undefined);
    let endedBody = '';
    const end = vi.fn((payload?: string) => {
      endedBody = payload ?? '';
    });
    const response = { statusCode: 200, setHeader, end };

    new AppExceptionFilter().catch(
      new AppError(
        ErrorCode.INTERNAL_ERROR,
        'internal_error',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'boom',
        { cause: 'db_down' },
      ),
      httpHost(response, { url: '/api/sites/current' }),
    );

    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
    expect(end).toHaveBeenCalledTimes(1);
    expect(JSON.parse(endedBody)).toEqual({
      code: ErrorCode.INTERNAL_ERROR,
      msg: 'boom',
      data: {
        reasonKey: 'internal_error',
        details: { cause: 'db_down' },
      },
      requestId: '',
    });
  });
});

function httpHost(response: unknown, request: { url?: string; originalUrl?: string }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
      getNext: () => undefined,
    }),
    getType: () => 'http',
    getArgByIndex: () => undefined,
    getArgs: () => [],
    switchToRpc: () => ({ getContext: () => undefined, getData: () => undefined }),
    switchToWs: () => ({ getClient: () => undefined, getData: () => undefined, getPattern: () => undefined }),
  } as unknown as ArgumentsHost;
}
