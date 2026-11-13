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
| 存储 | `index.json` + `chunks.jsonl` + `vectors.f32` | 零原生依赖（不编译 better-sqlite3），追加写、删除原子重写 |
| 首次启动 | 缺模型/运行时 → 向导下载 | 安装包可以不带 300 MB 模型 |
| 安全 | `contextIsolation` + `sandbox`，不暴露 Node | preload 只放出 4 个方法 |
| 单实例 | `requestSingleInstanceLock` | 防止两个进程抢同一份索引 |

目录：

```
desktop/
  src/main/main.js      生命周期 / 窗口 / 菜单 / 单实例 / 首次启动分支
  src/main/llama.js     子进程：找二进制、挑端口、等 /health、退出清理
  src/main/api.js       node:http：/api/*、multipart 与裸流上传、静态托管
  src/main/store.js     向量库：加载、追加、删除重写、余弦 top-k
  src/main/chunk.js     切块（900 字符 / 120 重叠 / 标题上下文）
  src/main/download.js  GGUF 下载（进度回调 → 向导）
  src/main/paths.js     资源/数据目录解析（打包后 resourcesPath + userData）
  src/preload/preload.js contextBridge：info / openData / openLogs / setup.*
  src/setup/setup.html  首次启动向导
  scripts/fetch-runtime.mjs  按平台取 llama.cpp（win-vulkan / ubuntu-vulkan / macos-metal）
  scripts/selfcheck.js       不起窗口的端到端自检
```

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
desktop/scripts/fetch-runtime.mjs ──▶ desktop/resources/runtime[/models]
build/build.ps1    前端构建 + 后端导入自检
build/package.ps1  源码包 / -WithRuntime 离线包
desktop: npm run dist:win|mac|linux ──▶ release/desktop
```

## 关键取舍

| 决策 | 原因 | 代价 |
|---|---|---|
| Electron 而非 Tauri | 本机无 Rust 工具链；Electron 可复现、生态成熟 | 安装包 +80~120 MB |
| 桌面后端用 Node 重写 | 去掉 Python 依赖，真正双击即用 | 两套后端实现需同步维护 |
| 向量存 f32 文件而非 SQLite | 免原生模块编译，跨平台打包零风险 | 无 SQL 能力；10 万块以上要换方案 |
| 只做向量检索 | 语义问答足够，少一套索引 | 精确型号/错误码召回弱 |
| 模型默认随包 | 离线可用、开箱即用 | 安装包 +300 MB（可配置去掉） |
| 单用户、无鉴权 | 只绑 127.0.0.1 | 多人共享走服务器模式 + 反代鉴权 |
