#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing permission-trap demo environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

echo "==> Building and starting permission-app..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for Permission Denied error (max 30s)..."
for i in $(seq 1 15); do
  # Check container is running
  STATUS=$(docker inspect --format '{{.State.Status}}' permission-app 2>/dev/null || echo "missing")
  if [ "$STATUS" = "running" ]; then
    # Check logs for Permission Denied
    if docker logs permission-app 2>&1 | grep -q "Permission denied"; then
      echo "SUCCESS: permission-app running with Permission Denied error"
      exit 0
    fi
  fi
  sleep 2
done

echo "ERROR: Broken state not reached within 30 seconds"
exit 1
