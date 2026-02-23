# OpenCruit — Project Context

## Architecture — Modular Monolith

Not microservices. Two app processes + two infra services. One codebase, shared modules.

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
│  │                  │   │  • hh.gc             │ │
│  └────────┬─────────┘   └──────────┬────────────┘ │
│           │      Shared modules    │              │
│           │  • @opencruit/db       │              │
│           │  • @opencruit/ingestion│              │
│           │  • @opencruit/parser-* │              │
│           └────────────┬───────────┘              │
└────────────────────────┼───────────────────────────┘
                         │
               ┌─────────┼─────────┐
               ▼                   ▼
         ┌──────────┐        ┌──────────┐
         │ Postgres │        │  Redis   │
         │ • jobs   │        │ • BullMQ │
         │ • cursors│        │ • queues │
         └──────────┘        └──────────┘
```

### Self-Hosting

- Single `docker compose up` for local stack
- Infra services: PostgreSQL + Redis
- Apps run from monorepo commands (`pnpm dev`, `pnpm worker`)

## Parser System

### Parser Types

- **Simple parsers** implement `Parser` interface from `@opencruit/parser-sdk` (`remoteok`, `weworkremotely`)
- **HH parser** is a helper package (`@opencruit/parser-hh`) used by worker jobs; it does not expose `parse() => RawJob[]`

### HH Flow (Step 4)

1. `hh.index`
- Calls `GET /vacancies` by IT professional role + time window
- Handles HH 2000-result depth limit by recursive time-splitting
- Enqueues vacancy ids to `hh.hydrate`

2. `hh.hydrate`
- Calls `GET /vacancies/{id}`
- Maps to `RawJob`
- Runs ingestion stages (`validate -> normalize -> fingerprint -> dedup -> store`)
- Maintains vacancy lifecycle fields (`status`, `last_checked_at`, `next_check_at`, `last_seen_at`)

3. `hh.refresh`
- Finds due HH jobs where `next_check_at <= now()`
- Re-enqueues `hh.hydrate` for re-check

4. `hh.gc`
- Archives stale active HH jobs not seen recently
- Deletes long-retained archived/missing HH jobs

### Shared HH HTTP Guardrails

- One `HhClient` instance per worker process
- In-process request serialization + random delay (2–4s default)
- Retry with exponential backoff, respect `Retry-After` for 429
- Circuit breaker for repeated 429/403 responses

## Ingestion Pipeline (`@opencruit/ingestion`)

Stages:
- validate (parser-sdk Zod)
- normalize (text cleanup, HTML stripping)
- fingerprint (sha256 company+title+location)
- dedup (Tier 2 fingerprint policy)
- store (upsert with refresh metadata)

`content_hash` is computed from normalized content fields and used to skip heavy writes when unchanged during HH hydrate checks.

## Data Model

### `jobs` additions

- `status` (`active` | `archived` | `missing`)
- `content_hash`
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

## Refresh Policy

- `< 2 days old`: every 12h
- `2-14 days`: every 24h
- `14-30 days`: every 72h
- `> 30 days`: every 7d
- `archived/missing`: next check in 30d

## Implementation Status

- Step 1 — Web app: **done**
- Step 2 — PostgreSQL + Drizzle: **done**
- Step 3 — Ingestion package: **done**
- Step 4 — Redis + BullMQ + HH worker: **done**

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
```
