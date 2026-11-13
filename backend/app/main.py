"""FastAPI application: documents, search, health and SPA hosting."""
from __future__ import annotations

import asyncio
import hashlib
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import chunking, db as store, embeddings
from .config import (
    API_HOST,
    API_PORT,
    DOC_PREFIX,
    EMBED_DIM,
    MAX_UPLOAD_BYTES,
    PREFIXES,
    WEB_DIST,
)
from .index import INDEX

app = FastAPI(title="EmbeddingGemma 2 Search", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    store.init_db()


# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------
class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=8, ge=1, le=50)
    dim: int = Field(default=768, ge=128, le=768)
    mode: str = Field(default="retrieval", pattern="^(retrieval|similarity|code)$")
    doc_ids: list[str] | None = None


# --------------------------------------------------------------------------
# health / stats
# --------------------------------------------------------------------------
@app.get("/api/health")
def api_health() -> dict:
    stats = store.counts()
    return {
        "ok": True,
        "llama": embeddings.llama_status(),
        "stats": {
            "documents": stats["documents"],
            "chunks": stats["chunks"],
            "last_ingest": stats["last_ingest"],
        },
        "dim": EMBED_DIM,
        "version": app.version,
    }


@app.get("/api/stats")
def api_stats() -> dict:
    stats = store.counts()
    return {k: stats[k] for k in ("documents", "chunks", "chars", "db_mb")}


# --------------------------------------------------------------------------
# documents
# --------------------------------------------------------------------------
@app.get("/api/documents")
def api_documents() -> dict:
    with store.db() as conn:
        rows = conn.execute(
            "SELECT d.id, d.name, d.suffix, d.size, d.chunks, d.created_at, "
            "       COALESCE(SUM(LENGTH(c.text)),0) AS chars "
            "FROM documents d LEFT JOIN chunks c ON c.doc_id = d.id "
            "GROUP BY d.id ORDER BY d.created_at DESC"
        ).fetchall()
    return {"documents": [dict(r) for r in rows]}


@app.delete("/api/documents/{doc_id}")
def api_delete(doc_id: str) -> dict:
    with store.db() as conn:
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "document not found")
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    return {"deleted": doc_id}


@app.post("/api/documents")
async def api_upload(files: list[UploadFile] = File(...)) -> dict:
    results = []
    for upload in files:
        name = upload.filename or "untitled.txt"
        raw = await upload.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            results.append({"name": name, "ok": False, "error": "file too large (25 MB max)"})
            continue
        try:
            text = chunking.extract_text(name, raw)
            chunks = chunking.chunk_text(text)
            if not chunks:
                results.append({"name": name, "ok": False, "error": "no extractable text"})
                continue

            title = Path(name).stem
            payloads = [DOC_PREFIX.format(title=title, text=c) for c in chunks]
            started = time.perf_counter()
            vectors = await asyncio.to_thread(embeddings.embed_texts, payloads)
            embed_ms = (time.perf_counter() - started) * 1000

            doc_id = hashlib.sha1(f"{name}:{len(raw)}:{time.time()}".encode()).hexdigest()[:16]
            created = datetime.now(timezone.utc).isoformat(timespec="seconds")
            with store.db() as conn:
                conn.execute(
                    "INSERT INTO documents(id,name,suffix,size,chunks,created_at) VALUES(?,?,?,?,?,?)",
                    (doc_id, name, Path(name).suffix.lower(), len(raw), len(chunks), created),
                )
                conn.executemany(
                    "INSERT INTO chunks(doc_id,ord,text,vec) VALUES(?,?,?,?)",
                    [
                        (doc_id, i, chunk, vectors[i].astype(np.float32).tobytes())
                        for i, chunk in enumerate(chunks)
                    ],
                )
            results.append(
                {
                    "name": name,
                    "ok": True,
                    "id": doc_id,
                    "chunks": len(chunks),
                    "chars": len(text),
                    "embed_ms": round(embed_ms),
                }
            )
        except HTTPException as exc:
            results.append({"name": name, "ok": False, "error": exc.detail})
        except Exception as exc:  # noqa: BLE001
            results.append({"name": name, "ok": False, "error": str(exc)[:200]})
    return {"results": results}


# --------------------------------------------------------------------------
# search
# --------------------------------------------------------------------------
@app.post("/api/search")
async def api_search(req: SearchRequest) -> dict:
    dim = req.dim - (req.dim % 128) if req.dim % 128 else req.dim
    prompt = PREFIXES[req.mode].format(q=req.query)

    started = time.perf_counter()
    qvec = (await asyncio.to_thread(embeddings.embed_texts, [prompt]))[0]
    embed_ms = (time.perf_counter() - started) * 1000

    hits = INDEX.search(qvec, req.top_k, dim, req.doc_ids)
    texts: dict[int, str] = {}
    if hits:
        placeholders = ",".join("?" * len(hits))
        with store.db() as conn:
            for row in conn.execute(
                f"SELECT id, text FROM chunks WHERE id IN ({placeholders})",
                [h[1] for h in hits],
            ):
                texts[row["id"]] = row["text"]

    results = [
        {
            "score": round(score, 6),
            "chunk_id": chunk_id,
            "doc_id": doc_id,
            "doc_name": doc_name,
            "ord": ord_,
            "text": texts.get(chunk_id, ""),
        }
        for score, chunk_id, doc_id, doc_name, ord_ in hits
    ]
    return {
        "query": req.query,
        "mode": req.mode,
        "dim": dim,
        "results": results,
        "timing": {
            "embed_ms": round(embed_ms),
            "total_ms": round((time.perf_counter() - started) * 1000),
        },
    }


# --------------------------------------------------------------------------
# static SPA (built by build/build.ps1 -> release/web)
# --------------------------------------------------------------------------
if WEB_DIST.exists():
    assets = WEB_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = (WEB_DIST / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(WEB_DIST.resolve())):
            return FileResponse(candidate)
        index = WEB_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse({"error": "release/web not built"}, status_code=404)

else:

    @app.get("/")
    def root() -> dict:
        return {"service": "embeddinggemma2-search", "web": "release/web not built (run build/build.ps1)"}


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host=API_HOST, port=API_PORT, log_level="info")


if __name__ == "__main__":
    run()
