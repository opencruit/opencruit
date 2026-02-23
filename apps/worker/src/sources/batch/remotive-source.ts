import { remotiveParser } from '@opencruit/parser-remotive';
import { defineSource } from '../define-source.js';

export const remotiveSource = defineSource({
  id: remotiveParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  parser: remotiveParser,
});
