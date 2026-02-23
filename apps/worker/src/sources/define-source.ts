import type { SourceDefinition } from './types.js';

/**
 * Typed helper for source definitions used by worker orchestration.
 */
export function defineSource<T extends SourceDefinition>(source: T): T {
  return source;
}
