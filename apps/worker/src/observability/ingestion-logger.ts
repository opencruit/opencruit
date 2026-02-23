import type { IngestionLogger } from '@opencruit/ingestion';
import type { Logger } from 'pino';

export function createIngestionLogger(logger: Logger): IngestionLogger {
  return {
    info: (message) => logger.debug({ event: 'ingestion_stage' }, message),
    warn: (message) => logger.warn({ event: 'ingestion_stage' }, message),
    error: (message) => logger.error({ event: 'ingestion_stage' }, message),
  };
}
