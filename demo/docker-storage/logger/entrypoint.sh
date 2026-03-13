#!/bin/sh
# Wait briefly for Redis to start and create initial dump.rdb
sleep 3
# Fill tmpfs aggressively — write until disk full (ENOSPC)
# This leaves zero free space, so Redis BGSAVE will fail on next attempt
dd if=/dev/zero of=/shared/bloat.log bs=1K count=10240 2>/dev/null || true
# Keep container alive for docker exec diagnostics
while true; do sleep 60; done
