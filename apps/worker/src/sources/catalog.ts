import type { BatchSourceDefinition, SourceDefinition, WorkflowSourceDefinition } from './types.js';
import { remoteOkSource } from './batch/remoteok-source.js';
import { weworkremotelySource } from './batch/weworkremotely-source.js';
import { remotiveSource } from './batch/remotive-source.js';
import { arbeitnowSource } from './batch/arbeitnow-source.js';
import { jobicySource } from './batch/jobicy-source.js';
import { himalayasSource } from './batch/himalayas-source.js';
import { adzunaSource } from './batch/adzuna-source.js';
import { joobleSource } from './batch/jooble-source.js';
import { greenhouseSource } from './batch/greenhouse-source.js';
import { leverSource } from './batch/lever-source.js';
import { smartrecruitersSource } from './batch/smartrecruiters-source.js';
import { hhSource } from './workflow/hh-source.js';

const allSources: SourceDefinition[] = [
  remoteOkSource,
  weworkremotelySource,
  remotiveSource,
  arbeitnowSource,
  jobicySource,
  himalayasSource,
  adzunaSource,
  joobleSource,
  greenhouseSource,
  leverSource,
  smartrecruitersSource,
  hhSource,
];

function buildSourceMap(sources: SourceDefinition[]): Map<string, SourceDefinition> {
  const sourceMap = new Map<string, SourceDefinition>();

  for (const source of sources) {
    if (sourceMap.has(source.id)) {
      throw new Error(`Duplicate source id: ${source.id}`);
    }

    sourceMap.set(source.id, source);
  }

  return sourceMap;
}

const sourceMap = buildSourceMap(allSources);

export function getAllSources(): SourceDefinition[] {
  return [...allSources];
}

export function getBatchSources(): BatchSourceDefinition[] {
  return allSources.filter((source): source is BatchSourceDefinition => source.kind === 'batch');
}

export function getWorkflowSources(): WorkflowSourceDefinition[] {
  return allSources.filter((source): source is WorkflowSourceDefinition => source.kind === 'workflow');
}

export function getSourceById(sourceId: string): SourceDefinition {
  const source = sourceMap.get(sourceId);
  if (!source) {
    throw new Error(`Unknown source id: ${sourceId}`);
  }

  return source;
}
