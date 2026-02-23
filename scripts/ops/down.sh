#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd docker

cd_root

log 'Stopping stack...'
docker compose down

log 'Stack stopped.'
