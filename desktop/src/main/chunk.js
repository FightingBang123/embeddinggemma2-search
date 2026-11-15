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

async function extractPdf(buffer) {
  // pdf-parse 2.x 不再导出可直接调用的函数，改为 PDFParse 类：
  //   const parser = new PDFParse({ data }); await parser.getText(); await parser.destroy()
  // 沿用 1.x 的 pdfParse(buffer) 会直接抛 "pdfParse is not a function"。
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    // pageJoiner 传空串，避免把 “-- 1 of 1 --” 这类页码标记切进向量块
    const out = await parser.getText({ pageJoiner: '' });
    return out.text || '';
  } catch (err) {
    const name = err && err.name ? err.name : '';
    const message = err && err.message ? err.message : String(err);
    if (name === 'PasswordException' || /password/i.test(message)) {
      const e = new Error('PDF 已加密，需要密码；请先解密后再上传');
      e.status = 422;
      throw e;
    }
    if (/InvalidPDF|Invalid PDF|FormatError/i.test(`${name} ${message}`)) {
      const e = new Error('PDF 文件损坏或格式不受支持');
      e.status = 422;
      throw e;
    }
    throw new Error(`PDF 解析失败：${message}`);
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* 解析失败时清理也可能失败，保留原始错误 */
    }
  }
}

async function extractText(name, buffer) {
  const suffix = path.extname(name).toLowerCase();
  if (suffix === '.pdf') return extractPdf(buffer);
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
