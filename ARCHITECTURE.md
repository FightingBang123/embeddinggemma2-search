# 架构说明

## 两种形态

```
桌面（Electron）                                    服务器（浏览器）
┌───────────────────────────────┐                  ┌───────────────────────────────┐
│ BrowserWindow                 │                  │ 浏览器                        │
│   React 19 + Vite + Tailwind  │                  │  同一套前端                   │
└──────────────▲────────────────┘                  └──────────────▲────────────────┘
               │ http://127.0.0.1:<随机端口>                     │ http://host:8000
┌──────────────┴────────────────┐                  ┌──────────────┴────────────────┐
│ 主进程 main/api.js            │                  │ backend/app (FastAPI)         │
│   /api/* + 托管 release/web   │                  │   /api/* + 托管 release/web   │
│   store.js：json+jsonl+f32    │                  │   SQLite + numpy              │
└──────────────▲────────────────┘                  └──────────────▲────────────────┘
               │ POST /v1/embeddings                             │ 同左
┌──────────────┴──────────────────────────────────────────────────┴────────────────┐
│ llama-server（子进程）  embeddinggemma-2-Q8_0.gguf · 270M 文本塔 · 768d           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

两端共用：同一份前端构建产物 `release/web`、同一套切块规则、同样的 prompt 前缀与评分逻辑。

## 桌面端设计

| 关注点 | 做法 | 原因 |
|---|---|---|
| 运行时 | Electron 45 | 无需 Rust 工具链；Chromium 自带，三平台行为一致 |
| 后端语言 | 主进程里跑 Node | 去掉 Python 依赖，安装包自包含，省一层 IPC |
| 推理进程 | `llama.js` 拉起 llama-server | 崩溃可重启；Windows 用 `taskkill /T` 连带子进程 |
| 端口 | `freePort(8080)`，失败由系统分配 | 避免和用户已有的 llama.cpp 冲突 |
| 存储 | SQLite（`node:sqlite`，schema 与服务器端一致） | 无原生编译依赖；两种形态可共用/互换同一个 `app.db` |
| 首次启动 | 缺模型/运行时 → 向导下载 | 安装包可以不带 300 MB 模型 |
| 安全 | `contextIsolation` + `sandbox`，不暴露 Node | preload 只放出 4 个方法 |
| 单实例 | `requestSingleInstanceLock` | 防止两个进程抢同一份索引 |

目录：

```
desktop/
  electron-builder.yml          安装包（不含模型）
  electron-builder.offline.yml  离线包（含 GGUF）
  build/                        icon.ico / icon.png / entitlements.mac.plist
  src/main/main.js      生命周期 / 窗口 / 菜单 / 单实例 / 首次启动分支
  src/main/llama.js     子进程：找二进制、挑端口、等 /health、退出清理
  src/main/api.js       node:http：/api/*、multipart 与裸流上传、静态托管
  src/main/store-sqlite.js  SQLite 向量库：事务写入、内存矩阵、余弦 top-k
  src/main/chunk.js     切块（900 字符 / 120 重叠 / 标题上下文）
  src/main/download.js  GGUF 下载（进度回调 → 向导）
  src/main/paths.js     资源/数据目录解析（打包后 resourcesPath + userData）
  src/preload/preload.js contextBridge：info / openData / openLogs / setup.*
  src/setup/setup.html  首次启动向导
  scripts/fetch-runtime.mjs  按平台取 llama.cpp（win-vulkan / ubuntu-vulkan / macos-metal）
  scripts/selfcheck.js       不起窗口的端到端自检
```

## 统一存储

两侧使用**同一张表结构、同一个文件名** `app.db`：

```sql
documents(id TEXT PK, name, suffix, size, chunks, created_at)
chunks(id INTEGER PK AUTOINCREMENT, doc_id, ord, text, vec BLOB)  -- vec = float32[768]
```

- 桌面端：`node:sqlite` 的 `DatabaseSync`，WAL 模式，写入用事务；向量以 Buffer 存 BLOB。
- 服务器端：Python `sqlite3`，同一 schema（`backend/app/db.py`）。
- 启动时把全表读入内存矩阵用于暴力余弦；`addDocument` / `deleteDocument` 事务提交后重建。
- 老版本的 `index.json + chunks.jsonl + vectors.f32` 会在首次打开时自动迁移，旧文件改名为 `*.migrated`。

互操作已实测：桌面端建的库用 FastAPI 打开、Python 建的库用桌面端打开，计数与检索结果一致。


## 服务器端设计（保留）

FastAPI（`backend/app`）负责解析、切块、SQLite 向量表、numpy 余弦，并托管 `release/web`；`deploy/*.cmd` 负责进程编排与启停。

## 数据流

**写入**
1. 前端 `POST /api/documents`（multipart；桌面端也支持裸流 + `x-filename`）
2. 解析：PDF → pdf-parse（Node）/ pypdf（Python）；文本按 UTF-8 → GB18030 回退
3. 切块：标题作上下文、段落合并到约 900 字符、结构化硬切、行对齐重叠
4. 拼 `title: {文件名} | text: {块}`，每 16 条一批 `/v1/embeddings`
5. L2 归一化后落盘（桌面：f32 追加；服务器：SQLite BLOB）

**检索**
1. `POST /api/search {query, top_k, dim, mode, doc_ids?}`
2. 前缀：`task: search result | query:` / `task: code retrieval | query:` / `task: sentence similarity | sentence:`
3. 768 维按 MRL 截断 → 两侧重新归一化 → 余弦
4. top-k 回表取文本，返回分数、文件、块序号、耗时

## 构建与发布

```
frontend/src ──npm run build──▶ release/web ─┬─▶ deploy/start-ui.cmd（服务器模式）
                                             └─▶ electron-builder（桌面，extraResources/web）
build/make-icon.py ──▶ desktop/build/icon.{ico,png}
desktop/scripts/fetch-runtime.mjs ──▶ desktop/resources/runtime[/models]
build/build.ps1    前端构建 + 后端导入自检
build/package.ps1  源码包 / -WithRuntime 离线包
desktop: npm run dist:win            ──▶ release/desktop/*.zip（~198 MB，不含模型）
desktop: npm run dist:win:offline    ──▶ release/desktop-offline/*.zip（~467 MB，含模型）
```

签名采用"配置就位、无证书自动跳过"：Windows 走 `signtoolOptions`（`CSC_LINK`/`CSC_NAME` + RFC3161 时间戳），macOS 走 hardened runtime + entitlements 文件，公证用 `APPLE_ID`/`APPLE_TEAM_ID`，详见 `docs/SIGNING.md`。

## 关键取舍

| 决策 | 原因 | 代价 |
|---|---|---|
| Electron 而非 Tauri | 本机无 Rust 工具链；Electron 可复现、生态成熟 | 安装包 +80~120 MB |
| 桌面后端用 Node 重写 | 去掉 Python 依赖，真正双击即用 | 两套后端实现需同步维护 |
| 统一用 SQLite（`node:sqlite`） | 与服务器端同 schema，可互换数据；无需编译原生模块 | Node 24 仍标记 experimental（启动警告已过滤） |
| 只做向量检索 | 语义问答足够，少一套索引 | 精确型号/错误码召回弱 |
| 安装包默认不带模型 | 体积从 467 MB 降到 198 MB，绕开 NSIS 32 位 mmap 限制 | 首次启动需联网下载 |
| 单用户、无鉴权 | 只绑 127.0.0.1 | 多人共享走服务器模式 + 反代鉴权 |

## 已知限制

- 两个后端共用同一 schema，但**检索/切块逻辑仍是两份实现**（JS 与 Python），改规则时需同步。
- 向量检索是暴力余弦：10 万块以内可用，再大需要 ANN（HNSW/FAISS）。
- NSIS 安装包在本仓库的构建环境里会报 `makensis ... error creating mmap`（32 位编译器 + 受限内存），因此这里只产出 `zip` 免安装包；在普通 Windows 机器上 `npm run dist:win` 可直接出安装包。
- 未接入 electron-updater 自动更新；未签名（SmartScreen 会提示"未知发布者"）。
- 首次启动下载基于 hf-mirror；目标环境只能直连 Hugging Face 时用 `HF_MIRROR=https://huggingface.co`。
- Linux/ macOS 包需要在对应平台构建（llama.cpp 运行时按平台下载，交叉编译不适用）。

