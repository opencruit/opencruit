export interface SourceGcPolicy {
  archiveAfterDays: number;
  archivedRecheckDays: number;
  deleteAfterDays: number;
}

const DEFAULT_POLICY: SourceGcPolicy = {
  archiveAfterDays: 14,
  archivedRecheckDays: 30,
  deleteAfterDays: 90,
};

const SOURCE_POLICIES: Record<string, SourceGcPolicy> = {
  hh: {
    archiveAfterDays: 10,
    archivedRecheckDays: 30,
    deleteAfterDays: 60,
  },
  remoteok: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  weworkremotely: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  remotive: {
    archiveAfterDays: 10,
    archivedRecheckDays: 30,
    deleteAfterDays: 60,
  },
  adzuna: {
    archiveAfterDays: 21,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  jooble: {
    archiveAfterDays: 21,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  arbeitnow: {
    archiveAfterDays: 21,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  jobicy: {
    archiveAfterDays: 30,
    archivedRecheckDays: 45,
    deleteAfterDays: 120,
  },
  himalayas: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  greenhouse: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  lever: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
  smartrecruiters: {
    archiveAfterDays: 14,
    archivedRecheckDays: 30,
    deleteAfterDays: 90,
  },
};

export function getSourceGcPolicy(sourceId: string): SourceGcPolicy {
  return SOURCE_POLICIES[sourceId] ?? DEFAULT_POLICY;
}

export function listKnownGcPolicySources(): string[] {
  return Object.keys(SOURCE_POLICIES);
}
