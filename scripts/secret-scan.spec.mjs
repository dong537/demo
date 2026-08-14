import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const scanner = resolve(root, 'scripts', 'secret-scan.mjs');

function withFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'ipeasy-secret-scan-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('rejects a high-entropy assigned secret without printing its value', () => {
  withFixture((directory) => {
    const secret = ['sk', 'live', 'A7d9Q2m4N8v6X3z5P1r0T9w8Y7u6'].join('_');
    writeFileSync(join(directory, 'unsafe.env'), `UPSTREAM_API_KEY=${secret}\n`);

    const result = spawnSync(process.execPath, [scanner, '--path', directory], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /generic_secret_assignment/);
    assert.match(result.stderr, /unsafe\.env/);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  });
});

test('accepts placeholders and ordinary source text', () => {
  withFixture((directory) => {
    writeFileSync(join(directory, 'safe.env'), 'UPSTREAM_API_KEY=replace-me-in-secret-store\n');
    writeFileSync(join(directory, 'readme.md'), [
      'Provider credentials come from the secret store.',
      "password: 'Choose a strong password with at least 12 characters.'",
      '',
    ].join('\n'));

    const output = execFileSync(process.execPath, [scanner, '--path', directory], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.match(output, /secret scan passed/i);
  });
});

test('rejects private key material', () => {
  withFixture((directory) => {
    const begin = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const end = ['-----END ', 'PRIVATE KEY-----'].join('');
    writeFileSync(join(directory, 'private.pem'), [
      begin,
      'synthetic-test-material',
      end,
      '',
    ].join('\n'));

    const result = spawnSync(process.execPath, [scanner, '--path', directory], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /private_key_material/);
    assert.match(result.stderr, /private\.pem/);
  });
});
