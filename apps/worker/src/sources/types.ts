import type { Parser } from '@opencruit/parser-sdk';
import type { Queues } from '../queues.js';

export type SourceKind = 'batch' | 'workflow';
export type SourcePool = 'light' | 'heavy';
export type SourceStage = 'ingest' | 'index' | 'hydrate' | 'refresh' | 'gc';

export interface SourceRuntimePolicy {
  attempts: number;
  backoffMs: number;
  timeoutMs?: number;
  concurrency?: number;
}

interface BaseSourceDefinition {
  id: string;
  kind: SourceKind;
  pool: SourcePool;
  runtime: SourceRuntimePolicy;
  schedule?: string;
}

export interface BatchSourceDefinition extends BaseSourceDefinition {
  kind: 'batch';
  parser: Parser;
}

export interface WorkflowScheduleOptions {
  indexCron: string;
  refreshCron: string;
  refreshBatchSize: number;
  bootstrapIndexNow: boolean;
}

export interface WorkflowSchedulerContext {
  queues: Queues;
  services: Record<string, unknown>;
  options: WorkflowScheduleOptions;
}

export interface WorkflowScheduleResult {
  stats?: Record<string, number | string | boolean>;
}

export interface WorkflowSourceDefinition extends BaseSourceDefinition {
  kind: 'workflow';
  setupScheduler(context: WorkflowSchedulerContext): Promise<WorkflowScheduleResult>;
}

export type SourceDefinition = BatchSourceDefinition | WorkflowSourceDefinition;
