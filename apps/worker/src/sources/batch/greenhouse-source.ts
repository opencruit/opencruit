import { greenhouseParser } from '@opencruit/parser-greenhouse';
import { defineSource } from '../define-source.js';
import { GREENHOUSE_BOARDS } from '../targets/greenhouse.js';

export const greenhouseSource = defineSource({
  id: greenhouseParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  enabledWhen: () =>
    GREENHOUSE_BOARDS.length > 0
      ? { enabled: true }
      : {
          enabled: false,
          reason: 'No Greenhouse board tokens configured in worker targets',
        },
  resolveParseConfig: () => ({
    boards: [...GREENHOUSE_BOARDS],
  }),
  parser: greenhouseParser,
});
