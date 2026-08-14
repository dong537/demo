import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(rootDir, 'openapi.json');
const output = resolve(rootDir, 'src/generated/api.ts');

await mkdir(dirname(output), { recursive: true });
const schema = JSON.parse(await readFile(input, 'utf8'));
const ast = await openapiTS(schema);
await writeFile(output, astToString(ast), 'utf8');
console.log(`Generated ${output}`);
