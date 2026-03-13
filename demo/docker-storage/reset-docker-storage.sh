#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing docker-storage demo environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes 2>/dev/null || true

echo "==> Starting logger + redis environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for storage saturation and Redis failure (max 60s)..."
for i in $(seq 1 30); do
  # Check tmpfs usage — BusyBox df: parse Use% column from standard output
  USAGE=$(docker exec storage-logger df /shared 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}' || echo "0")
  if [ "$USAGE" -ge 90 ] 2>/dev/null; then
    # Check Redis health — SET must fail (MISCONF or connection refused)
    REDIS_RESULT=$(docker exec storage-redis redis-cli SET infratest 1 2>&1 || true)
    if echo "$REDIS_RESULT" | grep -qi "MISCONF\|error\|refused\|not connected"; then
      echo "SUCCESS: Storage full (${USAGE}%) and Redis broken"
      exit 0
    fi
  fi
  sleep 2
done

echo "ERROR: Broken state not reached within 60 seconds"
exit 1
