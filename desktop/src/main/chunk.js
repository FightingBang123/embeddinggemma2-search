'use strict';
/** 文本抽取与切块：与 Python 版保持同一套规则（900 字符 / 120 重叠 / 标题作上下文）。 */

const path = require('node:path');

const TEXT_SUFFIXES = new Set([
  '.txt', '.md', '.markdown', '.rst', '.csv', '.json', '.yaml', '.yml',
  '.log', '.ini', '.toml', '.html', '.htm', '.xml',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rs', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh', '.ps1', '.sql', '.kt',
]);

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;

function decodeBytes(buf) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // 明显乱码再试 GB18030（Node 支持经 iconv-lite 才完整，这里用内置 unicode 回退）
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

async function extractText(name, buffer) {
  const suffix = path.extname(name).toLowerCase();
  if (suffix === '.pdf') {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(buffer);
    return out.text || '';
  }
  if (suffix && !TEXT_SUFFIXES.has(suffix)) {
    const err = new Error(`unsupported file type: ${suffix}`);
    err.status = 415;
    throw err;
  }
  return decodeBytes(buffer);
}

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(input, size = 900, overlap = 120) {
  const text = normalize(input);
  if (!text) return [];
  if (text.length <= size) return [text];

  /** @type {{head: string, body: string}[]} */
  const blocks = [];
  let heading = '';
  let buf = [];
  const flush = () => {
    if (buf.length) {
      blocks.push({ head: heading, body: buf.join('\n').trim() });
      buf = [];
    }
  };

  for (const line of text.split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      heading = m[2].trim();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();

  let chunks = [];
  let current = '';
  for (const { head, body } of blocks) {
    const piece = (head ? `${head}\n${body}` : body).trim();
    if (!piece) continue;

    if (current.length + piece.length + 2 <= size) {
      current = `${current}\n\n${piece}`.trim();
      continue;
    }
    if (current) chunks.push(current);

    if (piece.length <= size) {
      current = piece;
      continue;
    }

    let start = 0;
    while (start < piece.length) {
      let end = Math.min(start + size, piece.length);
      if (end < piece.length) {
        const floor = start + Math.max(Math.floor(size * 0.55), 1);
        for (const pat of ['\n\n', '\n', '。', '！', '？', '. ', '; ']) {
          const cut = piece.lastIndexOf(pat, end);
          if (cut > floor) {
            end = cut + pat.length;
            break;
          }
        }
      }
      const slice = piece.slice(start, end).trim();
      if (slice) chunks.push(slice);
      if (end >= piece.length) break;
      start = end;
    }
    current = '';
  }
  if (current) chunks.push(current);

  if (overlap > 0 && chunks.length > 1) {
    const merged = [chunks[0]];
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      let tail = prev.slice(-overlap);
      const nl = tail.indexOf('\n');
      if (nl >= 0) tail = tail.slice(nl + 1);
      const next = chunks[i];
      merged.push(tail && !next.startsWith(tail) ? `${tail}\n${next}`.trim() : next);
    }
    chunks = merged;
  }
  return chunks.filter((c) => c.trim());
}

module.exports = { chunkText, extractText, TEXT_SUFFIXES };
