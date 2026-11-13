"""In-memory vector cache over SQLite blobs + cosine top-k."""
from __future__ import annotations

import threading

import numpy as np

from .config import EMBED_DIM
from .db import db, index_version


class VectorIndex:
    """Brute-force cosine index; fine up to ~100k chunks on one machine."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._version = -1
        self._ids: np.ndarray = np.zeros(0, dtype=np.int64)
        self._mat: np.ndarray = np.zeros((0, EMBED_DIM), dtype=np.float32)
        self._meta: list[tuple[str, str, int]] = []  # doc_id, doc_name, ord

    def _load(self, version: int) -> None:
        conn_row = db().execute(
            "SELECT c.id, c.doc_id, c.ord, c.vec, d.name FROM chunks c "
            "JOIN documents d ON d.id = c.doc_id ORDER BY c.id"
        ).fetchall()
        self._ids = np.array([r["id"] for r in conn_row], dtype=np.int64)
        if conn_row:
            self._mat = np.vstack([np.frombuffer(r["vec"], dtype=np.float32) for r in conn_row])
        else:
            self._mat = np.zeros((0, EMBED_DIM), dtype=np.float32)
        self._meta = [(r["doc_id"], r["name"], r["ord"]) for r in conn_row]
        self._version = version

    def search(
        self,
        query_vec: np.ndarray,
        top_k: int,
        dim: int,
        doc_ids: list[str] | None = None,
    ) -> list[tuple[float, int, str, str, int]]:
        version = index_version()
        with self._lock:
            if version != self._version:
                self._load(version)
            ids, mat, meta = self._ids, self._mat, self._meta
        if mat.shape[0] == 0:
            return []

        q = query_vec[:dim].copy()
        q /= max(np.linalg.norm(q), 1e-9)
        sub = mat[:, :dim].copy()
        sub /= np.maximum(np.linalg.norm(sub, axis=1, keepdims=True), 1e-9)
        scores = sub @ q

        if doc_ids:
            wanted = set(doc_ids)
            keep = np.array([m[0] in wanted for m in meta], dtype=bool)
            scores = np.where(keep, scores, -np.inf)

        k = min(top_k, scores.shape[0])
        idx = np.argpartition(-scores, k - 1)[:k]
        idx = idx[np.argsort(-scores[idx])]
        return [
            (float(scores[i]), int(ids[i]), *meta[i])
            for i in idx
            if np.isfinite(scores[i])
        ]


INDEX = VectorIndex()
