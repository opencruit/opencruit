#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd docker
require_cmd curl

cd_root

wait_http_ready() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-2}"

  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  return 1
}

log 'Checking running services...'
for service in postgres redis worker web prometheus grafana; do
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
if ! wait_http_ready 'http://localhost:3000'; then
  log 'Web endpoint is not ready on http://localhost:3000'
  exit 1
fi

log 'Checking worker metrics endpoint...'
if ! wait_http_ready 'http://localhost:9464/metrics'; then
  log 'Worker metrics endpoint is not ready on http://localhost:9464/metrics'
  exit 1
fi
if ! curl -fsS 'http://localhost:9464/metrics' | grep -q 'opencruit_worker_up'; then
  log 'Worker metrics endpoint does not expose opencruit_worker_up'
  exit 1
fi

log 'Checking Prometheus endpoint...'
if ! wait_http_ready 'http://localhost:9090/-/ready'; then
  log 'Prometheus endpoint is not ready on http://localhost:9090/-/ready'
  exit 1
fi

log 'Checking Grafana endpoint...'
if ! wait_http_ready 'http://localhost:3001/api/health'; then
  log 'Grafana endpoint is not ready on http://localhost:3001/api/health'
  exit 1
fi

log 'Collecting source report...'
docker compose exec -T worker pnpm exec tsx /app/scripts/ops/source-report.ts

log 'Healthcheck passed.'
