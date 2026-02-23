# OpenCruit — Project Context

## Architecture

### Parser System

- Parsers are standalone HTTP services with 3 endpoints: `/manifest`, `/health`, `/parse`
- Language-agnostic contract — any language can implement it (Node, Rust, Go)
- Node.js parsers use `@opencruit/parser-sdk` for types, Zod schema validation, and utilities
- `/parse` returns NDJSON stream for large result sets
- Orchestrator (BullMQ + Redis) manages scheduling, retries, concurrency

### Parser Distribution

- **Open parsers** — in main repo under `packages/parsers/`. Simple sources with public APIs
- **Private parsers** — separate private repo `opencruit/parsers-private`. Anti-bot sensitive sources
- **Community parsers** — any external repo. Install `@opencruit/parser-sdk` from npm, publish Docker image
- All three types implement the same HTTP contract

### Ingestion Pipeline

- Raw job → normalize → validate → fingerprint → deduplicate → enrich → store → emit event
- Runs as BullMQ worker, all stages in-process (MVP)

### Deduplication (3 tiers)

- Tier 1: exact match by `source + external_id` (same job re-scraped)
- Tier 2: fingerprint `sha256(company + title + location)` (same job from different sources)
- Tier 3: fuzzy match via `pg_trgm` similarity > 0.85 (background job, not inline)

### Events

- Redis Streams (`events:jobs`) for job.new / job.updated / job.expired
- Consumer groups: notifications, search-indexer, analytics

### Search

- MVP: PostgreSQL tsvector with weighted full-text search
- Future: Meilisearch behind `SearchProvider` abstraction

### Self-Hosting

- Single `docker compose up` — PostgreSQL + Redis + app services
- One Redis for everything (BullMQ queues + Streams + cache)

## Implementation Plan (vertical slice)

Build one complete path from parser to browser, then widen each layer.

### Step 1 — SvelteKit app (direct parser call) — **done**

SvelteKit app with Svelte 5, Tailwind CSS 4, shadcn-svelte components, dark/light theme (mode-watcher).
Job listing with search, detail pages, responsive layout.

### Step 2 — PostgreSQL + Drizzle — **done**

`packages/db/` with Drizzle schema (`jobs` table), `docker-compose.yml` for PostgreSQL.
`pnpm ingest` runs parser → writes to DB. SvelteKit reads from DB.

### Step 3 — Ingestion pipeline

normalize → validate (Zod schema) → fingerprint → dedup → store.
Plain function, no BullMQ yet. Processes `RawJob[]` and writes to DB.

### Step 4 — Orchestrator (BullMQ + Redis)

Only when 2+ parsers exist and scheduling is needed. Until then — cron is enough.

### Deferred (not MVP)

- Redis Streams / events — no consumers yet
- NDJSON streaming in `/parse` — RemoteOK returns <200 jobs
- Parser as HTTP service (`/manifest`, `/health`, `/parse`) — parsers stay as functions until orchestrator exists
- Second/third parsers — after pipeline works end-to-end

## Parser SDK

- Build iteratively by writing real parsers
- First parser: RemoteOK (JSON API) — **done**, fixture-based tests passing
- SDK exports: `RawJob` type, `rawJobSchema` (Zod), `validateRawJobs()` utility
- HTTP server wrapper, `defineParser()`, `testParser()` — deferred until orchestrator step

### Parser Testing

- Fixture-based tests: saved HTML/JSON snapshots, parser runs against them
- Schema validation: Zod schema from SDK validates every output
- Integration tests: real HTTP requests, run on schedule (not every PR)

## Packages That Will Be Published to npm

- `@opencruit/types` — shared type definitions
- `@opencruit/parser-sdk` — parser contract + utilities

## Tech Stack (locked)

| Tool              | Version       |
| ----------------- | ------------- |
| pnpm              | 10.30.1       |
| Turborepo         | 2.8.10        |
| Node.js           | 24 LTS        |
| TypeScript        | 5.9.3         |
| ESLint            | 10.0.1        |
| typescript-eslint | 8.56.0        |
| Prettier          | 3.8.1         |
| Svelte            | 5.53.1        |
| SvelteKit         | 2.53.0        |
| Tailwind CSS      | 4.2.0         |
| Drizzle ORM       | 0.45.1        |
| Vitest            | 4.0.18        |
| Zod               | 4.3.6         |
| shadcn-svelte     | 1.1.1 (CLI)   |
| mode-watcher      | 1.1.0         |
| License           | AGPL-3.0-only |

## Monorepo Structure (current)

```
apps/
  web/              # @opencruit/web — SvelteKit frontend (Svelte 5, Tailwind 4, shadcn-svelte)
packages/
  tsconfig/         # shared TS configs
  eslint-config/    # shared ESLint 10 configs (base, svelte)
  types/            # @opencruit/types
  parser-sdk/       # @opencruit/parser-sdk — types, Zod schema, utilities
  db/               # @opencruit/db — Drizzle schema, client, migrations
  parsers/
    remoteok/       # @opencruit/parser-remoteok — RemoteOK JSON API parser
```

Internal packages have no build step — exports point to `./src/index.ts`.
Only npm-published packages (types, parser-sdk) will need tsup build.
