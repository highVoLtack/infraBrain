#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Resetting Permission Trap REMIX Environment ==="

# Tear down any existing remix containers
docker compose -f "$SCRIPT_DIR/docker-compose.remix.yml" down --remove-orphans 2>/dev/null || true

# Rebuild and start
docker compose -f "$SCRIPT_DIR/docker-compose.remix.yml" up -d --build

echo "=== Remix environment started (vault-processor-99) ==="
echo "Container should show Permission Denied for /var/lib/internal/secrets/status.pid"
