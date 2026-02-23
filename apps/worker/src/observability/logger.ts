import pino, { type LevelWithSilent, type Logger } from 'pino';

const DEFAULT_LOG_LEVEL: LevelWithSilent = 'info';
const DEFAULT_SERVICE_NAME = 'opencruit-worker';
const VALID_LOG_LEVELS = new Set<LevelWithSilent>(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

function readLogLevel(): LevelWithSilent {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw || !VALID_LOG_LEVELS.has(raw as LevelWithSilent)) {
    return DEFAULT_LOG_LEVEL;
  }

  return raw as LevelWithSilent;
}

export function createWorkerLogger(): Logger {
  const service = process.env.LOG_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME;

  return pino({
    level: readLogLevel(),
    base: { service },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    messageKey: 'message',
  });
}
