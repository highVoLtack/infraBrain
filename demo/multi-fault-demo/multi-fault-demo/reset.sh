#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ">>> tearing down everything..."
docker compose down -v --remove-orphans 2>/dev/null || true
docker compose rm -fsv 2>/dev/null || true

echo ">>> rebuilding from scratch..."
docker compose build --no-cache

echo ">>> starting in broken state..."
docker compose up -d

echo ">>> waiting for services to settle..."
sleep 8

echo ""
echo "=== ENVIRONMENT READY ==="
echo "Proof of failure:  curl -s http://localhost:9000 | jq ."
echo "Expected:          HTTP 503 with error details in JSON body"
echo ""
echo "Container status:"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
