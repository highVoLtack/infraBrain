# Multi-Fault Infrastructure Demo

A 5-service Docker Compose environment that is **intentionally broken** on multiple infrastructure layers simultaneously.

## Architecture

```
Internet → :9000 → [gw-edge-01] → [app-core-01] → [pg-store-01]
                                        ↓               
                                  [wk-proc-01] ← → [kv-cache-01]
```

| Container     | Role              | Image Base        |
|---------------|-------------------|-------------------|
| gw-edge-01    | Reverse proxy     | nginx:1.25-alpine |
| app-core-01   | Application API   | python:3.11-slim  |
| wk-proc-01    | Background worker | python:3.11-slim  |
| pg-store-01   | Database          | postgres:16-alpine|
| kv-cache-01   | Cache / Queue     | redis:7-alpine    |

## Quick Start

```bash
cd multi-fault-demo
chmod +x reset.sh
./reset.sh
```

## Proof of Failure

```bash
# Should return HTTP 503 with JSON body showing errors:
curl -s http://localhost:9000 | jq .

# Check container states:
docker compose ps
```

Expected: `curl` returns a **503** with a JSON body containing error messages across `db`, `cache`, and `worker` fields. After repeated curls, `app-core-01` will eventually stop responding entirely.

## Proof of Success

The environment is fully fixed when **all** of the following are true:

1. `curl -s http://localhost:9000 | jq .` returns **HTTP 200** with:
   ```json
   {
     "db": "ok",
     "cache": "ok",
     "worker": {
       "redis": "ok",
       "spool": "ok",
       "status": "ok"
     }
   }
   ```
2. All 5 containers are **running** and stay running (`docker compose ps` shows `Up` for each).
3. Running `curl` 20 times in a row does **not** crash or kill any container.

## Notes

- 100% local, no external dependencies.
- All faults are at the infrastructure / OS / Docker / network layer.
- Application source code is straightforward and correct — don't look for bugs there.
