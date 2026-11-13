"""Client for the llama.cpp embedding server (OpenAI-compatible /v1/embeddings)."""
from __future__ import annotations

import json
import urllib.request

import numpy as np
from fastapi import HTTPException

from .config import EMBED_BATCH, EMBED_DIM, LLAMA_MODEL_ALIAS, LLAMA_URL


def _post_json(url: str, payload: dict, timeout: float) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def embed_texts(texts: list[str], timeout: float = 180.0) -> np.ndarray:
    """Return (n, 768) float32 vectors, L2-normalized."""
    if not texts:
        return np.zeros((0, EMBED_DIM), dtype=np.float32)
    out: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        data = _post_json(
            f"{LLAMA_URL}/v1/embeddings",
            {"model": LLAMA_MODEL_ALIAS, "input": batch, "encoding_format": "float"},
            timeout,
        )
        rows = sorted(data["data"], key=lambda d: d.get("index", 0))
        out.extend(row["embedding"] for row in rows)
    arr = np.asarray(out, dtype=np.float32)
    if arr.shape[1] != EMBED_DIM:
        raise HTTPException(502, f"unexpected embedding dimension: {arr.shape[1]}")
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return arr / norms


def llama_status() -> dict:
    """Health + model facts of the llama-server behind this API."""
    try:
        with urllib.request.urlopen(f"{LLAMA_URL}/health", timeout=3) as resp:
            ok = resp.status == 200
        with urllib.request.urlopen(f"{LLAMA_URL}/v1/models", timeout=3) as resp:
            models = json.loads(resp.read())
        first = (models.get("data") or [{}])[0]
        meta = first.get("meta", {})
        return {
            "ok": ok,
            "url": LLAMA_URL,
            "name": first.get("id"),
            "params": meta.get("n_params"),
            "quant": meta.get("ftype"),
            "n_ctx": meta.get("n_ctx"),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "url": LLAMA_URL, "error": str(exc)[:200]}
