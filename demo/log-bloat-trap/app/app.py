import os
import sys
import time

log_dir = os.environ.get('LOG_DIR', '/app/logs')
log_path = os.path.join(log_dir, 'app.log')

print(f"Starting log writer to {log_path}...")

try:
    # Write a bloated log file (fills up the tmpfs quickly)
    with open(log_path, "a") as f:
        for i in range(50000):
            f.write(f"ERROR [{time.strftime('%Y-%m-%d %H:%M:%S')}] Connection pool exhausted, retrying query #{i} with backoff strategy alpha-{i % 7}\n")
            f.flush()
    print(f"Log file bloated to {os.path.getsize(log_path)} bytes", file=sys.stderr)
except OSError as e:
    print(f"FATAL: Disk full writing to {log_path}: {e}", file=sys.stderr)

# Now try to write state — this will fail because disk is full
state_path = os.path.join(log_dir, 'state.json')
try:
    with open(state_path, "w") as f:
        f.write('{"status": "healthy", "pid": ' + str(os.getpid()) + '}')
    print(f"State written to {state_path}")
except OSError as e:
    print(f"FATAL: Cannot write state to {state_path}: {e}", file=sys.stderr)
    print("Application stuck — disk full, cannot write state.", file=sys.stderr)
    while True:
        time.sleep(60)
