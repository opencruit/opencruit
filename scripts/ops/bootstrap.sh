#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd docker

cd_root

log 'Building images and starting full stack (postgres, redis, migrate, worker, web)...'
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

log 'Bootstrap completed.'
