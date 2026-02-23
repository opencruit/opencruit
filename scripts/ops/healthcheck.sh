#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd docker
require_cmd curl

cd_root

log 'Checking running services...'
for service in postgres redis worker web; do
  if ! docker compose ps --services --status running | grep -qx "$service"; then
    log "Service is not running: $service"
    docker compose ps
    exit 1
  fi
done

if ! docker compose ps --services --status exited | grep -qx 'migrate'; then
  log 'Migration service is not in exited state (expected one-shot completion).'
  docker compose ps
  exit 1
fi

log 'Checking postgres readiness...'
docker compose exec -T postgres pg_isready -U opencruit -d opencruit >/dev/null

log 'Checking redis readiness...'
if [[ "$(docker compose exec -T redis redis-cli ping | tr -d '\r')" != 'PONG' ]]; then
  log 'Redis ping failed.'
  exit 1
fi

log 'Checking web endpoint...'
curl -fsS 'http://localhost:3000' >/dev/null

log 'Collecting source report...'
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/source-report.ts

log 'Healthcheck passed.'
