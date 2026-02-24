# OpenCruit — Project Context

## Architecture — Modular Monolith

Not microservices. Two app processes + infra/observability services. One codebase, shared modules.

```
┌────────────────────────────────────────────────────┐
│                  Monorepo (one codebase)          │
│                                                    │
│  ┌──────────────────┐   ┌───────────────────────┐ │
│  │    Web App       │   │      Worker           │ │
│  │    (SvelteKit)   │   │   (BullMQ consumer)   │ │
│  │                  │   │                       │ │
│  │  • UI / SSR      │   │  • hh.index          │ │
│  │  • API routes    │   │  • hh.hydrate        │ │
│  │  • Search        │   │  • hh.refresh        │ │
│  │                  │   │  • source.ingest     │ │
│  │                  │   │  • source.gc         │ │
│  └────────┬─────────┘   └──────────┬────────────┘ │
│           │      Shared modules    │              │
│           │  • @opencruit/db       │              │
│           │  • @opencruit/ingestion│              │
│           │  • @opencruit/parser-* │              │
│           └────────────┬───────────┘              │
└────────────────────────┼───────────────────────────┘
                         │
               ┌─────────┼─────────┬───────────────┐
               ▼                   ▼               ▼
         ┌──────────┐        ┌──────────┐   ┌────────────┐
         │ Postgres │        │  Redis   │   │ Prometheus │
         │ • jobs   │        │ • BullMQ │   │ • metrics  │
         │ • cursors│        │ • queues │   │ • alerts   │
         └──────────┘        └──────────┘   └─────┬──────┘
                                                    │
                                                    ▼
                                               ┌─────────┐
                                               │ Grafana │
                                               │ • charts│
                                               └─────────┘
```

### Self-Hosting

- Single `docker compose up -d --build` for full stack
- Local hybrid frontend dev uses `docker-compose.dev.yml` to expose Postgres + Redis on host (`pnpm dev:infra` + `pnpm dev:web` on `http://localhost:5973`)
- Long-running services: `postgres`, `redis`, `worker`, `web`, `prometheus`, `grafana`
- One-shot bootstrap service: `migrate` (`pnpm --filter @opencruit/db db:migrate`)
- Production schema lifecycle uses versioned SQL migrations in `packages/db/drizzle/*`
- Local prototyping fallback: `pnpm --filter @opencruit/db db:push`
- Ops runbooks:
  - `docs/DEPLOYMENT.md`
  - `docs/OPERATIONS.md`
  - `docs/OBSERVABILITY.md`
  - `docs/TROUBLESHOOTING.md`
- Ops helper scripts:
  - `scripts/ops/bootstrap.sh`
  - `scripts/ops/healthcheck.sh`
  - `scripts/ops/down.sh`
  - `scripts/ops/enqueue-batch.ts`
  - `scripts/ops/source-report.ts`

## Parser System

### Parser Types

- **Batch parsers** implement `Parser` interface from `@opencruit/parser-sdk` using `defineParser(...)`
- **Workflow sources** use worker `defineSource(...)` contract for multi-phase orchestration (`hh`)

### Unified Orchestration

- Worker is the only production orchestrator for source polling and lifecycle jobs
- `source.ingest` runs batch sources from worker source catalog (`remoteok`, `weworkremotely`, `remotive`, `arbeitnow`, `jobicy`, `himalayas`, `adzuna`, `jooble`, `greenhouse`, `lever`, `smartrecruiters`)
- Source schedule is resolved by worker config/env (`SOURCE_SCHEDULE_<SOURCE_ID>`) with fallback to source or parser manifest schedule
- Scheduler validates source requirements (`requiredEnv`, `enabledWhen`) before enqueueing repeatable jobs
- Misconfigured sources are marked disabled and skipped without blocking healthy sources
- Scheduler isolates per-source setup failures; one broken source does not block scheduling for others
- Worker source catalog is the single source-of-truth for batch and workflow sources
- `@opencruit/ingestion` is a pure processing library (no parser imports, no CLI path)
- `source.gc` applies archive/delete retention for all sources using per-source policy defaults

### Source Config

