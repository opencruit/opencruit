import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_BASE = 'https://boards-api.greenhouse.io/v1/boards';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];

const TECH_KEYWORDS = [
  'engineer',
  'developer',
  'software',
  'devops',
  'data',
  'platform',
  'security',
  'frontend',
  'backend',
  'full stack',
  'machine learning',
  'ai',
  'site reliability',
  'sre',
  'qa',
  'it',
] as const;

interface GreenhouseJob {
  id: number;
  title: string;
  absoluteUrl: string;
  location?: string;
  updatedAt?: string;
  companyName?: string;
  content?: string;
  departments: string[];
  board: string;
  raw: Record<string, unknown>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

interface ResolvedConfig {
  boards: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function looksRemote(title: string, location: string | undefined): boolean {
  const text = `${title} ${location ?? ''}`.toLowerCase();
  return text.includes('remote') || text.includes('distributed') || text.includes('anywhere') || text.includes('hybrid');
}

function isLikelyTechJob(title: string, departments: string[]): boolean {
  const text = `${title} ${departments.join(' ')}`.toLowerCase();
  return TECH_KEYWORDS.some((keyword) => text.includes(keyword));
}

function resolveConfig(config?: Record<string, unknown>): ResolvedConfig {
  if (!config) {
    throw new Error('Greenhouse parser config is required');
  }

  const boardsRaw = config.boards;
  const boards =
    Array.isArray(boardsRaw) && boardsRaw.every((board) => typeof board === 'string')
      ? boardsRaw.map((board) => board.trim().toLowerCase()).filter((board) => board.length > 0)
      : [];

  if (boards.length === 0) {
    throw new Error('Greenhouse parser requires at least one board token');
  }

  return {
    boards: [...new Set(boards)],
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJob(payload: unknown, board: string): GreenhouseJob | null {
  if (!isRecord(payload)) {
    return null;
  }

  const id = asNumber(payload.id);
  const title = asString(payload.title)?.trim();
  const absoluteUrl = asString(payload.absolute_url)?.trim();
  if (!id || !title || !absoluteUrl) {
    return null;
  }

  const location = isRecord(payload.location) ? asString(payload.location.name)?.trim() : undefined;
  const metadataRaw = Array.isArray(payload.metadata) ? payload.metadata : [];
  const departments = metadataRaw
    .map((item) => (isRecord(item) ? asString(item.value)?.trim() : undefined))
    .filter((item): item is string => !!item);

  return {
    id,
    title,
    absoluteUrl,
    location,
    updatedAt: asString(payload.updated_at),
    companyName: asString(payload.company_name)?.trim(),
    content: asString(payload.content),
    departments,
    board,
    raw: payload,
  };
}

function parseResponse(payload: unknown, board: string): GreenhouseResponse {
  if (!isRecord(payload)) {
    throw new Error('Greenhouse API returned invalid payload');
  }

  const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs : [];
  const jobs = jobsRaw.map((item) => parseJob(item, board)).filter((item): item is GreenhouseJob => item !== null);

  return { jobs };
}

async function fetchBoard(board: string): Promise<GreenhouseResponse> {
  let lastError: Error | undefined;
  const url = `${API_BASE}/${encodeURIComponent(board)}/jobs?content=true`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
      continue;
    }

    if (!res.ok) {
      if (res.status === 404) {
        return { jobs: [] };
      }

      const statusError = new Error(`Greenhouse API returned ${res.status}`);
      if (!shouldRetryStatus(res.status)) {
        throw statusError;
      }

      lastError = statusError;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
      continue;
    }

    try {
      const payload = await res.json();
      return parseResponse(payload, board);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Greenhouse API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Greenhouse API request failed after ${MAX_ATTEMPTS} attempts`);
}

function toRawJob(job: GreenhouseJob): RawJob {
  return {
    sourceId: 'greenhouse',
    externalId: `greenhouse:${job.board}:${job.id}`,
    url: job.absoluteUrl,
    title: job.title,
    company: job.companyName || job.board,
    location: job.location || undefined,
    isRemote: looksRemote(job.title, job.location),
    description: job.content || `${job.title} at ${job.companyName || job.board}`,
    tags: job.departments.length > 0 ? job.departments : undefined,
    postedAt: parseDate(job.updatedAt),
    applyUrl: job.absoluteUrl,
    raw: job.raw,
  };
}

export async function parse(config?: Record<string, unknown>): Promise<ParseResult> {
  const resolved = resolveConfig(config);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const board of resolved.boards) {
    const response = await fetchBoard(board);

    for (const job of response.jobs) {
      if (!isLikelyTechJob(job.title, job.departments)) {
        continue;
      }

      const rawJob = toRawJob(job);
      if (seen.has(rawJob.externalId)) {
        continue;
      }

      seen.add(rawJob.externalId);
      jobs.push(rawJob);
    }
  }

  return { jobs };
}

export const greenhouseParser = defineParser({
  manifest: {
    id: 'greenhouse',
    name: 'Greenhouse',
    version: '0.1.0',
    schedule: '15 */12 * * *',
  },
  parse,
});
