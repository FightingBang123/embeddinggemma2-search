"""SQLite storage: schema, connection helper, cheap change token."""
from __future__ import annotations

import sqlite3

from .config import DATA_DIR, DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    suffix      TEXT,
    size        INTEGER NOT NULL,
    chunks      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id   TEXT NOT NULL,
    ord      INTEGER NOT NULL,
    text     TEXT NOT NULL,
    vec      BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
"""


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)


def index_version() -> int:
    """Cheap token that changes whenever chunks change (invalidates the cache)."""
    with db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM chunks"
        ).fetchone()
    return int(row["n"]) * 1_000_000_007 + int(row["m"])


def counts() -> dict:
    with db() as conn:
        docs = conn.execute("SELECT COUNT(*) AS n FROM documents").fetchone()["n"]
        chunks = conn.execute("SELECT COUNT(*) AS n FROM chunks").fetchone()["n"]
        chars = conn.execute("SELECT COALESCE(SUM(LENGTH(text)),0) AS n FROM chunks").fetchone()["n"]
        last = conn.execute("SELECT MAX(created_at) AS t FROM documents").fetchone()["t"]
    db_mb = sum(p.stat().st_size for p in DATA_DIR.glob("app.db*") if p.exists()) / 1e6
    return {
        "documents": docs,
        "chunks": chunks,
        "chars": chars,
        "last_ingest": last,
        "db_mb": round(db_mb, 3),
    }
