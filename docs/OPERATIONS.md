# OpenCruit Operations Runbook

This is a PM-friendly day-to-day operations guide.

## Quick commands

Bootstrap stack:

```bash
bash ./scripts/ops/bootstrap.sh
```

Hybrid local dev (recommended for frontend work):

```bash
pnpm dev:infra
pnpm dev:web
```

`pnpm dev:infra` uses `docker-compose.dev.yml` to expose Postgres + Redis on localhost for local web SSR/admin and stops containerized `web` to avoid confusion with `localhost:3000`.
It also starts `prometheus` (`http://localhost:9090`) and `grafana` (`http://localhost:3001`) for local observability.
Use `http://localhost:5973` for local HMR UI.

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

Live observability logs (`worker` + `prometheus` + `grafana`):

```bash
docker compose logs -f worker prometheus grafana
```

Worker metrics snapshot:

```bash
curl -fsS http://localhost:9464/metrics
```

Prometheus UI:

```text
http://localhost:9090
```

Grafana UI:

```text
http://localhost:3001
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

Full dev reset (wipe Postgres + Redis volumes and start from clean state):

```bash
docker compose down -v
docker compose up -d --build
```

## Healthy state checklist

A healthy stack means:

1. `docker compose ps` shows `postgres`, `redis`, `worker`, `web`, `prometheus`, `grafana` as `running`.
2. `migrate` is `exited (0)`.
3. `bash ./scripts/ops/healthcheck.sh` exits successfully.
4. `source-report` shows non-zero job counts for active sources.
5. worker logs contain periodic `job_completed` events.
6. `curl http://localhost:9464/metrics` contains `opencruit_worker_up 1`.

## Cadence recommendation

- After deploy: run healthcheck once.
- Daily: run healthcheck once.
- If vacancy count drops unexpectedly: run manual ingest once and inspect logs.

## Data quality monitoring

Watch for:

- frequent `job_failed` in worker logs,
- repeated non-zero `consecutive_failures` in `source_health`,
- sudden drop of total jobs/source jobs.

HH queue pressure controls:

- `HH_BOOTSTRAP_INDEX_NOW=false` avoids full HH bootstrap on every worker restart.
- `HH_HYDRATE_MAX_BACKLOG=5000` enables index backpressure when hydrate queue is overloaded.

## Observability quick usage

- Open Grafana: `http://localhost:3001` (default local credentials: `admin` / `admin`)
- Dashboards:
  - `OpenCruit / OpenCruit Worker Overview` (operations)
  - `OpenCruit / OpenCruit PM Overview` (product KPIs)
- Open Prometheus: `http://localhost:9090`
- Core metric labels:
  - `queue` + `state` on `opencruit_queue_jobs`
  - `source_id` + `stage` on source health metrics
