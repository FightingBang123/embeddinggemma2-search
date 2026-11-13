"""Launcher: `python run.py` (used by deploy/serve-api.cmd)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import run  # noqa: E402

if __name__ == "__main__":
    run()
