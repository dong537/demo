import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRestoreAuthorized,
  buildPgDumpArgs,
  buildPgRestoreArgs,
  parseDatabaseUrl,
} from './postgres-maintenance-lib.mjs';

test('keeps database passwords out of PostgreSQL command arguments', () => {
  const connection = parseDatabaseUrl('postgresql://backup_user:private-value@db.example.com:5433/platform');
  const dumpArgs = buildPgDumpArgs(connection, 'platform.dump');
  const restoreArgs = buildPgRestoreArgs(connection, 'platform.dump');

  assert.equal(connection.password, 'private-value');
  assert.equal(connection.database, 'platform');
  assert.doesNotMatch(dumpArgs.join(' '), /private-value/);
  assert.doesNotMatch(restoreArgs.join(' '), /private-value/);
  assert.deepEqual(dumpArgs.slice(-2), ['--file', 'platform.dump']);
  assert.ok(restoreArgs.includes('--exit-on-error'));
});

test('rejects destructive restore without exact database confirmation', () => {
  assert.throws(() => assertRestoreAuthorized({
    database: 'platform',
    confirmDatabase: '',
    allowProduction: false,
    nodeEnv: 'production',
  }), /confirmation/i);
  assert.throws(() => assertRestoreAuthorized({
    database: 'platform',
    confirmDatabase: 'platform',
    allowProduction: false,
    nodeEnv: 'production',
  }), /production restore/i);
  assert.doesNotThrow(() => assertRestoreAuthorized({
    database: 'platform_recovery',
    confirmDatabase: 'platform_recovery',
    allowProduction: false,
    nodeEnv: 'test',
  }));
  assert.doesNotThrow(() => assertRestoreAuthorized({
    database: 'platform',
    confirmDatabase: 'platform',
    allowProduction: true,
    nodeEnv: 'production',
  }));
});

test('rejects non-PostgreSQL database URLs', () => {
  assert.throws(() => parseDatabaseUrl('mysql://user:pass@db.example.com/platform'), /postgresql/i);
});
