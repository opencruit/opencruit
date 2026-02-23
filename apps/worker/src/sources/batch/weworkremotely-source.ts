import { weWorkRemotelyParser } from '@opencruit/parser-weworkremotely';
import { defineSource } from '../define-source.js';

export const weworkremotelySource = defineSource({
  id: weWorkRemotelyParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  parser: weWorkRemotelyParser,
});
