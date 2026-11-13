"""Download helper with progress, tolerant of the sandbox's broken schannel curl."""
import os
import sys
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (setup-script)"}


def download(url: str, dest: str, retries: int = 3) -> None:
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print(f"[skip] {dest} ({os.path.getsize(dest)/1e6:.1f} MB)")
        return
    tmp = dest + ".part"
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                t0 = time.time()
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        pct = done * 100 / total
                        speed = done / 1e6 / max(time.time() - t0, 0.01)
                        sys.stdout.write(
                            f"\r  {os.path.basename(dest)}: {pct:5.1f}% "
                            f"{done/1e6:7.1f}/{total/1e6:.1f} MB {speed:6.2f} MB/s"
                        )
                        sys.stdout.flush()
            os.replace(tmp, dest)
            print(f"\n[done] {dest} ({os.path.getsize(dest)/1e6:.1f} MB)")
            return
        except Exception as e:  # noqa: BLE001
            print(f"\n[retry {attempt}/{retries}] {url} -> {e!r}")
            time.sleep(2 * attempt)
    raise SystemExit(f"download failed: {url}")


if __name__ == "__main__":
    download(sys.argv[1], sys.argv[2])
