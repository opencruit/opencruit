# Worker Logging Runbook

Structured worker logs use JSON lines via `pino` and are written to stdout.
Telemetry is attached via BullMQ worker lifecycle hooks (`active`, `completed`, `failed`) and stays outside business handlers.

## Configuration

Environment variables:

- `LOG_LEVEL` (`trace|debug|info|warn|error|fatal|silent`, default: `info`)
- `LOG_SERVICE_NAME` (default: `opencruit-worker`)

## Event Model

Each queue job emits:

- `job_started`
- `job_completed`
- `job_failed`

Common fields:

- `ts`, `level`, `service`, `event`, `message`
- `queue`, `jobName`, `jobId`, `attempt`
- `traceId`
- `waitMs` (start event), `durationMs` (completed/failed)

Queue-specific fields are included in the same record (`sourceId`, `vacancyId`, etc.).

## Persistent Health State

Worker also writes durable health rows to PostgreSQL table `source_health` keyed by `(source_id, stage)`:

- `status` (`healthy` or `failing`)
- `last_run_at`, `last_success_at`, `last_error_at`
- `consecutive_failures`
- `last_duration_ms`
- `last_error`
- `created_at`, `updated_at`

This allows tracking source health even after process restarts or log rotation.

## Debug Commands

Docker stack (recommended):

```bash
docker compose logs -f worker
```

Docker stack + jq:

```bash
docker compose logs -f worker | jq
```

Host process mode:

Run worker and pretty-print:

```bash
pnpm worker | jq
```

Only errors:

```bash
pnpm worker | jq 'select(.level=="error")'
```

Trace one chain:

```bash
pnpm worker | jq 'select(.traceId=="<trace-id>")'
```

Only HH hydrate failures:

```bash
pnpm worker | jq 'select(.queue=="hh.hydrate" and .event=="job_failed")'
```

## Practical Debug Flows

No fresh jobs from a source:

1. Filter by `queue=="source.ingest"` and `sourceId`.
2. Check latest `job_completed` and `errorsCount`.
3. If failures exist, inspect `job_failed.error`.

HH refresh not updating:

1. Check `hh.refresh` `job_completed` (`selected`, `enqueued`).
2. Follow `traceId` into `hh.hydrate`.
3. Inspect hydrate status (`active|archived|missing`) and failures.

Unexpected cleanup behavior:

1. Filter `queue=="source.gc"`.
2. Inspect `mode`, `sourceId`, `archived`, `deleted`.
3. Correlate with source policy in `apps/worker/src/jobs/source-gc-policy.ts`.
