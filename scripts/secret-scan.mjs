import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const explicitPath = parsePath(process.argv.slice(2));
const files = explicitPath ? walk(explicitPath) : repositoryFiles();
const findings = [];

const textExtensions = new Set([
  '', '.cjs', '.conf', '.env', '.go', '.graphql', '.html', '.ini', '.js', '.json', '.jsx',
  '.md', '.mjs', '.pem', '.prisma', '.properties', '.ps1', '.sh', '.sql', '.toml', '.ts',
  '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const ignoredBasenames = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const ignoredRelativePaths = new Set(['scripts/secret-scan.spec.mjs']);
const placeholderMarkers = [
  'changeme', 'dummy', 'example', 'fake', 'placeholder', 'replace', 'sample', 'synthetic', 'test',
  'your-', 'your_', '<', '${', 'process.env', 'secret-store',
];

for (const file of files) {
  const relativePath = normalize(relative(root, file));
  if (ignoredRelativePaths.has(relativePath)) continue;
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  if (ignoredBasenames.has(relativePath.split('/').at(-1))) continue;

  let content;
  try {
    const buffer = readFileSync(file);
    if (buffer.includes(0)) continue;
    content = buffer.toString('utf8');
  } catch (error) {
    findings.push({
      rule: 'scan_read_error',
      file: relativePath || file,
      detail: error instanceof Error ? error.code : 'unknown',
    });
    continue;
  }

  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    findings.push({ rule: 'private_key_material', file: relativePath || file });
  }

  for (const line of content.split(/\r?\n/)) {
    const quoted = line.match(/(?:^|[{,\s])["']?[A-Z0-9_]*(?:API_?KEY|APIKEY|APP_SECRET|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|TOKEN|JWT_SECRET|ENCRYPTION_KEY)[A-Z0-9_]*["']?\s*(?:=|:)\s*(["'])(.*?)\1/i);
    const envLiteral = line.match(/^\s*[A-Z0-9_]*(?:API_?KEY|APIKEY|APP_SECRET|CLIENT_SECRET|PASSWORD|PRIVATE_KEY|TOKEN|JWT_SECRET|ENCRYPTION_KEY)[A-Z0-9_]*\s*=\s*([^\s#]+)\s*(?:#.*)?$/i);
    const value = (quoted?.[2] ?? envLiteral?.[1] ?? '').trim();
    if (!value) continue;
    if (isSecretCandidate(value)) {
      findings.push({ rule: 'generic_secret_assignment', file: relativePath || file });
      break;
    }
  }
}

if (findings.length > 0) {
  console.error(`secret scan failed: ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.error(`${finding.rule}: ${finding.file}${finding.detail ? ` (${finding.detail})` : ''}`);
  }
  process.exit(1);
}

console.log(`secret scan passed: ${files.length} file(s) inspected`);

function parsePath(args) {
  const index = args.indexOf('--path');
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error('--path requires a directory or file');
  return resolve(value);
}

function repositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => resolve(root, path));
}

function walk(target) {
  const metadata = statSync(target);
  if (metadata.isFile()) return [target];
  if (!metadata.isDirectory()) return [];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(target, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function isSecretCandidate(value) {
  if (value.length < 20) return false;
  if (/\s/.test(value)) return false;
  const lower = value.toLowerCase();
  if (placeholderMarkers.some((marker) => lower.includes(marker))) return false;
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return false;
  return new Set(value).size >= 10;
}

function normalize(path) {
  return path.replace(/\\/g, '/');
}
