import type { Parser } from './types.js';

/**
 * Typed helper for parser definitions.
 * Keeps parser declarations consistent without runtime overhead.
 */
export function defineParser<T extends Parser>(parser: T): T {
  return parser;
}
