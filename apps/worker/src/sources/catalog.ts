import type { BatchSourceDefinition, SourceDefinition, WorkflowSourceDefinition } from './types.js';
import { remoteOkSource } from './batch/remoteok-source.js';
import { weworkremotelySource } from './batch/weworkremotely-source.js';
import { hhSource } from './workflow/hh-source.js';

const allSources: SourceDefinition[] = [remoteOkSource, weworkremotelySource, hhSource];

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
