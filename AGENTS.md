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
| Web UI          | SvelteKit (planned)     |
| Database        | PostgreSQL              |
| ORM             | Drizzle                 |
| Linter          | ESLint 10 (flat config) |
| Formatter       | Prettier                |
| License         | AGPL-3.0-only           |

## Monorepo Structure

```
apps/                         # Deployable services (when created)
packages/
  tsconfig/                   # Shared TS configs (base, node, svelte)
  eslint-config/              # Shared ESLint 10 flat configs (base, svelte)
  types/                      # @opencruit/types — shared type definitions
  parsers/                    # Parser plugins (each subdirectory = one parser)
```

## Commands

```bash
pnpm install                  # Install dependencies
pnpm lint                     # ESLint across all packages
pnpm typecheck                # TypeScript check (tsc --noEmit) across all packages
pnpm format                   # Prettier write
pnpm format:check             # Prettier check
pnpm build                    # Build all packages
pnpm dev                      # Dev mode
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

## Architecture Decisions

### Parser System (planned)

- Parsers are HTTP services with 3 endpoints: `/manifest`, `/health`, `/parse`
- Language-agnostic contract (Node/Rust/Go parsers all implement same HTTP interface)
- Orchestrator manages scheduling via BullMQ + Redis
- Ingestion pipeline: normalize → deduplicate → enrich → store → emit event
- Deduplication: fingerprint (sha256 of company+title+location) + fuzzy matching (pg_trgm)

### Event System (planned)

- Redis Streams for job events (job.new, job.updated, job.expired)
- Consumer groups for notification service, search indexer, analytics

### Search (planned)

- MVP: PostgreSQL tsvector with weighted full-text search
- Future: Meilisearch behind `SearchProvider` abstraction

### Self-Hosting

- Single `docker compose up` with PostgreSQL + Redis + app services
- Minimal `.env` configuration
- All features available in self-hosted mode (AGPL, not open-core)

## Dependencies — Version Policy

BEFORE installing any package (runtime, devDependency, @types/\*), search the web for its latest version.
NEVER use versions from memory or training data — they are likely outdated.
This applies to everything: frameworks, tools, plugins, type definitions, eslint configs, etc.
Use `catalog:` protocol — all dependency versions defined in `pnpm-workspace.yaml` catalog section.

## Documentation Maintenance

Keep project documentation up to date as you work:

- Update `AGENTS.md` when monorepo structure, commands, conventions, or architecture decisions change
- Update `docs/CONTEXT.md` when new decisions are made, approaches change, or items become outdated
- Remove stale/incorrect information — do not leave outdated docs behind
- Add new sections when significant architectural decisions are made
- This is not optional — treat docs as part of the deliverable, not an afterthought

## Context

@docs/CONTEXT.md
