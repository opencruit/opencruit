import { leverParser } from '@opencruit/parser-lever';
import { defineSource } from '../define-source.js';
import { LEVER_SITES } from '../targets/lever.js';

export const leverSource = defineSource({
  id: leverParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  enabledWhen: () =>
    LEVER_SITES.length > 0
      ? { enabled: true }
      : {
          enabled: false,
          reason: 'No Lever sites configured in worker targets',
        },
  resolveParseConfig: () => ({
    sites: [...LEVER_SITES],
  }),
  parser: leverParser,
});
