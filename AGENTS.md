# OpenCruit — Agent Instructions

## Project

Open-source job aggregator platform with AI-powered matching. AGPL-3.0 licensed.
See `VISION.md` for full product direction and business model.

## Tech Stack

| Layer           | Technology              |
| --------------- | ----------------------- |
| Package manager | pnpm 10.x (workspaces)  |
| Monorepo        | Turborepo               |
| Runtime         | Node.js 24 LTS          |
| Language        | TypeScript 5.9 (strict) |
| Web UI          | SvelteKit + Svelte 5    |
| Database        | PostgreSQL              |
| ORM             | Drizzle                 |
| Linter          | ESLint 10 (flat config) |
| Formatter       | Prettier                |
| License         | AGPL-3.0-only           |

## Monorepo Structure

```
apps/
  web/                        # @opencruit/web — SvelteKit frontend (Svelte 5, Tailwind 4, shadcn-svelte)
  worker/                     # @opencruit/worker — BullMQ worker process (source.ingest + HH + source.gc)
packages/
  tsconfig/                   # Shared TS configs (base, node, svelte)
  eslint-config/              # Shared ESLint 10 flat configs (base, svelte)
  types/                      # @opencruit/types — shared type definitions
  parser-sdk/                 # @opencruit/parser-sdk — parser contract, types, Zod schema
  db/                         # @opencruit/db — Drizzle schema, client, migrations
  ingestion/                  # @opencruit/ingestion — ingestion pipeline (normalize, validate, dedup, store)
  parsers/
    hh/                       # @opencruit/parser-hh — HH API client, mapper, segments
    remoteok/                 # @opencruit/parser-remoteok — RemoteOK JSON API parser
    weworkremotely/           # @opencruit/parser-weworkremotely — WeWorkRemotely parser
    remotive/                 # @opencruit/parser-remotive — Remotive API parser
    arbeitnow/                # @opencruit/parser-arbeitnow — Arbeitnow API parser
    jobicy/                   # @opencruit/parser-jobicy — Jobicy API parser
    himalayas/                # @opencruit/parser-himalayas — Himalayas API parser
    adzuna/                   # @opencruit/parser-adzuna — Adzuna API parser
    jooble/                   # @opencruit/parser-jooble — Jooble API parser
    greenhouse/               # @opencruit/parser-greenhouse — Greenhouse job board parser
    lever/                    # @opencruit/parser-lever — Lever postings parser
    smartrecruiters/          # @opencruit/parser-smartrecruiters — SmartRecruiters postings parser
```

## Commands

```bash
pnpm install                  # Install dependencies
pnpm lint                     # ESLint across all packages
pnpm typecheck                # TypeScript check (tsc --noEmit) across all packages
pnpm test                     # Run tests (vitest) across all packages
pnpm format                   # Prettier write
pnpm format:check             # Prettier check
pnpm build                    # Build all packages
pnpm dev                      # Dev mode
pnpm dev:infra                # Start local infra for hybrid dev (postgres+redis+migrate+worker+prometheus+grafana) and stop containerized web
pnpm dev:web                  # Start web Vite dev server (HMR) against localhost Postgres
pnpm dev:hybrid               # Start infra then run web dev
pnpm worker                   # Run BullMQ worker (source.ingest + hh.* + source.gc)
pnpm stack:bootstrap          # Build/start full docker stack + healthcheck
pnpm stack:health             # Validate docker stack health
pnpm stack:logs               # Tail worker/web logs from docker stack
pnpm stack:logs:obs           # Tail worker/prometheus/grafana logs from docker stack
pnpm stack:metrics            # Print worker Prometheus snapshot from localhost
pnpm stack:report             # Print source health/status report from worker container
pnpm stack:ingest:once       # Enqueue one-off source.ingest jobs in docker stack
pnpm stack:down               # Stop docker stack
```

## Conventions

### Code Style

- TypeScript strict mode, no `any`
- ESLint 10 flat config — root `eslint.config.mjs` extends `@opencruit/eslint-config/base`
- SvelteKit apps use `@opencruit/eslint-config/svelte`
- Prettier: 120 chars, single quotes, semicolons, trailing commas

### Package Structure

- Internal packages use `"exports": { ".": { "types": "./src/index.ts" } }` — no build step
- Only packages published to npm need a build step (tsup)
- Each package has `lint` and `typecheck` scripts
- Turborepo runs tasks via `turbo run <task>`

### TypeScript

- Shared configs in `packages/tsconfig/` — `base.json`, `node.json`, `svelte.json`
- All packages extend from shared configs
- `projectService: true` in ESLint for automatic tsconfig discovery

### Git

