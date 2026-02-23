export interface RawJob {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  company: string;
  companyLogoUrl?: string;
  location?: string;
  isRemote?: boolean;
  description: string;
  tags?: string[];
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  postedAt?: Date;
  applyUrl?: string;
  raw?: Record<string, unknown>;
}

export interface ParserManifest {
  id: string;
  name: string;
  version: string;
  schedule: string;
}

export interface ParseResult {
  jobs: RawJob[];
  cursor?: string;
}

export interface Parser {
  manifest: ParserManifest;
  parse(config?: Record<string, unknown>): Promise<ParseResult>;
}
