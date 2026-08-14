import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertRestoreAuthorized,
  buildPgRestoreArgs,
  parseDatabaseUrl,
  postgresEnvironment,
} from './postgres-maintenance-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const input = resolve(root, requireOption('--input'));
if (!existsSync(input)) throw new Error(`backup does not exist: ${input}`);

const connection = parseDatabaseUrl(requireEnvironment('DATABASE_URL'));
assertRestoreAuthorized({
  database: connection.database,
  confirmDatabase: requireOption('--confirm-database'),
  allowProduction: process.argv.includes('--allow-production'),
  nodeEnv: process.env['NODE_ENV'] || 'development',
});
verifyChecksum(input);

run(process.env['PG_RESTORE_BIN'] || 'pg_restore', buildPgRestoreArgs(connection, input), connection);
console.log(`database restore completed: ${connection.database}`);

function verifyChecksum(path) {
  const metadataPath = `${path}.json`;
  if (!existsSync(metadataPath)) throw new Error(`backup metadata does not exist: ${metadataPath}`);
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (metadata.sha256 !== actual) throw new Error('backup checksum mismatch');
}

function run(command, args, database) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: postgresEnvironment(database),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function requireOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
