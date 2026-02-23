# OpenCruit Observability

PM-friendly guide for what you can monitor in real time.

## URLs

- Web: `http://localhost:3000`
- Worker metrics: `http://localhost:9464/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

Grafana local defaults:

- user: `admin`
- password: `admin`

## What you can see now

1. Queue state by stage (`wait`, `active`, `delayed`, `completed`, `failed`, `paused`)
2. Source health by stage (`healthy` / `failing`)
3. Consecutive failures per source stage
4. Last duration and last run time for each source stage
5. Worker uptime and liveness
6. PM KPIs: active jobs, new jobs (24h), coverage ratios, source distribution

## Dashboard

Grafana auto-loads:

- Folder: `OpenCruit`
- Dashboard: `OpenCruit Worker Overview`
- Dashboard: `OpenCruit PM Overview`

`OpenCruit PM Overview` focuses on product-level numbers:

- `Active Jobs`
- `New Jobs (24h)`
- `Salary Coverage`
- `Location Coverage`
- `New Jobs 24h By Source`
- `Active Jobs By Source`

## Alert rules (Prometheus)

Built-in rules (visible in Prometheus Alerts page):

- `OpenCruitSourceFailing`
- `OpenCruitHydrateBacklogHigh`
- `OpenCruitIngestBacklogHigh`

## Important note on priorities

Current worker queues do not use custom BullMQ per-job priorities yet.
You still get queue depth and failures by queue/state, which is enough for first-stage operations.
