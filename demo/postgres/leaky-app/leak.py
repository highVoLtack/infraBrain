"""Connection leak simulator for Postgres max_connections saturation demo."""

import time
import psycopg2

TARGET_CONNECTIONS = 18
RETRY_BACKOFF_SECONDS = 2

connections = []

for i in range(1, TARGET_CONNECTIONS + 1):
    while True:
        try:
            conn = psycopg2.connect(
                host="postgres",
                dbname="postgres",
                user="leaky",
                password="leaky",
            )
            conn.autocommit = True
            connections.append(conn)
            print(f"Connection {i}/{TARGET_CONNECTIONS} established", flush=True)
            break
        except psycopg2.OperationalError as e:
            print(f"Connection {i}/{TARGET_CONNECTIONS} failed: {e} -- retrying in {RETRY_BACKOFF_SECONDS}s", flush=True)
            time.sleep(RETRY_BACKOFF_SECONDS)

print(f"Holding {TARGET_CONNECTIONS} connections open...", flush=True)

while True:
    time.sleep(60)
