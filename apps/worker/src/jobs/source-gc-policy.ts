export interface SourceGcPolicy {
  archiveAfterDays: number;
  archivedRecheckDays: number;
  deleteAfterDays: number;
}

const DEFAULT_POLICY: SourceGcPolicy = {
  archiveAfterDays: 7,
  archivedRecheckDays: 30,
  deleteAfterDays: 30,
};

const SOURCE_POLICIES: Record<string, SourceGcPolicy> = {
  hh: {
    archiveAfterDays: 4,
    archivedRecheckDays: 30,
    deleteAfterDays: 30,
  },
  remoteok: {
    archiveAfterDays: 7,
    archivedRecheckDays: 30,
    deleteAfterDays: 30,
  },
  weworkremotely: {
    archiveAfterDays: 7,
    archivedRecheckDays: 30,
    deleteAfterDays: 30,
  },
};

export function getSourceGcPolicy(sourceId: string): SourceGcPolicy {
  return SOURCE_POLICIES[sourceId] ?? DEFAULT_POLICY;
}

export function listKnownGcPolicySources(): string[] {
  return Object.keys(SOURCE_POLICIES);
}
