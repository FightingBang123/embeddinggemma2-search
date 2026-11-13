"""Poll a local URL until it returns 200. Exit 0 = ready, 1 = timeout.

Usage: python deploy/health.py <port> <path> [timeout_seconds]
"""
import sys
import time
import urllib.request

port = sys.argv[1] if len(sys.argv) > 1 else "8000"
path = sys.argv[2] if len(sys.argv) > 2 else "/api/health"
timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
url = f"http://127.0.0.1:{port}{path}"

deadline = time.time() + timeout
while True:
    try:
        with urllib.request.urlopen(url, timeout=1.5) as resp:
            if resp.status == 200:
                sys.exit(0)
    except Exception:  # noqa: BLE001
        pass
    if time.time() >= deadline:
        sys.exit(1)
    time.sleep(0.4)
