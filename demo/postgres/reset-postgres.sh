#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing Postgres demo environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

echo "==> Starting Postgres + leaky-app environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for connection saturation (max 60s)..."
for i in $(seq 1 30); do
  OUTPUT=$(docker exec postgres-demo psql -U leaky -d postgres -c "SELECT 1" 2>&1 || true)
  if echo "$OUTPUT" | grep -qi "too many"; then
    echo "SUCCESS: Postgres connection limit reached"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Broken state not reached within 60 seconds"
exit 1
