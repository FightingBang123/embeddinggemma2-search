'use strict';
/**
 * 启动日志：Electron 在窗口出现前就静默退出时，用户什么都看不到。
 * 这里从第一行代码开始写盘，保证"双击没反应"至少能留下可查的痕迹。
 *
 * 位置：%TEMP%\embeddinggemma2-startup.log（不可写时退回 exe 同目录）
 * 每次启动重写，只保留最近一次。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const startedAt = Date.now();
let file = path.join(os.tmpdir(), 'embeddinggemma2-startup.log');
let ready = false;

function candidates() {
  const list = [];
  const temp = process.env.TEMP || process.env.TMP || os.tmpdir();
  if (temp) list.push(path.join(temp, 'embeddinggemma2-startup.log'));
  list.push(path.join(os.tmpdir(), 'embeddinggemma2-startup.log'));
  try {
    list.push(path.join(path.dirname(process.execPath), 'startup.log'));
  } catch {
    /* ignore */
  }
  return list;
}

/** 选一个可写位置，并清空上一轮的日志。 */
function begin() {
  for (const candidate of candidates()) {
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      fs.writeFileSync(candidate, '');
      file = candidate;
      ready = true;
      return file;
    } catch {
      /* try next */
    }
  }
  ready = false;
  return file;
}

function serialize(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 追加一行；日志写不进去也不影响启动。 */
function log(...parts) {
  const line = `[+${String(Date.now() - startedAt).padStart(6, ' ')}ms] ${parts.map(serialize).join(' ')}`;
  if (ready) {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      ready = false;
    }
  }
  try {
    console.log(line);
  } catch {
    /* ignore */
  }
}

module.exports = { begin, log, file: () => file };
