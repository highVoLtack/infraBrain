import os
import sys
import time

data_dir = os.environ.get('DATA_DIR', '/app/data')
pid_path = os.path.join(data_dir, 'status.pid')
print(f"Writing PID to {pid_path}...")

try:
    with open(pid_path, "w") as f:
        f.write(str(os.getpid()))
    print(f"PID {os.getpid()} written successfully.")
except PermissionError as e:
    print(f"FATAL: Permission denied writing to {pid_path}: {e}", file=sys.stderr)
    # Don't exit -- stay alive for diagnostics (docker exec)
    print("Entering idle loop for diagnostic access...", file=sys.stderr)
    while True:
        time.sleep(60)
