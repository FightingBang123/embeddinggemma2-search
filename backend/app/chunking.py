"""Text extraction and paragraph-aware chunking."""
from __future__ import annotations

import io
import re
from pathlib import Path

from fastapi import HTTPException

from .config import CHUNK_CHARS, CHUNK_OVERLAP, TEXT_SUFFIXES

_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")


def decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_text(name: str, raw: bytes) -> str:
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    if suffix and suffix not in TEXT_SUFFIXES:
        raise HTTPException(415, f"unsupported file type: {suffix}")
    return decode_bytes(raw)


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Paragraph-aware chunks; markdown headings are kept as leading context."""
    text = _normalize(text)
    if not text:
        return []
    if len(text) <= size:
        return [text]

    blocks: list[tuple[str, str]] = []
    heading = ""
    buf: list[str] = []

    def flush() -> None:
        if buf:
            blocks.append((heading, "\n".join(buf).strip()))
            buf.clear()

    for line in text.split("\n"):
        m = _HEADING.match(line)
        if m:
            flush()
            heading = m.group(2).strip()
            continue
        if not line.strip():
            flush()
            continue
        buf.append(line)
    flush()

    chunks: list[str] = []
    current = ""
    for head, body in blocks:
        piece = (f"{head}\n{body}" if head else body).strip()
        if not piece:
            continue
        if len(current) + len(piece) + 2 <= size:
            current = f"{current}\n\n{piece}".strip()
            continue
        if current:
            chunks.append(current)
        if len(piece) <= size:
            current = piece
            continue
        # oversized block: prefer structure (\n\n, newline, sentence enders) over char count
        start = 0
        while start < len(piece):
            end = min(start + size, len(piece))
            if end < len(piece):
                floor = start + max(int(size * 0.55), 1)
                for pat in ("\n\n", "\n", "。", "！", "？", ". ", "; "):
                    cut = piece.rfind(pat, floor, end)
                    if cut > 0:
                        end = cut + len(pat)
                        break
            body_slice = piece[start:end].strip()
            if body_slice:
                chunks.append(body_slice)
            if end >= len(piece):
                break
            start = end
        current = ""
    if current:
        chunks.append(current)

    # line-aligned tail overlap so code is never cut mid-token
    if overlap > 0 and len(chunks) > 1:
        merged = [chunks[0]]
        for prev, nxt in zip(chunks, chunks[1:]):
            tail = prev[-overlap:]
            nl = tail.find("\n")
            if nl >= 0:
                tail = tail[nl + 1 :]
            merged.append((tail + "\n" + nxt).strip() if tail and not nxt.startswith(tail) else nxt)
        chunks = merged
    return [c for c in chunks if c.strip()]
