import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildPgDumpArgs,
  parseDatabaseUrl,
  postgresEnvironment,
} from './postgres-maintenance-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, readOption('--output') || process.env['BACKUP_OUTPUT'] || defaultOutput());
const overwrite = process.argv.includes('--overwrite');
if (existsSync(output) && !overwrite) throw new Error(`backup already exists: ${output}`);
if (existsSync(`${output}.json`) && !overwrite) throw new Error(`backup metadata already exists: ${output}.json`);

const connection = parseDatabaseUrl(requireEnvironment('DATABASE_URL'));
mkdirSync(dirname(output), { recursive: true });
if (overwrite) {
  rmSync(output, { force: true });
  rmSync(`${output}.json`, { force: true });
}

run(process.env['PG_DUMP_BIN'] || 'pg_dump', buildPgDumpArgs(connection, output), connection);
run(process.env['PG_RESTORE_BIN'] || 'pg_restore', ['--list', output], connection, true);

const metadata = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  database: connection.database,
  bytes: statSync(output).size,
  sha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
};
writeFileSync(`${output}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
console.log(`database backup verified: ${output}`);

function run(command, args, database, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: postgresEnvironment(database),
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function defaultOutput() {
  return `backups/postgres-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
