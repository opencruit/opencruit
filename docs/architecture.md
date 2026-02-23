# OpenCruit — Architecture Overview

High-level architecture snapshot. For implementation details and status, see `docs/CONTEXT.md`.

## System Diagram

```
┌────────────────────────────────────────────────────┐
│                  Monorepo (one codebase)          │
│                                                    │
│  ┌──────────────────┐   ┌───────────────────────┐ │
│  │    Web App       │   │      Worker           │ │
│  │    (SvelteKit)   │   │   (BullMQ consumer)   │ │
│  │                  │   │                       │ │
│  │  • UI / SSR      │   │  • source.ingest     │ │
│  │  • API routes    │   │  • hh.index          │ │
│  │  • Search        │   │  • hh.hydrate        │ │
│  │                  │   │  • hh.refresh        │ │
│  │                  │   │  • source.gc         │ │
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

## Core Components

### Worker Orchestrator

- Single production orchestrator for all source polling and lifecycle jobs.
- `source.ingest`: runs simple parsers (`remoteok`, `weworkremotely`) on cron.
- `hh.index` / `hh.hydrate` / `hh.refresh`: HH-specific multi-phase workflow.
- `source.gc`: generic retention job for archive/delete by source policy.
- Structured JSON logging via `pino`, with `traceId` propagation (`withLogger` / `withTrace`).
- Durable per-source runtime health state in PostgreSQL `source_health`.
- Worker source catalog (`defineSource`) is the orchestration entrypoint for batch and workflow sources.

### Parsers

- Parsers are workspace packages imported by worker (not standalone HTTP services).
- Simple parsers implement `Parser` from `@opencruit/parser-sdk`.
- HH parser package provides API client + mapping helpers used by worker jobs.

### Ingestion Pipeline

Processes raw jobs through:

```
raw job -> validate -> normalize -> fingerprint -> dedup -> store
```

- `@opencruit/ingestion` is a pure library reused by worker jobs.
- Shared utilities: `computeContentHash`, `computeNextCheckAt`.

### Data Layer

- PostgreSQL: primary storage (`jobs`, `source_cursors`, `source_health`).
- Redis: BullMQ queues and scheduling backend.

## Infrastructure

```
docker compose up
├── PostgreSQL
└── Redis
```

Apps run from workspace commands (`pnpm dev`, `pnpm worker`).

## Data Flow

1. Worker scheduler enqueues source jobs (`source.ingest`, `hh.index`, `hh.refresh`, `source.gc`)
2. Source jobs fetch raw vacancies from external platforms
3. Ingestion pipeline validates, normalizes, deduplicates, stores in PostgreSQL
4. Refresh/GC maintain lifecycle (`active`, `archived`, `missing`) and retention windows
