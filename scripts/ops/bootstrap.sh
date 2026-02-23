#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd docker

cd_root

log 'Building images and starting full stack (postgres, redis, migrate, worker, web, prometheus, grafana)...'
docker compose up -d --build

log 'Waiting for web on http://localhost:3000 ...'
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:3000" >/dev/null 2>&1; then
    log 'Web is reachable.'
    break
  fi
  sleep 2
done

log 'Running healthcheck...'
bash "$ROOT_DIR/scripts/ops/healthcheck.sh"

log 'Service URLs:'
log '  Web:        http://localhost:3000'
log '  Worker:     http://localhost:9464/metrics'
log '  Prometheus: http://localhost:9090'
log '  Grafana:    http://localhost:3001 (admin/admin by default)'

log 'Bootstrap completed.'
