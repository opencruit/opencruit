# OpenCruit Operations Runbook

This is a PM-friendly day-to-day operations guide.

## Quick commands

Bootstrap stack:

```bash
bash ./scripts/ops/bootstrap.sh
```

Health check:

```bash
bash ./scripts/ops/healthcheck.sh
```

Stop stack:

```bash
bash ./scripts/ops/down.sh
```

Live logs (`worker` + `web`):

```bash
docker compose logs -f worker web
```

Jobs report by source:

```bash
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/source-report.ts
```

Force one manual ingest run for all batch sources:

```bash
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/enqueue-batch.ts
```

Force one manual ingest run for selected sources:

```bash
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/enqueue-batch.ts remoteok weworkremotely
```

## Healthy state checklist

A healthy stack means:

1. `docker compose ps` shows `postgres`, `redis`, `worker`, `web` as `running`.
2. `migrate` is `exited (0)`.
3. `bash ./scripts/ops/healthcheck.sh` exits successfully.
4. `source-report` shows non-zero job counts for active sources.
5. worker logs contain periodic `job_completed` events.

## Cadence recommendation

- After deploy: run healthcheck once.
- Daily: run healthcheck once.
- If vacancy count drops unexpectedly: run manual ingest once and inspect logs.

## Data quality monitoring

Watch for:

- frequent `job_failed` in worker logs,
- repeated non-zero `consecutive_failures` in `source_health`,
- sudden drop of total jobs/source jobs.
