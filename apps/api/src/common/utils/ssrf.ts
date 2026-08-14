import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'unsafe_upstream_url', 400, `Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'unsafe_upstream_url', 400, 'Only https URLs are allowed');
  }

  const hostname = parsed.hostname;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'unsafe_upstream_url', 400, 'Private/loopback addresses are not allowed');
    }
  }
}
