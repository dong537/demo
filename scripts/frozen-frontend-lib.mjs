import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const DEPLOYMENT_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const IMAGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function extractStaticReferences(content, currentUrl, sourceOrigin) {
  const references = new Set();
  const patterns = [
    /(?:src|href)=["']([^"']+)["']/g,
    /["'`]((?:\.\.?\/|\/)?assets\/[a-z0-9_./@+~-]+\.(?:css|gif|ico|jpe?g|js|json|png|svg|ttf|woff2?))["'`]/gi,
    /(?:from\s*|import\(\s*)["']([^"']+)["']/g,
    /["'`](\/[^"'`()\s]+\.(?:css|gif|ico|jpe?g|js|json|png|svg|ttf|woff2?))(?:[?#][^"'`()\s]*)?["'`]/gi,
    /url\(["']?([^"')]+)["']?\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      let candidate = match[1]?.trim();
      if (
        !candidate ||
        candidate.startsWith('data:') ||
        candidate.startsWith('#') ||
        candidate.includes('${')
      ) continue;
      if (candidate.startsWith('assets/')) candidate = `/${candidate}`;
      const url = new URL(candidate, currentUrl);
      if (url.origin !== sourceOrigin) continue;
      url.search = '';
      url.hash = '';
      if (url.pathname === '/' || url.pathname.endsWith('.html')) continue;
      if (!/\.(?:css|gif|ico|jpe?g|js|json|png|svg|ttf|woff2?)$/i.test(url.pathname)) continue;
      references.add(url.href);
    }
  }
  return [...references].sort();
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createFrozenFrontendManifest({ source, deployment, files, capturedAt }) {
  if (!DEPLOYMENT_ID_PATTERN.test(deployment?.id ?? '')) {
    throw new Error('deployment id must be a Railway UUID');
  }
  if (!IMAGE_DIGEST_PATTERN.test(deployment?.imageDigest ?? '')) {
    throw new Error('deployment image digest must use sha256:<64 hexadecimal characters>');
  }
  const timestamp = new Date(capturedAt);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== capturedAt) {
    throw new Error('capturedAt must be an ISO-8601 UTC timestamp');
  }

  const sourceUrl = new URL(source);
  sourceUrl.pathname = sourceUrl.pathname.replace(/\/+$/, '') || '/';
  const normalizedFiles = [...files]
    .map((file) => ({ path: normalizePath(file.path), bytes: file.bytes, sha256: file.sha256.toLowerCase() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!normalizedFiles.some((file) => file.path === 'index.html')) {
    throw new Error('frozen frontend manifest must include index.html');
  }
  for (const file of normalizedFiles) {
    if (!isSafeRelativePath(file.path)) throw new Error(`unsafe frozen frontend path: ${file.path}`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error(`invalid byte length: ${file.path}`);
    if (!SHA256_PATTERN.test(file.sha256)) throw new Error(`invalid sha256: ${file.path}`);
  }

  return {
    schemaVersion: 1,
    source: sourceUrl.href,
    deployment: {
      id: deployment.id.toLowerCase(),
      imageDigest: deployment.imageDigest.toLowerCase(),
      createdAt: deployment.createdAt,
    },
    capturedAt,
    files: normalizedFiles,
  };
}

export function verifyFrozenFrontend(directory, manifest) {
  const root = resolve(directory);
  const failures = [];
  const expectedPaths = new Set((manifest.files ?? []).map((file) => normalizePath(file.path)));
  const actualPaths = listFiles(root);
  for (const actualPath of actualPaths) {
    if (!expectedPaths.has(actualPath)) failures.push({ path: actualPath, reason: 'untracked_file' });
  }
  for (const expected of manifest.files ?? []) {
    const target = resolve(root, expected.path);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      failures.push({ path: expected.path, reason: 'unsafe_path' });
      continue;
    }
    try {
      const content = readFileSync(target);
      if (content.length !== expected.bytes) {
        failures.push({ path: expected.path, reason: 'size_mismatch' });
      } else if (sha256(content) !== expected.sha256) {
        failures.push({ path: expected.path, reason: 'digest_mismatch' });
      } else if (/\.(?:css|html|js|json)$/i.test(expected.path)) {
        const source = new URL(manifest.source);
        const currentUrl = new URL(expected.path === 'index.html' ? '/' : `/${expected.path}`, source).href;
        for (const reference of extractStaticReferences(content.toString('utf8'), currentUrl, source.origin)) {
          const referencedPath = relativeStaticPath(source.origin, reference);
          if (!expectedPaths.has(referencedPath)) {
            failures.push({ path: expected.path, reason: 'untracked_reference', reference: referencedPath });
          }
        }
      }
    } catch (error) {
      failures.push({ path: expected.path, reason: error?.code === 'ENOENT' ? 'missing' : 'read_error' });
    }
  }
  return failures;
}

export function relativeStaticPath(sourceOrigin, absoluteUrl) {
  const url = new URL(absoluteUrl);
  if (url.origin !== sourceOrigin) throw new Error('static asset must use the frozen frontend origin');
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (!isSafeRelativePath(path)) throw new Error(`unsafe static asset path: ${path}`);
  return path;
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isSafeRelativePath(path) {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
}

function listFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) return listFiles(root, path);
      return entry.isFile() ? [normalizePath(path.slice(root.length + 1))] : [];
    })
    .sort();
}
