# OpenCruit Deployment Runbook

This runbook is for a clean server where you want a full stack with one command.

## What gets started

`docker compose up -d --build` now starts:

- `postgres` (database)
- `redis` (queue backend)
- `migrate` (one-shot DB migration job)
- `worker` (parsers + ingestion + GC)
- `web` (SvelteKit app on `http://localhost:3000`)

## Prerequisites

- Docker Engine + Docker Compose plugin
- Git checkout of this repository

## First start (clean server)

```bash
bash ./scripts/ops/bootstrap.sh
```

This command:

1. builds images,
2. starts all services,
3. runs DB migrations via `migrate`,
4. validates stack health.

## Daily start/stop

Start:

```bash
docker compose up -d --build
```

Stop:

```bash
bash ./scripts/ops/down.sh
```

## Update rollout

When you pull new code:

```bash
git pull
docker compose up -d --build
bash ./scripts/ops/healthcheck.sh
```

The migration service runs on each deploy and applies new SQL migrations before `web`/`worker` start.

## Migration policy

- Production path: `db:generate` + committed SQL in `packages/db/drizzle/*` + `db:migrate` on deploy.
- Local emergency/prototyping only: `db:push`.
- Do not use `db:push` in production.
- `db:migrate` includes a one-time compatibility bootstrap for old DBs that were created with `db:push` before migration files existed.
