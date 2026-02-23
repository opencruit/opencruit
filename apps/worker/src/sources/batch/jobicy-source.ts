import { jobicyParser } from '@opencruit/parser-jobicy';
import { defineSource } from '../define-source.js';

export const jobicySource = defineSource({
  id: jobicyParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  parser: jobicyParser,
});