- Short, one-line commit messages: `add parser sdk`, `fix dedup logic`
- No multi-line descriptions, no bullet points, no co-author tags
- Branch naming: `feat/<name>`, `fix/<name>`

### Verification (mandatory)

- ALWAYS run `pnpm lint` and `pnpm typecheck` on packages you touched before considering work done
- Never skip this — catch regressions immediately, not after commit
- If tests exist, run them too: `pnpm test --filter=<package>`
- This is not optional. Every change must pass lint + typecheck before moving on

### New Packages

- Do NOT create packages/files that are not immediately needed
- Only scaffold what is being actively worked on
- Package naming: `@opencruit/<name>`

## Architecture — Modular Monolith

Not microservices. Two app processes + infra services. One codebase.

- **Web** (SvelteKit) — UI, SSR, API routes, search, auth
- **Worker** (BullMQ consumer) — parser jobs, ingestion pipeline, background tasks
- **PostgreSQL** — primary storage, full-text search (tsvector)
- **Redis** — BullMQ queues
- **Prometheus** — metrics scraping + alert rule evaluation
- **Grafana** — operational dashboards
- Deploy: `docker compose up` — 6 long-running containers (`postgres`, `redis`, `worker`, `web`, `prometheus`, `grafana`) + 1 one-shot migration container (`migrate`)

### Parser System

- Parsers are npm packages imported by worker — not HTTP services, not separate containers
- Batch parsers implement `Parser` from `@opencruit/parser-sdk` via `defineParser` (RemoteOK, WWR, Remotive, Arbeitnow, Jobicy, Himalayas, Adzuna, Jooble, Greenhouse, Lever, SmartRecruiters)
- Sources are registered in worker source catalog via `defineSource` (batch + workflow)
- Batch sources are orchestrated by worker job `source.ingest` (schedule override via `SOURCE_SCHEDULE_<SOURCE_ID>`)
- Source-level requirements are validated in scheduler (`requiredEnv`, `enabledWhen`); misconfigured sources are disabled without breaking other sources
- ATS target lists are kept in worker TS modules under `apps/worker/src/sources/targets/*`
- HH integration uses workflow source contract and 3-phase jobs (`hh.index`, `hh.hydrate`, `hh.refresh`) via `@opencruit/parser-hh` helpers
- Lifecycle cleanup is handled by generic worker job `source.gc` with per-source retention policy
- Worker emits structured JSON logs (pino) via worker lifecycle hooks (`active`, `completed`, `failed`) with `traceId` propagation
- Worker persists per-source runtime health in PostgreSQL `source_health` (`last_success_at`, `last_error_at`, `consecutive_failures`)
- Worker exposes Prometheus metrics at `/metrics` (queue states + source health + worker uptime)
- Grafana provisioned dashboards include `OpenCruit Worker Overview` and `OpenCruit PM Overview`
- Source definitions include pool hint (`light` | `heavy`) for future heavy parsers; current worker runtime uses single process concurrency
- Ingestion pipeline: validate → normalize → fingerprint → deduplicate → store
- Deduplication: fingerprint (sha256 of company+title+location) with first-source-wins conflict policy

### Events & Search

- MVP search: PostgreSQL tsvector. Future: Meilisearch behind abstraction

### Self-Hosting

- Single `docker compose up -d --build` — all features available (AGPL, not open-core)
- Local hybrid dev uses `docker-compose.dev.yml` for host Postgres port (`pnpm dev:infra` + `pnpm dev:web`)
- Migrations run as one-shot `migrate` service (`pnpm --filter @opencruit/db db:migrate`) before `worker`/`web`
- `db:push` is local prototyping only; production path is versioned SQL migrations in `packages/db/drizzle`
- Operational runbooks: `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/OBSERVABILITY.md`, `docs/TROUBLESHOOTING.md`

## Dependencies — Version Policy

BEFORE installing any package (runtime, devDependency, @types/*), search the web for its latest version.
NEVER use versions from memory or training data — they are likely outdated.
This applies to everything: frameworks, tools, plugins, type definitions, eslint configs, etc.
Use `catalog:` protocol — all dependency versions defined in `pnpm-workspace.yaml` catalog section.

## Documentation Maintenance

Keep project documentation up to date as you work:

- Update `AGENTS.md` (symlinked to `CLAUDE.md`) when monorepo structure, commands, conventions, or architecture decisions change
- Update `docs/CONTEXT.md` when new decisions are made, approaches change, or items become outdated
- Remove stale/incorrect information — do not leave outdated docs behind
- Add new sections when significant architectural decisions are made
- This is not optional — treat docs as part of the deliverable, not an afterthought

## Context

@docs/CONTEXT.md
