import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReleaseManifest,
  validateGitSha,
  validateImageDigest,
} from './release-metadata-lib.mjs';

test('validates immutable release identifiers', () => {
  assert.equal(validateGitSha('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(validateImageDigest(`sha256:${'b'.repeat(64)}`), `sha256:${'b'.repeat(64)}`);
  assert.throws(() => validateGitSha('main'), /git sha/i);
  assert.throws(() => validateImageDigest('latest'), /image digest/i);
});

test('creates a deterministic service-to-image release manifest', () => {
  const manifest = createReleaseManifest({
    gitSha: 'a'.repeat(40),
    createdAt: '2026-08-14T00:00:00.000Z',
    images: {
      api: `sha256:${'1'.repeat(64)}`,
      web: `sha256:${'2'.repeat(64)}`,
      worker: `sha256:${'3'.repeat(64)}`,
    },
  });

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    gitSha: 'a'.repeat(40),
    createdAt: '2026-08-14T00:00:00.000Z',
    images: {
      api: `sha256:${'1'.repeat(64)}`,
      web: `sha256:${'2'.repeat(64)}`,
      worker: `sha256:${'3'.repeat(64)}`,
    },
  });
});
