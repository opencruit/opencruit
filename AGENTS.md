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
  worker/                     # @opencruit/worker — BullMQ worker process (HH index/hydrate/refresh/gc)
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
pnpm ingest                   # Run ingestion package (RemoteOK + WWR) → write to DB
pnpm worker                   # Run BullMQ worker (HH index/hydrate/refresh/gc)
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

Not microservices. Two app processes + two infra. One codebase.

- **Web** (SvelteKit) — UI, SSR, API routes, search, auth
- **Worker** (BullMQ consumer) — parser jobs, ingestion pipeline, background tasks
- **PostgreSQL** — primary storage, full-text search (tsvector)
- **Redis** — BullMQ queues, Streams (events), cache
- Deploy: `docker compose up` — 4 containers total

### Parser System

- Parsers are npm packages imported by worker — not HTTP services, not separate containers
- API/HTML parsers implement `Parser` from `@opencruit/parser-sdk` (RemoteOK, WWR)
- HH integration uses 3-phase worker jobs (`hh.index`, `hh.hydrate`, `hh.refresh`) via `@opencruit/parser-hh` helpers
- Light parsers (API/HTML) in one worker pool, Playwright parsers in heavy pool (when needed)
- Ingestion pipeline: normalize → deduplicate → enrich → store → emit event
- Deduplication: fingerprint (sha256 of company+title+location) + fuzzy matching (pg_trgm)

### Events & Search

- Redis Streams for job events (job.new, job.updated, job.expired)
- MVP search: PostgreSQL tsvector. Future: Meilisearch behind abstraction

### Self-Hosting

- Single `docker compose up` — all features available (AGPL, not open-core)
- Minimal `.env` configuration

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
