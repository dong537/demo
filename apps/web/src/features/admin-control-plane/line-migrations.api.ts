import { apiRequest } from '../../shared/api/client';

export type MigrationType = 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL';

export interface MigrationSummary {
  id: string;
  lineId: string;
  type: MigrationType;
  phase: string;
  status: string;
  sourceLineVersion: number;
  targetLineVersion: number;
  sourceExitId: string;
  targetExitId: string | null;
  sourceNodes: Array<{ id: string; code: string; regionCode: string; reservationStatus: string }>;
  targetNodes: Array<{ id: string; code: string; regionCode: string; reservationStatus: string; projectionId: string | null }>;
  domains: Array<{ hostname: string; port: number; role: string }>;
  smokeObservations: Array<{ stage: string; hostname: string; verified: boolean; observedCountryCode: string | null; latencyMs: number | null; failureType: string | null; observedAt: string; freshUntil: string }>;
  routes: { canary: unknown; cutover: unknown; rollback: unknown };
  allowedActions: string[];
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
  finishedAt: string | null;
}

export interface MigrationCreateBody {
  type: MigrationType;
  targetNodeIds: string[];
  targetExitId: string | null;
  reason: string;
  idempotencyKey: string;
}

export interface ControlNodeOption {
  id: string;
  code: string;
  name: string;
  regionCode: string;
  nodeGroupId: string;
  status: string;
}

export function listLineMigrations(lineId: string) {
  return apiRequest<MigrationSummary[]>(`/api/admin/control-plane/lines/${encodeURIComponent(lineId)}/migrations`);
}

export function createLineMigration(lineId: string, body: MigrationCreateBody) {
  return apiRequest<MigrationSummary>(`/api/admin/control-plane/lines/${encodeURIComponent(lineId)}/migrations`, { method: 'POST', body: JSON.stringify(body) });
}

export function commitLineMigration(lineId: string, migrationId: string) {
  return apiRequest<{ migrationId: string; phase: string; status: string }>(`/api/admin/control-plane/lines/${encodeURIComponent(lineId)}/migrations/${encodeURIComponent(migrationId)}/commit`, { method: 'POST' });
}

export function cancelLineMigration(lineId: string, migrationId: string) {
  return apiRequest<{ migrationId: string; phase: string; status: string }>(`/api/admin/control-plane/lines/${encodeURIComponent(lineId)}/migrations/${encodeURIComponent(migrationId)}/cancel`, { method: 'POST' });
}
