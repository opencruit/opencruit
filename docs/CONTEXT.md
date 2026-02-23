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

## Parser SDK Approach

- Build SDK iteratively by writing real parsers, not upfront in a vacuum
- First parser: RemoteOK (JSON API, simplest) — **done**, fixture-based tests passing
- Second: Greenhouse or Lever (HTML parsing)
- Third: something with headless browser (Playwright)
- After 3 parsers — stabilize SDK, publish to npm
- SDK currently exports: `RawJob` type, `rawJobSchema` (Zod), `validateRawJobs()` utility

### Parser Testing

- Fixture-based tests: saved HTML/JSON snapshots, parser runs against them
- Schema validation: Zod schema from SDK validates every output
- Integration tests: real HTTP requests, run on schedule (not every PR)

## Packages That Will Be Published to npm

- `@opencruit/types` — shared type definitions
- `@opencruit/parser-sdk` — parser contract + HTTP server + test utilities

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
| Svelte            | 5.x           |
| SvelteKit         | 2.x           |
| Tailwind CSS      | 4.x           |
| Drizzle ORM       | 0.x           |
| Vitest            | 4.0.18        |
| Zod               | 4.3.6         |
| License           | AGPL-3.0-only |

## Monorepo Structure (current)

```
packages/
  tsconfig/         # shared TS configs
  eslint-config/    # shared ESLint 10 configs (base, svelte)
  types/            # @opencruit/types
  parser-sdk/       # @opencruit/parser-sdk — types, Zod schema, utilities
  parsers/
    remoteok/       # @opencruit/parser-remoteok — RemoteOK JSON API parser
apps/               # deployable services (when created)
```

Internal packages have no build step — exports point to `./src/index.ts`.
Only npm-published packages (types, parser-sdk) will need tsup build.
