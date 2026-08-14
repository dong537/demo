// Minimal flag parser for `--key value` and `--flag` (boolean) styles.
// Works with pnpm's `--` separator since process.argv already strips it.
export interface ParsedArgs {
  values: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
    } else {
      values[key] = next;
      i++;
    }
  }
  return { values, flags };
}

export function getString(args: ParsedArgs, key: string): string | undefined {
  return args.values[key];
}

export function requireString(args: ParsedArgs, key: string): string {
  const v = args.values[key];
  if (v === undefined || v === '') {
    console.error(`Missing required argument: --${key}`);
    process.exit(2);
  }
  return v;
}

export function getNumber(args: ParsedArgs, key: string, fallback: number): number {
  const v = args.values[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`Invalid number for --${key}: ${v}`);
    process.exit(2);
  }
  return n;
}
