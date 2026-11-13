"""Ingest the sample corpus into the running backend (multipart upload)."""
import io
import json
import mimetypes
import sys
import time
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8000"


def upload(path: Path, retries: int = 60):
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(path.name)[0] or "text/plain"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="files"; filename="{path.name}"\r\n'.encode())
    body.write(f"Content-Type: {ctype}\r\n\r\n".encode())
    body.write(path.read_bytes())
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        BASE + "/api/documents",
        data=body.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    for _ in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read())
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.5)
    raise SystemExit(f"upload failed: {last}")


def main():
    files = sorted(Path("samples").glob("*.*"))
    for f in files:
        out = upload(f)
        for r in out["results"]:
            if r["ok"]:
                print(f"  ok   {r['name']:22s} chunks={r['chunks']:2d} chars={r['chars']:5d} embed={r['embed_ms']}ms")
            else:
                print(f"  FAIL {r['name']}: {r['error']}")
    with urllib.request.urlopen(BASE + "/api/stats", timeout=10) as r:
        print("stats:", json.loads(r.read()))


if __name__ == "__main__":
    sys.exit(main())
