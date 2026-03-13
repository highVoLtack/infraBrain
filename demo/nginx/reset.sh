#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Tearing down existing demo environment..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down --remove-orphans 2>/dev/null || true

echo "==> Starting broken Nginx/httpbin environment..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "==> Waiting 3 seconds for Nginx startup..."
sleep 3

echo "==> Verifying broken state (expecting 502)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "502" ]; then
  echo "SUCCESS: Nginx returns 502 Bad Gateway as expected (network isolation confirmed)"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "WARNING: Could not connect to localhost:8080 -- Nginx may still be starting"
else
  echo "WARNING: Expected HTTP 502 but got $HTTP_CODE -- environment may not be in broken state"
fi
