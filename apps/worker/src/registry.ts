import { remoteOKParser } from '@opencruit/parser-remoteok';
import { weWorkRemotelyParser } from '@opencruit/parser-weworkremotely';
import type { Parser } from '@opencruit/parser-sdk';

const batchParsers = new Map<string, Parser>([
  [remoteOKParser.manifest.id, remoteOKParser],
  [weWorkRemotelyParser.manifest.id, weWorkRemotelyParser],
]);

export function getParser(id: string): Parser {
  const parser = batchParsers.get(id);
  if (!parser) {
    throw new Error(`Unknown parser id: ${id}`);
  }

  return parser;
}

export function getAllParsers(): Parser[] {
  return [...batchParsers.values()];
}
