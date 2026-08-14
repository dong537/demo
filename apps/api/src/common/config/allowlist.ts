export function parseAllowlist(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function allows(value: string | undefined, allowlistValue: string): boolean {
  const allowlist = parseAllowlist(allowlistValue);
  return allowlist.size > 0 && value !== undefined && allowlist.has(value);
}

export function allowsAny(
  candidates: Array<{ value: string | undefined; allowlist: string }>,
): boolean {
  return candidates.some((candidate) => allows(candidate.value, candidate.allowlist));
}
