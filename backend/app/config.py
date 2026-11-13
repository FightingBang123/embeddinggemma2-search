"""Paths, model settings and prompt templates — single source of truth."""
from __future__ import annotations

import os
from pathlib import Path

# backend/app/config.py -> backend/ -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIR = PROJECT_ROOT / "release"
WEB_DIST = RELEASE_DIR / "web"
DATA_DIR = Path(os.environ.get("DATA_DIR", PROJECT_ROOT / "data"))
DB_PATH = DATA_DIR / "app.db"

LLAMA_URL = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080").rstrip("/")
LLAMA_MODEL_ALIAS = os.environ.get("LLAMA_MODEL_ALIAS", "embeddinggemma2")

API_HOST = os.environ.get("HOST", "127.0.0.1")
API_PORT = int(os.environ.get("PORT", "8000"))

EMBED_DIM = 768
EMBED_BATCH = 16
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

CHUNK_CHARS = 900
CHUNK_OVERLAP = 120

DOC_PREFIX = "title: {title} | text: {text}"
PREFIXES = {
    "retrieval": "task: search result | query: {q}",
    "similarity": "task: sentence similarity | sentence: {q}",
    "code": "task: code retrieval | query: {q}",
}

TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".csv", ".json", ".yaml", ".yml",
    ".log", ".ini", ".toml", ".html", ".htm", ".xml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs", ".c", ".h",
    ".cpp", ".hpp", ".cs", ".rb", ".php", ".sh", ".ps1", ".sql", ".kt",
}
