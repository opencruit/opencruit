import { smartRecruitersParser } from '@opencruit/parser-smartrecruiters';
import { defineSource } from '../define-source.js';
import { SMARTRECRUITERS_COMPANIES } from '../targets/smartrecruiters.js';

export const smartrecruitersSource = defineSource({
  id: smartRecruitersParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  enabledWhen: () =>
    SMARTRECRUITERS_COMPANIES.length > 0
      ? { enabled: true }
      : {
          enabled: false,
          reason: 'No SmartRecruiters companies configured in worker targets',
        },
  resolveParseConfig: () => ({
    companies: [...SMARTRECRUITERS_COMPANIES],
  }),
  parser: smartRecruitersParser,
});
