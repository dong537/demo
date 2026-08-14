import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createFrozenFrontendManifest,
  extractStaticReferences,
  relativeStaticPath,
  sha256,
  verifyFrozenFrontend,
} from './frozen-frontend-lib.mjs';

const options = parseArgs(process.argv.slice(2));
if (options.verify) {
  const manifest = JSON.parse(readFileSync(resolve(options.verify, 'manifest.json'), 'utf8'));
  const failures = verifyFrozenFrontend(resolve(options.verify, 'dist'), manifest);
  if (failures.length > 0) {
    console.error(JSON.stringify({ status: 'failed', failures }, null, 2));
    process.exit(1);
  }
  console.log(`frozen frontend verified: ${manifest.files.length} file(s)`);
  process.exit(0);
}

const output = resolve(options.output);
const dist = resolve(output, 'dist');
if (options.overwrite) {
  rmSync(dist, { recursive: true, force: true });
  rmSync(resolve(output, 'manifest.json'), { force: true });
}
mkdirSync(dist, { recursive: true });

const source = new URL(options.source);
const sourceOrigin = source.origin;
const queue = [new URL('/', source).href];
const seen = new Set();
const files = [];

while (queue.length > 0) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`static asset fetch failed (${response.status}): ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  const body = Buffer.from(await response.arrayBuffer());
  const path = url === new URL('/', source).href ? 'index.html' : relativeStaticPath(sourceOrigin, url);
  if (path !== 'index.html' && contentType.includes('text/html')) {
    throw new Error(`static asset unexpectedly returned HTML: ${url}`);
  }
  const target = resolve(dist, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  files.push({ path, bytes: body.length, sha256: sha256(body) });

  if (/html|javascript|css|json/.test(contentType) || /\.(?:css|js|json)$/.test(path)) {
    const text = body.toString('utf8');
    for (const reference of extractStaticReferences(text, url, sourceOrigin)) {
      if (!seen.has(reference)) queue.push(reference);
    }
  }
}

const manifest = createFrozenFrontendManifest({
  source: source.href,
  deployment: {
    id: options.deploymentId,
    imageDigest: options.imageDigest,
    createdAt: options.deploymentCreatedAt,
  },
  capturedAt: new Date().toISOString(),
  files,
});
writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`frozen frontend captured: ${manifest.files.length} file(s) in ${output}`);

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--overwrite') {
      values.overwrite = true;
      continue;
    }
    if (!name.startsWith('--') || !args[index + 1]) throw new Error(`invalid argument: ${name}`);
    values[name.slice(2)] = args[index + 1];
    index += 1;
  }
  if (values.verify) return { verify: values.verify };
  for (const required of ['source', 'output', 'deployment-id', 'image-digest', 'deployment-created-at']) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return {
    source: values.source,
    output: values.output,
    deploymentId: values['deployment-id'],
    imageDigest: values['image-digest'],
    deploymentCreatedAt: values['deployment-created-at'],
    overwrite: values.overwrite === true,
  };
}
