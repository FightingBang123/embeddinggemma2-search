'use strict';
/**
 * SQLite 向量库（node:sqlite，无原生编译）。
 * 表结构与服务器端 backend/app/db.py 完全一致，两种形态可互相打开同一个 app.db。
 *
 *   documents(id TEXT PK, name, suffix, size, chunks, created_at)
 *   chunks(id INTEGER PK AUTOINCREMENT, doc_id, ord, text, vec BLOB float32[768])
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DIM = 768;

const SCHEMA = `
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
`;

class SqliteStore {
  constructor(paths) {
    this.paths = paths;
    this.dbFile = paths.dbFile;
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });

    this.db = new DatabaseSync(this.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);

    this._migrateLegacy();
    this._reload();
  }

  /** 老版本（json/jsonl/f32）自动迁移到 SQLite，成功后把旧文件标记为 .migrated */
  _migrateLegacy() {
    const legacy = [this.paths.indexFile, this.paths.chunksFile, this.paths.vectorsFile].filter(Boolean);
    const exists = legacy.filter((f) => fs.existsSync(f));
    if (!exists.length) return;

    const count = this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    if (count > 0) return;

    try {
      const indexRaw = this.paths.indexFile && fs.existsSync(this.paths.indexFile)
        ? JSON.parse(fs.readFileSync(this.paths.indexFile, 'utf8'))
        : { documents: [] };
      const chunks = this.paths.chunksFile && fs.existsSync(this.paths.chunksFile)
        ? fs
            .readFileSync(this.paths.chunksFile, 'utf8')
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l))
        : [];
      const vecBuf = this.paths.vectorsFile && fs.existsSync(this.paths.vectorsFile)
        ? fs.readFileSync(this.paths.vectorsFile)
        : Buffer.alloc(0);
      const vectors = new Float32Array(vecBuf.length / 4);
      new Uint8Array(vectors.buffer).set(vecBuf);

      this.db.exec('BEGIN');
      for (const doc of indexRaw.documents || []) {
        this.db
          .prepare('INSERT OR REPLACE INTO documents(id,name,suffix,size,chunks,created_at) VALUES(?,?,?,?,?,?)')
          .run(doc.id, doc.name, doc.suffix ?? '', doc.size ?? 0, doc.chunks ?? 0, doc.createdAt ?? new Date().toISOString());
      }
      const insert = this.db.prepare('INSERT INTO chunks(doc_id,ord,text,vec) VALUES(?,?,?,?)');
      chunks.forEach((c, i) => {
        const slice = vectors.subarray(i * DIM, (i + 1) * DIM);
        insert.run(c.docId, c.ord ?? 0, c.text ?? '', Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
      });
      this.db.exec('COMMIT');
      for (const f of exists) fs.renameSync(f, `${f}.migrated`);
      console.log(`[store] migrated ${chunks.length} chunks from legacy files`);
    } catch (err) {
      this.db.exec('ROLLBACK');
      console.warn('[store] legacy migration failed, keeping old files:', err.message);
    }
  }

  _reload() {
    const docs = this.db
      .prepare('SELECT id,name,suffix,size,chunks,created_at FROM documents ORDER BY created_at DESC')
      .all();
    this.documents = docs.map((d) => ({
      id: d.id,
      name: d.name,
      suffix: d.suffix,
      size: d.size,
      chunks: d.chunks,
      createdAt: d.created_at,
    }));

    const rows = this.db
      .prepare('SELECT c.id, c.doc_id, c.ord, c.text, c.vec, d.name FROM chunks c JOIN documents d ON d.id = c.doc_id ORDER BY c.id')
      .all();
    this.chunks = rows.map((r) => ({ id: r.id, docId: r.doc_id, docName: r.name, ord: r.ord, text: r.text }));
    this.vectors = new Float32Array(rows.length * DIM);
    rows.forEach((r, i) => {
      this.vectors.set(new Float32Array(r.vec.buffer, r.vec.byteOffset, DIM), i * DIM);
    });
    console.log(`[store] loaded ${this.documents.length} docs / ${this.chunks.length} chunks from sqlite`);
  }

  addDocument({ id, name, suffix, size, createdAt, chunks, vectors }) {
    const insertDoc = this.db.prepare(
      'INSERT INTO documents(id,name,suffix,size,chunks,created_at) VALUES(?,?,?,?,?,?)',
    );
    const insertChunk = this.db.prepare('INSERT INTO chunks(doc_id,ord,text,vec) VALUES(?,?,?,?)');

    this.db.exec('BEGIN');
    try {
      insertDoc.run(id, name, suffix ?? '', size, chunks.length, createdAt);
      chunks.forEach((text, ord) => {
        const slice = vectors.subarray(ord * DIM, (ord + 1) * DIM);
        insertChunk.run(id, ord, text, Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this._reload();
    return { id, name, suffix, size, chunks: chunks.length, createdAt };
  }

  deleteDocument(id) {
    this.db.exec('BEGIN');
    try {
      const info = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      if (info.changes === 0) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this._reload();
    return true;
  }

  listDocuments() {
    return this.documents;
  }

  stats() {
    const row = this.db
      .prepare('SELECT (SELECT COUNT(*) FROM documents) AS docs, (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COALESCE(SUM(LENGTH(text)),0) FROM chunks) AS chars')
      .get();
    let bytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        bytes += fs.statSync(`${this.dbFile}${suffix}`).size;
      } catch {
        /* missing */
      }
    }
    return {
      documents: row.docs,
      chunks: row.chunks,
      chars: row.chars,
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
      chunkId: this.chunks[i].id,
      docId: this.chunks[i].docId,
      docName: this.chunks[i].docName,
      ord: this.chunks[i].ord,
      text: this.chunks[i].text,
    }));
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}

module.exports = { SqliteStore, DIM };
