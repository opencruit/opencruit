export interface SourceMeta {
  id: string;
  label: string;
  kind: 'batch' | 'workflow';
}

export const KNOWN_SOURCES: SourceMeta[] = [
  { id: 'hh', label: 'HeadHunter', kind: 'workflow' },
  { id: 'remoteok', label: 'RemoteOK', kind: 'batch' },
  { id: 'weworkremotely', label: 'WeWorkRemotely', kind: 'batch' },
  { id: 'remotive', label: 'Remotive', kind: 'batch' },
  { id: 'arbeitnow', label: 'Arbeitnow', kind: 'batch' },
  { id: 'jobicy', label: 'Jobicy', kind: 'batch' },
  { id: 'himalayas', label: 'Himalayas', kind: 'batch' },
  { id: 'adzuna', label: 'Adzuna', kind: 'batch' },
  { id: 'jooble', label: 'Jooble', kind: 'batch' },
  { id: 'greenhouse', label: 'Greenhouse', kind: 'batch' },
  { id: 'lever', label: 'Lever', kind: 'batch' },
  { id: 'smartrecruiters', label: 'SmartRecruiters', kind: 'batch' },
];

const sourceMap = new Map(KNOWN_SOURCES.map((s) => [s.id, s]));

export function getSourceLabel(sourceId: string): string {
  return sourceMap.get(sourceId)?.label ?? sourceId;
}

export function getSourceMeta(sourceId: string): SourceMeta | undefined {
  return sourceMap.get(sourceId);
}
