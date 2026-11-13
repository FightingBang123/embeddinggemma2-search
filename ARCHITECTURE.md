# 架构说明

## 分层

```
浏览器  React 19 + Vite 8 + Tailwind 4 + TanStack Query
   │  /api/*（同源，无 CORS）
backend/app  FastAPI（uvicorn :8000）
   │  解析 → 切块 → 批量 embedding → SQLite → numpy 余弦 top-k
   │  托管 release/web（生产单端口）
   │  POST /v1/embeddings（OpenAI 兼容）
release/runtime  llama-server（:8080）
   embeddinggemma-2-Q8_0.gguf · Vulkan · 270M 文本塔 · 768d
```

分层原因：

- **推理与业务分离**：llama-server 只管算向量；换模型、换量化、升级 llama.cpp 都不动业务代码，也不动索引。
- **后端用 Python**：pypdf、切块、numpy 一行搞定；llama.cpp 生态示例也多。
- **前端 Vite + React 19 + Tailwind 4**：HMR 亚秒级；生产包 283 KB / 88 KB gzip；TanStack Query 管请求缓存与失效。
- **产物集中在 `release/`**：`release/web` 由前端构建直接写入，后端只读托管；模型与运行时也在此，删除 `release/` 即可"重装"。

## 数据流

**写入**（`POST /api/documents`，multipart 多文件）

1. 按扩展名解析：PDF → pypdf；其余 UTF-8 → GB18030 → latin-1 逐级回退
2. 切块（`backend/app/chunking.py`）：
   - 保留 Markdown 标题作为块首上下文
   - 段落合并到约 900 字符
   - 超长块优先在 `\n\n`、换行、句末标点处切，避免切开代码 token
   - 相邻块带约 120 字符的行对齐重叠
3. 拼 `title: {文件名} | text: {块}`，每 16 条一批调用 `/v1/embeddings`
4. 向量 L2 归一化后以 float32 BLOB 写入 `data/app.db`（WAL）

**检索**（`POST /api/search`）

1. 按模式选前缀：`task: search result | query:` / `task: code retrieval | query:` / `task: sentence similarity | sentence:`
2. 取 768 维后按 MRL 截断（768/512/256/128），两侧重新归一化
3. 矩阵乘得余弦分 → `argpartition` 取 top-k → 回表取块文本
4. 返回分数、文件、块序号、`embed_ms` / `total_ms`

`VectorIndex` 在进程内缓存整个矩阵，以 `(chunks 数, max(id))` 作为版本号，写入后自动重建。

## 存储

```
data/app.db
  documents(id TEXT PK, name, suffix, size, chunks, created_at)
  chunks(id INTEGER PK, doc_id, ord, text, vec BLOB)
```

`vec` = 768 × float32 裸字节，读出后 `np.frombuffer` 零拷贝。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 后端 + llama-server 状态、文档/块计数 |
| GET | `/api/stats` | 文档数、块数、字符数、DB 体积 |
| GET | `/api/documents` | 文档列表 |
| POST | `/api/documents` | 上传并索引，逐文件返回 `chunks/chars/embed_ms` |
| DELETE | `/api/documents/{id}` | 删除文档及其块 |
| POST | `/api/search` | 向量检索 |
| GET | `/*` | SPA（`release/web`），`/assets/*` 静态资源 |

## 构建与发布

```
frontend/src ──npm run build──▶ release/web        （build/build.ps1）
backend/app  ──pip --target──▶ backend/lib         （一次性）
llama.cpp    ──download─────▶ release/runtime      （deploy/download.cmd）
GGUF         ──download─────▶ release/models       （deploy/download.cmd）
release + sources ──zip──▶ build/out/*.zip         （build/package.ps1）
```

`package.ps1` 默认不含模型与运行时（几 MB），`-WithRuntime` 生成完整离线包（约 500 MB）。

## 关键取舍

| 决策 | 原因 | 代价 |
|---|---|---|
| 只做向量检索，不做 BM25 混合 | 语义问答足够，少一套索引 | 精确术语召回弱 |
| 前端不引路由/状态库 | 单页应用，useState + Query 够用 | 多页面要加 router |
| 切块 900 字符 | 中文 FAQ/文档的召回甜点 | 长表格会被切开 |
| 单用户、无鉴权 | 只绑 127.0.0.1 的本地工具 | 多人用需 token + 配额 |
| 依赖装到 `backend/lib` | 免 venv、免污染全局、可直接打包 | 无法多版本共存 |
| 前端依赖用 npm 而非 pnpm | 本机 pnpm 在该路径下解析不出可选依赖（rolldown/picomatch） | 与 pnpm 习惯不一致 |