- Secrets are provided via environment variables:
  - `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
  - `JOOBLE_API_KEY`
- Optional source-country controls:
  - `ADZUNA_COUNTRIES` (default: `us,gb,de,nl,pl`)
  - `JOOBLE_COUNTRIES` (default: `us,gb,de,nl,pl`)
- Optional HH runtime controls:
  - `HH_BOOTSTRAP_INDEX_NOW` (default: `false`)
  - `HH_HYDRATE_MAX_BACKLOG` (default: `5000`)
- ATS company/board target lists are kept in worker TS files:
  - `apps/worker/src/sources/targets/greenhouse.ts`
  - `apps/worker/src/sources/targets/lever.ts`
  - `apps/worker/src/sources/targets/smartrecruiters.ts`

### Worker Debug Observability v1

- Worker logs are structured JSON lines via `pino`
- Every job emits lifecycle events: `job_started`, `job_completed`, `job_failed`
- `traceId` is attached to every job payload and propagated to child HH jobs
- Persistent source health state is stored in PostgreSQL `source_health`
- Worker exposes Prometheus metrics on `/metrics` (`WORKER_METRICS_PORT`, default `9464`)
- Prometheus scrapes worker metrics; Grafana is provisioned with a default worker dashboard
- Observability configs are kept under `infra/observability/*` (Prometheus scrape/rules + Grafana provisioning)
- PM dashboard is provisioned in Grafana (`OpenCruit PM Overview`) with product KPI gauges from worker metrics
- Observability is attached through worker event hooks (`active`, `completed`, `failed`), not through handler wrappers
- `withTrace(job)` is still used in HH fan-out handlers to guarantee trace propagation into child jobs
- Config:
  - `LOG_LEVEL` (default `info`)
  - `LOG_SERVICE_NAME` (default `opencruit-worker`)
  - `WORKER_METRICS_ENABLED` (default `true`)
  - `WORKER_METRICS_PORT` (default `9464`)
- Debug runbook: `docs/WORKER_LOGGING.md`

### HH Flow (Step 4)

1. `hh.index`
- Calls `GET /vacancies` by IT professional role + time window
- Handles HH 2000-result depth limit by recursive time-splitting
- Enqueues vacancy ids to `hh.hydrate`
- Applies backpressure: skips enqueue when `hh.hydrate` backlog reaches `HH_HYDRATE_MAX_BACKLOG`
- Does not advance role cursor when skipped due to backlog (prevents data loss)

2. `hh.hydrate`
- Calls `GET /vacancies/{id}`
- Maps to `RawJob`
- Runs ingestion stages (`validate -> normalize -> fingerprint -> dedup -> store`)
- Maintains vacancy lifecycle fields (`status`, `last_checked_at`, `next_check_at`, `last_seen_at`)

3. `hh.refresh`
- Finds due HH jobs where `next_check_at <= now()`
- Re-enqueues `hh.hydrate` for re-check

4. `source.gc`
- Archives stale active jobs for all sources
- Deletes long-retained archived/missing jobs for all sources
- Uses per-source policy (HH stricter than generic API parsers)

### Shared HH HTTP Guardrails

- One `HhClient` instance per worker process
- In-process request serialization + random delay (2–4s default)
- Retry with exponential backoff, respect `Retry-After` for 429
- Circuit breaker for repeated 429/403 responses

## Ingestion Pipeline (`@opencruit/ingestion`)

Stages:
- validate (parser-sdk Zod)
- normalize (text cleanup + safe rich-description normalization)
- fingerprint (sha256 company+title+location)
- dedup (Tier 2 fingerprint policy)
- store (upsert with refresh metadata)

`content_hash` is computed from normalized content fields and used to skip heavy writes when unchanged during HH hydrate checks.
`compute_next_check_at` and `content_hash` helpers are exported and reused by worker jobs.

## Data Model

### `jobs` additions

- `status` (`active` | `archived` | `missing`)
- `content_hash`
- `description_rich` (sanitized rich HTML for UI rendering; plain `description` stays canonical for search)
- `last_checked_at`
- `next_check_at`
- `first_seen_at`
- `last_seen_at`

Indexes:
- `idx_jobs_status`
- `idx_jobs_next_check_at`
- `idx_jobs_source_status_next_check`

### `source_cursors`

Generic cursor table for incremental polling:
- `source`
- `segment_key`
- `last_polled_at`
- `cursor` (jsonb)
- `stats` (jsonb)

### `source_health`

Persistent worker health state by `(source_id, stage)`:
- `status` (`healthy` | `failing`)
- `last_run_at`, `last_success_at`, `last_error_at`
- `consecutive_failures`
- `last_duration_ms`
- `last_error`
- `created_at`, `updated_at`

Used for durable operational visibility beyond ephemeral logs.

## Refresh Policy

- `< 2 days old`: every 12h
- `2-14 days`: every 24h
- `14-30 days`: every 72h
- `> 30 days`: every 7d
- `archived/missing`: next check in 30d

## GC Policy (defaults)

- `hh`: archive after 10 days, archived recheck in 30 days, delete archived/missing after 60 days
- `remoteok`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- `weworkremotely`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- `remotive`: archive after 10 days, archived recheck in 30 days, delete archived/missing after 60 days
- `arbeitnow`: archive after 21 days, archived recheck in 30 days, delete archived/missing after 90 days
- `jobicy`: archive after 30 days, archived recheck in 45 days, delete archived/missing after 120 days
- `himalayas`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- `adzuna`: archive after 21 days, archived recheck in 30 days, delete archived/missing after 90 days
- `jooble`: archive after 21 days, archived recheck in 30 days, delete archived/missing after 90 days
- `greenhouse`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- `lever`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- `smartrecruiters`: archive after 14 days, archived recheck in 30 days, delete archived/missing after 90 days
- unknown source fallback: archive 14 days, archived recheck in 30 days, delete archived/missing after 90 days

## Admin Panel

- Route group `(admin)/admin/` in `apps/web` (same SvelteKit process, own sidebar layout)
- Public routes in `(public)/` route group, root layout is minimal (CSS + ModeWatcher)
- Pages: Dashboard, Sources (list + detail + trigger ingest), Queues (job counts + failed jobs + retry/remove/clean), Jobs (filterable browser)
- Web app connects to Redis for BullMQ `Queue` instances (read + enqueue, not Worker)
- Source metadata: static `KNOWN_SOURCES` map in `$lib/sources.ts`, shared by admin + public pages
- Server singletons: `$lib/server/redis.ts` (IORedis), `$lib/server/queues.ts` (5 BullMQ Queue instances)
- `globalThis` pattern used for Redis/Queue singletons to survive HMR in dev
- No auth guard yet — admin routes are public, future: `hooks.server.ts` role check
- Queue name constants and job data types are duplicated from worker (~30 lines, pragmatic)
- Docker: web service now depends on `redis` and receives `REDIS_URL` env var

## Implementation Status

- Step 1 — Web app: **done**
- Step 2 — PostgreSQL + Drizzle: **done**
- Step 3 — Ingestion package: **done**
- Step 4 — Redis + BullMQ + HH worker: **done**
- Step 5 — Admin panel: **done**

## Monorepo Structure (current)

```
apps/
  web/                        # @opencruit/web
  worker/                     # @opencruit/worker
packages/
  tsconfig/                   # shared TS configs
  eslint-config/              # shared ESLint configs
  types/                      # @opencruit/types
  parser-sdk/                 # @opencruit/parser-sdk
  db/                         # @opencruit/db
  ingestion/                  # @opencruit/ingestion
  parsers/
    hh/                       # @opencruit/parser-hh
    remoteok/                 # @opencruit/parser-remoteok
    weworkremotely/           # @opencruit/parser-weworkremotely
    remotive/                 # @opencruit/parser-remotive
    arbeitnow/                # @opencruit/parser-arbeitnow
    jobicy/                   # @opencruit/parser-jobicy
    himalayas/                # @opencruit/parser-himalayas
    adzuna/                   # @opencruit/parser-adzuna
    jooble/                   # @opencruit/parser-jooble
    greenhouse/               # @opencruit/parser-greenhouse
    lever/                    # @opencruit/parser-lever
    smartrecruiters/          # @opencruit/parser-smartrecruiters
```
