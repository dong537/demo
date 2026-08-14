export type DedicatedLineMigrationSummary = {
  id: string;
  lineId: string;
  type: 'NODE_ONLY' | 'EXIT_ONLY' | 'FULL';
  phase: 'PREPARE' | 'CANARY_ROUTE' | 'VERIFY' | 'CUTOVER_ROUTE' | 'COMMIT' | 'CLEANUP' | 'ROLLBACK';
  status: 'ACTIVE' | 'NEEDS_OPERATOR' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  sourceNodeIds: string[];
  targetNodeIds: string[];
  sourceExitId: string;
  targetExitId: string | null;
};
