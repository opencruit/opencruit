# OpenCruit — Project Context

## Architecture — Modular Monolith

Not microservices. Two app processes + two infra services. One codebase, shared modules.

```
┌────────────────────────────────────────────────────┐
│                  Monorepo (one codebase)            │
│                                                     │
│  ┌──────────────────┐   ┌───────────────────────┐  │
│  │    Web App        │   │      Worker           │  │
│  │    (SvelteKit)    │   │   (BullMQ consumer)   │  │
│  │                   │   │                       │  │
│  │  • UI / SSR       │   │  • Parser jobs        │  │
│  │  • API routes     │   │  • Ingestion pipeline │  │
│  │  • Search         │   │  • Dedup (background) │  │
│  │  • Auth           │   │  • AI enrichment      │  │
│  │                   │   │  • Notifications      │  │
│  └────────┬──────────┘   └──────────┬────────────┘  │
│           │       Shared modules    │               │
│           │  • @opencruit/db        │               │
│           │  • @opencruit/parser-sdk│               │
│           │  • @opencruit/types     │               │
│           └────────────┬────────────┘               │
└────────────────────────┼────────────────────────────┘
                         │
               ┌─────────┼─────────┐
               ▼                   ▼
         ┌──────────┐        ┌──────────┐
         │ Postgres │        │  Redis   │
         │ • jobs   │        │ • BullMQ │
         │ • users  │        │ • cache  │
         │ • search │        │ • events │
         └──────────┘        └──────────┘
```

### Self-Hosting

- Current vertical slice: `docker compose up` starts PostgreSQL only
- Redis, worker process, and full 4-container setup are planned for orchestrator stage
- Minimal `.env` configuration
- When Redis is introduced, one instance will be used for BullMQ queues, Streams, and cache

### Parser System

- Parsers are **npm packages** in the monorepo, imported by the worker process
- All parsers implement the `Parser` interface from `@opencruit/parser-sdk`
- Worker calls `parser.parse()` directly — no HTTP overhead, no separate containers
- `@opencruit/parser-sdk` provides types, Zod validation, and utilities
- Orchestrator (BullMQ + Redis) manages scheduling, retries, concurrency

### Parser Types by Complexity

- **API parsers** — fetch JSON, map fields (RemoteOK, WeWorkRemotely). Lightweight
- **HTML scraping** — fetch + cheerio. Lightweight
- **Playwright** — browser-based for SPAs, anti-bot sites. Heavy (500MB+ RAM)
- **Platform parsers** — Telegram, Discord, RSS feeds. Varies

### Worker Pools

- **Light pool** — API, HTML, RSS parsers. All run in one process
- **Heavy pool** — Playwright parsers. Separate process with Chrome installed
- Same codebase, different entry points (`--pool=light` vs `--pool=heavy`)
- Heavy pool only deployed when Playwright parsers exist

### Parser Distribution

- **Open parsers** — in main repo under `packages/parsers/`. Simple sources with public APIs
- **Private parsers** — separate private repo `opencruit/parsers-private`. Anti-bot sensitive sources
- **Community parsers** — install `@opencruit/parser-sdk` from npm, publish as npm package

### Ingestion Pipeline

- Raw job → normalize → validate → fingerprint → deduplicate → enrich → store → emit event
- Runs as BullMQ worker, all stages in-process

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

### When to Extract a Service

Not preemptively. Only when a real problem appears:

| Signal | Action |
|--------|--------|
| Playwright parsers eat too much RAM | Deploy heavy pool as separate container |
| tsvector search not enough | Add Meilisearch container |
| AI matching needs GPU | Separate ML service |
| 100k+ users | CDN + horizontal scaling of web |

## Implementation Plan (vertical slice)

Build one complete path from parser to browser, then widen each layer.

### Step 1 — SvelteKit app (direct parser call) — **done**

SvelteKit app with Svelte 5, Tailwind CSS 4, shadcn-svelte components, dark/light theme (mode-watcher).
Job listing with search, detail pages, responsive layout.

### Step 2 — PostgreSQL + Drizzle — **done**

`packages/db/` with Drizzle schema (`jobs` table), `docker-compose.yml` for PostgreSQL.
`pnpm ingest` runs parser → writes to DB. SvelteKit reads from DB.

### Step 3 — Ingestion pipeline — **done**

`packages/ingestion/` with composable stages: validate → normalize → fingerprint → dedup (Tier 2) → store.
Normalization: stripHtml, stripRemoteOKSpam, normalizeTags, normalizeLocation.
Dedup Tier 2: fingerprint match across sources (first source wins, duplicates skipped).
`packages/ingestion` exposes `opencruit-ingest` bin (invoked by `pnpm ingest`) for parser → DB pipeline runs.

### Step 4 — Orchestrator (BullMQ + Redis)

Only when 2+ parsers exist and scheduling is needed. Until then — cron is enough.

### Deferred (not MVP)

- Redis Streams / events — no consumers yet
- BullMQ orchestrator — cron/manual ingest is enough for now
- Worker process — `@opencruit/ingestion` bin currently serves as proto-worker entrypoint
- AI enrichment, notifications, auth

## Parser SDK

- Build iteratively by writing real parsers
- Parsers: RemoteOK (JSON API), WeWorkRemotely (HTML scraping) — **done**, tests passing
- SDK exports: `RawJob` type, `Parser` interface, `rawJobSchema` (Zod), `validateRawJobs()` utility
- `pnpm ingest` runs all parsers sequentially → validates → fingerprints → upserts to DB

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
  ingestion/        # @opencruit/ingestion — ingestion pipeline
  parsers/
    remoteok/       # @opencruit/parser-remoteok — RemoteOK JSON API parser
    weworkremotely/ # @opencruit/parser-weworkremotely — WeWorkRemotely HTML parser
```

Internal packages have no build step — exports point to `./src/index.ts`.
Only npm-published packages (types, parser-sdk) will need tsup build.
