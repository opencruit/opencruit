import { remoteOKParser } from '@opencruit/parser-remoteok';
import { defineSource } from '../define-source.js';

export const remoteOkSource = defineSource({
  id: remoteOKParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  parser: remoteOKParser,
});
