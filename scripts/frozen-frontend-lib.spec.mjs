import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createFrozenFrontendManifest,
  extractStaticReferences,
  sha256,
  verifyFrozenFrontend,
} from './frozen-frontend-lib.mjs';

test('extracts only statically resolvable same-origin references', () => {
  const content = '<script src="/assets/app.js"></script> <a href="/login">login</a> import("./chunk.js"); "assets/lazy.js"; "assets/},"; url(/logo.svg); "https://evil.test/x.js"; `assets/${name}`';
  assert.deepEqual(
    extractStaticReferences(content, 'https://frontend.test/assets/index.js', 'https://frontend.test'),
    [
      'https://frontend.test/assets/app.js',
      'https://frontend.test/assets/chunk.js',
      'https://frontend.test/assets/lazy.js',
      'https://frontend.test/logo.svg',
    ],
  );
});

test('creates and verifies a frozen frontend manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'frozen-frontend-'));
  mkdirSync(join(root, 'assets'));
  const index = Buffer.from('<!doctype html>');
  const app = Buffer.from('console.log("frozen")');
  writeFileSync(join(root, 'index.html'), index);
  writeFileSync(join(root, 'assets/app.js'), app);

  const manifest = createFrozenFrontendManifest({
    source: 'https://frontend.test/',
    deployment: {
      id: '6f71aaa1-d3b7-4dc9-8395-0ac5f513eeb0',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-08-13T13:03:24.764Z',
    },
    capturedAt: '2026-08-14T00:00:00.000Z',
    files: [
      { path: 'assets/app.js', bytes: app.length, sha256: sha256(app) },
      { path: 'index.html', bytes: index.length, sha256: sha256(index) },
    ],
  });

  assert.deepEqual(verifyFrozenFrontend(root, manifest), []);
  writeFileSync(join(root, 'assets/app.js'), 'changed');
  assert.deepEqual(verifyFrozenFrontend(root, manifest), [
    { path: 'assets/app.js', reason: 'size_mismatch' },
  ]);
});

test('rejects untracked files and references', () => {
  const root = mkdtempSync(join(tmpdir(), 'frozen-frontend-'));
  mkdirSync(join(root, 'assets'));
  const index = Buffer.from('<script src="/assets/missing.js"></script>');
  writeFileSync(join(root, 'index.html'), index);
  writeFileSync(join(root, 'assets/extra.js'), 'extra');
  const manifest = createFrozenFrontendManifest({
    source: 'https://frontend.test/',
    deployment: {
      id: '6f71aaa1-d3b7-4dc9-8395-0ac5f513eeb0',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-08-13T13:03:24.764Z',
    },
    capturedAt: '2026-08-14T00:00:00.000Z',
    files: [{ path: 'index.html', bytes: index.length, sha256: sha256(index) }],
  });
  assert.deepEqual(verifyFrozenFrontend(root, manifest), [
    { path: 'assets/extra.js', reason: 'untracked_file' },
    { path: 'index.html', reason: 'untracked_reference', reference: 'assets/missing.js' },
  ]);
});

test('rejects mutable deployment identifiers and unsafe paths', () => {
  const base = {
    source: 'https://frontend.test/',
    deployment: {
      id: '6f71aaa1-d3b7-4dc9-8395-0ac5f513eeb0',
      imageDigest: `sha256:${'a'.repeat(64)}`,
      createdAt: '2026-08-13T13:03:24.764Z',
    },
    capturedAt: '2026-08-14T00:00:00.000Z',
    files: [{ path: 'index.html', bytes: 0, sha256: 'b'.repeat(64) }],
  };
  assert.throws(
    () => createFrozenFrontendManifest({ ...base, deployment: { ...base.deployment, imageDigest: 'latest' } }),
    /image digest/i,
  );
  assert.throws(
    () => createFrozenFrontendManifest({
      ...base,
      files: [...base.files, { ...base.files[0], path: '../asset.js' }],
    }),
    /unsafe/i,
  );
});
