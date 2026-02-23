import { himalayasParser } from '@opencruit/parser-himalayas';
import { defineSource } from '../define-source.js';

export const himalayasSource = defineSource({
  id: himalayasParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  parser: himalayasParser,
});
