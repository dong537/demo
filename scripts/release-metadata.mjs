import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createReleaseManifest } from './release-metadata-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.env['RELEASE_MANIFEST_OUTPUT'] || 'artifacts/release-manifest.json');
const overwrite = process.env['RELEASE_MANIFEST_OVERWRITE'] === 'true';
if (existsSync(output) && !overwrite) {
  throw new Error(`release manifest already exists: ${output}`);
}
if (overwrite) rmSync(output, { force: true });

const gitSha = process.env['RELEASE_GIT_SHA'] || execFileSync(
  'git',
  ['rev-parse', 'HEAD'],
  { cwd: root, encoding: 'utf8' },
).trim();
const manifest = createReleaseManifest({
  gitSha,
  createdAt: process.env['RELEASE_CREATED_AT'] || new Date().toISOString(),
  images: {
    api: process.env['RELEASE_API_IMAGE_DIGEST'],
    web: process.env['RELEASE_WEB_IMAGE_DIGEST'],
    worker: process.env['RELEASE_WORKER_IMAGE_DIGEST'],
  },
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(`release manifest written: ${output}`);
