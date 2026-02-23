import type { HhProfessionalRolesResponse, HhSearchParams, HhSearchResponse, HhVacancyDetail } from './types.js';

const DEFAULT_BASE_URL = 'https://api.hh.ru';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HhClientOptions {
  baseUrl?: string;
  userAgent: string;
  accessToken?: string;
  minDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
  fetchImpl?: typeof fetch;
}

export class HhHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs?: number;

  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`HH API request failed with status ${status}`);
    this.name = 'HhHttpError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

export class HhCircuitOpenError extends Error {
  readonly reopenInMs: number;

  constructor(reopenInMs: number) {
    super(`HH circuit breaker is open for ${reopenInMs}ms`);
    this.name = 'HhCircuitOpenError';
    this.reopenInMs = reopenInMs;
  }
}

export class HhClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly accessToken?: string;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly fetchImpl: typeof fetch;

  private sequence: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private consecutiveLimitFailures = 0;
  private circuitOpenedUntil = 0;

  constructor(options: HhClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent;
    this.accessToken = options.accessToken;
    this.minDelayMs = options.minDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 4000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.circuitFailureThreshold = options.circuitFailureThreshold ?? 5;
    this.circuitOpenMs = options.circuitOpenMs ?? 5 * 60 * 1000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getItRoleIds(): Promise<string[]> {
    const response = await this.request<HhProfessionalRolesResponse>('/professional_roles');
    const category =
      response.categories.find((item) => item.id === '11') ??
      response.categories.find((item) => /информац|\bit\b/i.test(item.name));

    return (category?.roles ?? []).map((role) => role.id);
  }

  async searchVacancies(params: HhSearchParams): Promise<HhSearchResponse> {
    const query = new URLSearchParams();
    query.set('professional_role', params.professionalRole);
    query.set('page', String(params.page ?? 0));
    query.set('per_page', String(params.perPage ?? 100));
    query.set('order_by', params.orderBy ?? 'publication_time');

    if (params.host) {
      query.set('host', params.host);
    }

    if (params.dateFrom) {
      query.set('date_from', params.dateFrom);
    }

    if (params.dateTo) {
      query.set('date_to', params.dateTo);
    }

    return this.request<HhSearchResponse>(`/vacancies?${query.toString()}`);
  }

  async getVacancy(vacancyId: string, host?: string): Promise<HhVacancyDetail> {
    if (host) {
      return this.request<HhVacancyDetail>(`/vacancies/${vacancyId}?host=${encodeURIComponent(host)}`);
    }

    return this.request<HhVacancyDetail>(`/vacancies/${vacancyId}`);
  }

  private async request<T>(path: string): Promise<T> {
    return this.enqueue(async () => {
      this.assertCircuitClosed();
      await this.waitForRateWindow();

      let attempt = 0;
      while (true) {
        try {
          const data = await this.requestOnce<T>(path);
          this.recordSuccess();
          return data;
        } catch (error) {
          this.recordFailure(error);

          if (attempt >= this.maxRetries || !this.isRetryable(error)) {
            throw error;
          }

          const waitMs = this.getRetryDelayMs(error, attempt);
          await sleep(waitMs);
          attempt += 1;
        }
      }
    });
  }

  private async requestOnce<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        const body = await response.text();
        const retryAfter = this.parseRetryAfter(response.headers.get('retry-after'));
        throw new HhHttpError(response.status, body, retryAfter);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'HH-User-Agent': this.userAgent,
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (!value) return undefined;

    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return undefined;
    }

    return Math.round(seconds * 1000);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof HhHttpError) {
      return error.status === 429 || error.status >= 500;
    }

    if (error instanceof HhCircuitOpenError) {
      return false;
    }

    return error instanceof Error;
  }

  private getRetryDelayMs(error: unknown, attempt: number): number {
    if (error instanceof HhHttpError && error.retryAfterMs !== undefined) {
      return error.retryAfterMs;
    }

    const base = 500;
    const maxJitter = 250;
    const jitter = Math.floor(Math.random() * maxJitter);
    return base * 2 ** attempt + jitter;
  }

  private assertCircuitClosed(): void {
    const now = Date.now();
    if (this.circuitOpenedUntil > now) {
      throw new HhCircuitOpenError(this.circuitOpenedUntil - now);
    }
  }

  private recordSuccess(): void {
    this.consecutiveLimitFailures = 0;
  }

  private recordFailure(error: unknown): void {
    if (error instanceof HhHttpError && (error.status === 429 || error.status === 403)) {
      this.consecutiveLimitFailures += 1;

      if (this.consecutiveLimitFailures >= this.circuitFailureThreshold) {
        this.circuitOpenedUntil = Date.now() + this.circuitOpenMs;
        this.consecutiveLimitFailures = 0;
      }

      return;
    }

    this.consecutiveLimitFailures = 0;
  }

  private randomDelayMs(): number {
    if (this.maxDelayMs <= this.minDelayMs) {
      return this.minDelayMs;
    }

    const spread = this.maxDelayMs - this.minDelayMs;
    return this.minDelayMs + Math.floor(Math.random() * (spread + 1));
  }

  private async waitForRateWindow(): Promise<void> {
    const now = Date.now();
    if (this.lastRequestAt === 0) {
      this.lastRequestAt = now;
      return;
    }

    const target = this.lastRequestAt + this.randomDelayMs();
    if (target > now) {
      await sleep(target - now);
    }

    this.lastRequestAt = Date.now();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.sequence.then(task, task);
    this.sequence = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }
}
