import { describe, expect, it } from 'vitest';
import { assertMigrationTransition } from './domain';
describe('Commit migration contract', () => { it('requires COMMIT phase before changing current resources', () => { expect(() => assertMigrationTransition({ type: 'FULL', phase: 'VERIFY', status: 'ACTIVE' }, { type: 'COMMIT' })).toThrowError(expect.objectContaining({ reasonKey: 'migration_phase_invalid' })); }); });
