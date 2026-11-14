'use strict';
/**
 * 选一个**真的能写**的用户数据目录。
 *
 * 为什么需要：Chromium 启动时会先在 userData 里建进程单例锁文件，
 * 建不出来就直接退出——不弹窗、不写日志、退出码 0。表现就是"双击没反应"。
 * 触发条件不限于中文路径，更常见的是：
 *   - %APPDATA% 被组策略/漫游配置/安全软件锁住，或目录只读；
 *   - 程序被放在受限目录（例如带完整性标签的沙箱目录）里运行。
 *
 * 顺序：默认 userData → exe 同目录 portable → %LOCALAPPDATA%\Temp → 系统临时目录。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/** 能不能在这个目录里创建/写入/删除文件（真正写一次，不看 ACL）。 */
function canWrite(dir) {
  if (!dir) return false;
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    try {
      fs.unlinkSync(probe);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function candidates({ preferred, exeDir }) {
  const list = [];
  if (preferred) list.push({ dir: preferred, kind: 'default', note: '系统默认位置' });

  if (exeDir) {
    list.push({ dir: path.join(exeDir, 'userdata'), kind: 'portable', note: '程序目录（便携模式）' });
  }

  const localAppData = process.env.LOCALAPPDATA;
  const hash = crypto.createHash('sha1').update(exeDir || 'embeddinggemma2').digest('hex').slice(0, 8);
  if (localAppData) {
    list.push({
      dir: path.join(localAppData, 'Temp', `embeddinggemma2-${hash}`),
      kind: 'temp',
      note: '用户临时目录',
    });
  }
  list.push({
    dir: path.join(os.tmpdir(), `embeddinggemma2-${hash}`),
    kind: 'os-temp',
    note: '系统临时目录',
  });
  return list;
}

/**
 * @returns {{dir: string, kind: string, note: string, preferred: string, fallback: boolean}}
 */
function chooseUserData({ preferred, exeDir }) {
  const list = candidates({ preferred, exeDir });
  for (const entry of list) {
    if (canWrite(entry.dir)) {
      return { ...entry, preferred, fallback: entry.kind !== 'default' };
    }
  }
  // 全都不行：仍然返回最后一个，让上层把错误报给用户
  const last = list[list.length - 1];
  return { ...last, preferred, fallback: true, unwritable: true };
}

module.exports = { chooseUserData, canWrite };
