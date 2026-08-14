import { ErrorCode } from './error-codes';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly reasonKey: string,
    public readonly httpStatus: number,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? reasonKey);
  }
}
