import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export interface AdminReasonInput {
  reason?: string;
}

export function optionalAdminReason(input: AdminReasonInput): string | undefined {
  const reason = input.reason?.trim();
  return reason || undefined;
}

export function requiredAdminReason(input: AdminReasonInput): string {
  const reason = optionalAdminReason(input);
  if (!reason) throw new AppError(ErrorCode.VALIDATION_ERROR, 'reason_required', 400);
  return reason;
}
