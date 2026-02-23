# OpenCruit Troubleshooting

## 1) `web` is not reachable on port 3000

Check container status:

```bash
docker compose ps
```

If `web` is not running:

```bash
docker compose logs --tail=200 web
docker compose up -d --build web
```

## 2) Worker is running but jobs do not grow

Run report:

```bash
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/source-report.ts
```

Force one manual ingest pass:

```bash
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/enqueue-batch.ts
```

Then inspect worker logs:

```bash
docker compose logs --tail=300 worker
```

## 3) Migration failed

Inspect migration logs:

```bash
docker compose logs --tail=300 migrate
```

Retry full startup:

```bash
docker compose down
docker compose up -d --build
```

## 4) Redis or Postgres health check fails

Check service logs:

```bash
docker compose logs --tail=200 postgres
docker compose logs --tail=200 redis
```

Restart service:

```bash
docker compose restart postgres redis
bash ./scripts/ops/healthcheck.sh
```

## 5) Need clean local reset (destructive)

Warning: deletes local DB and queue data.

```bash
docker compose down -v
docker compose up -d --build
bash ./scripts/ops/healthcheck.sh
```
