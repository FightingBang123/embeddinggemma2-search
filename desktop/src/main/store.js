'use strict';
/**
 * 向量库：documents 元数据 (index.json) + 块文本 (chunks.jsonl) + 向量 (vectors.f32)。
 * 追加写、内存索引；删除时重写三个文件（原子 rename）。
 */
const fs = require('node:fs');
const path = require('node:path');

const DIM = 768;

class VectorStore {
  constructor(paths) {
    this.paths = paths;
    this.docs = new Map();
    this.chunks = []; // { docId, docName, ord, text }
    this.vectors = new Float32Array(0);
    this._load();
  }

  _load() {
    const { dbFile, chunksFile, vectorsFile } = this.paths;

    if (fs.existsSync(dbFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        for (const doc of raw.documents || []) this.docs.set(doc.id, doc);
      } catch (err) {
        console.error('[store] failed to read index.json:', err.message);
      }
    }

    if (fs.existsSync(chunksFile)) {
      const lines = fs.readFileSync(chunksFile, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.chunks.push(JSON.parse(line));
        } catch {
          /* skip corrupt line */
        }
      }
    }

    if (fs.existsSync(vectorsFile)) {
      const buf = fs.readFileSync(vectorsFile);
      const count = Math.floor(buf.length / (DIM * 4));
      this.vectors = new Float32Array(count * DIM);
      new Uint8Array(this.vectors.buffer).set(buf.subarray(0, count * DIM * 4));
    }

    const expected = this.chunks.length * DIM;
    if (this.vectors.length !== expected) {
      console.warn(`[store] vector count mismatch (${this.vectors.length / DIM} vs ${this.chunks.length}), truncating`);
      this.chunks = this.chunks.slice(0, Math.floor(this.vectors.length / DIM));
    }
    console.log(`[store] loaded ${this.docs.size} docs / ${this.chunks.length} chunks`);
  }

  _writeIndex() {
    const payload = { version: 1, dim: DIM, documents: [...this.docs.values()] };
    const tmp = `${this.paths.dbFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, this.paths.dbFile);
  }

  _append(chunks, vectors) {
    const lines = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
    fs.appendFileSync(this.paths.chunksFile, lines);
    fs.appendFileSync(this.paths.vectorsFile, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  }

  addDocument({ id, name, suffix, size, createdAt, chunks, vectors }) {
    const doc = { id, name, suffix, size, chunks: chunks.length, createdAt };
    this.docs.set(id, doc);

    const rows = chunks.map((text, ord) => ({ docId: id, docName: name, ord, text }));
    this._append(rows, vectors);

    const merged = new Float32Array(this.vectors.length + vectors.length);
    merged.set(this.vectors, 0);
    merged.set(vectors, this.vectors.length);
    this.vectors = merged;
    this.chunks.push(...rows);

    this._writeIndex();
    return doc;
  }

  deleteDocument(id) {
    if (!this.docs.has(id)) return false;
    this.docs.delete(id);

    const keepIdx = [];
    const keepChunks = [];
    this.chunks.forEach((c, i) => {
      if (c.docId !== id) {
        keepIdx.push(i);
        keepChunks.push(c);
      }
    });

    const next = new Float32Array(keepIdx.length * DIM);
    keepIdx.forEach((src, dst) => {
      next.set(this.vectors.subarray(src * DIM, src * DIM + DIM), dst * DIM);
    });
    this.chunks = keepChunks;
    this.vectors = next;

    const tmpChunks = `${this.paths.chunksFile}.tmp`;
    fs.writeFileSync(tmpChunks, keepChunks.map((c) => JSON.stringify(c)).join('\n') + (keepChunks.length ? '\n' : ''));
    fs.renameSync(tmpChunks, this.paths.chunksFile);

    const tmpVec = `${this.paths.vectorsFile}.tmp`;
    fs.writeFileSync(tmpVec, Buffer.from(next.buffer, next.byteOffset, next.byteLength));
    fs.renameSync(tmpVec, this.paths.vectorsFile);

    this._writeIndex();
    return true;
  }

  listDocuments() {
    return [...this.docs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  stats() {
    const chars = this.chunks.reduce((sum, c) => sum + (c.text ? c.text.length : 0), 0);
    let bytes = 0;
    for (const f of [this.paths.dbFile, this.paths.chunksFile, this.paths.vectorsFile]) {
      try {
        bytes += fs.statSync(f).size;
      } catch {
        /* missing file */
      }
    }
    return {
      documents: this.docs.size,
      chunks: this.chunks.length,
      chars,
      db_mb: Math.round((bytes / 1e6) * 1000) / 1000,
    };
  }

  search(queryVec, topK, dim, docIds) {
    const n = this.chunks.length;
    if (!n) return [];
    const k = Math.min(Math.max(topK, 1), n);
    const wanted = docIds && docIds.length ? new Set(docIds) : null;

    let qNorm = 0;
    for (let d = 0; d < dim; d += 1) qNorm += queryVec[d] * queryVec[d];
    qNorm = Math.sqrt(qNorm) || 1;

    const scores = new Float32Array(n).fill(-Infinity);
    for (let i = 0; i < n; i += 1) {
      const chunk = this.chunks[i];
      if (wanted && !wanted.has(chunk.docId)) continue;
      let dot = 0;
      let norm = 0;
      const base = i * DIM;
      for (let d = 0; d < dim; d += 1) {
        const v = this.vectors[base + d];
        dot += v * queryVec[d];
        norm += v * v;
      }
      scores[i] = dot / ((Math.sqrt(norm) || 1) * qNorm);
    }

    const order = Array.from({ length: n }, (_, i) => i)
      .filter((i) => Number.isFinite(scores[i]))
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, k);

    return order.map((i) => ({
      score: scores[i],
      chunkId: i,
      docId: this.chunks[i].docId,
      docName: this.chunks[i].docName,
      ord: this.chunks[i].ord,
      text: this.chunks[i].text,
    }));
  }
}

module.exports = { VectorStore, DIM };
