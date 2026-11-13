# EmbeddingGemma 2 · 本地语义检索

llama.cpp 出向量，FastAPI 建索引与检索，React 提供可用界面。全本地、单端口、开箱即用。

界面是左右两栏：左侧上传区与文档库（块数 / 体积 / 删除），右侧检索面板——三种任务模式、返回条数、MRL 维度切换，结果卡带 cosine 分数条、文件名、块序号、命中高亮，可展开全文、复制、「只看该文档」。

## 工程结构

```
embeddinggemma2-search/
├── backend/            后端源码（FastAPI）
│   ├── app/
│   │   ├── config.py       路径、模型参数、prompt 前缀
│   │   ├── db.py           SQLite schema / 连接 / 变更令牌
│   │   ├── chunking.py     文本抽取 + 段落感知切块
│   │   ├── embeddings.py   llama-server 客户端（批量 /v1/embeddings）
│   │   ├── index.py        进程内向量矩阵 + 余弦 top-k
│   │   └── main.py         路由、上传、检索、静态托管
│   ├── run.py              启动入口（deploy/serve-api.cmd 调用）
│   ├── requirements.txt
│   └── lib/                依赖（pip --target，免 venv，gitignore）
├── frontend/           前端源码（React 19 + Vite + TS + Tailwind）
│   ├── src/                App / components / ui / api
│   ├── vite.config.ts      构建产物 -> ../release/web
│   └── package.json
├── build/              构建与打包
│   ├── build.ps1           前端构建 + 后端导入自检
│   ├── package.ps1         打 zip（可 -WithRuntime 含模型）
│   ├── cache/              下载/安装缓存（gitignore）
│   └── out/                打包产物（gitignore）
├── release/            可运行产物
│   ├── web/                前端构建结果（后端直接托管）
│   ├── models/             GGUF（310 MB，gitignore）
│   └── runtime/            llama.cpp Windows 预编译（gitignore）
├── deploy/             部署与运维
│   ├── start-ui.cmd        一键起模型 + 后端 + 打开浏览器
│   ├── stop-ui.cmd         一键全停
│   ├── start.cmd           只起模型（前台）
│   ├── start-bg.cmd        只起模型（后台）
│   ├── stop.cmd            只停模型（按端口）
│   ├── serve-api.cmd       只跑后端
│   ├── download.cmd        拉取 llama.cpp 与 GGUF
│   └── health.py / fetch.py / smoke_test.py / ingest_samples.py
├── data/               SQLite（向量 + 元数据，gitignore）
├── docs/               截图与补充文档
├── samples/            示例语料（中文 FAQ / 设计笔记 / 代码）
└── logs/               运行日志（gitignore）
```

## 快速开始

```cmd
build\build.ps1          :: 构建前端到 release\web（首次会 npm install）
deploy\start-ui.cmd      :: 起模型 + 后端，打开 http://127.0.0.1:8000
deploy\stop-ui.cmd       :: 全部停止
```

没有模型/运行时（新克隆）时先执行：

```cmd
deploy\download.cmd      :: 拉 llama.cpp b12360 + embeddinggemma-2-Q8_0.gguf 到 release\
```

> 本机 `curl` 的 schannel 已损坏，所有下载走 `deploy/fetch.py`（Python + hf-mirror）。

## 各层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| `release/runtime` | 纯推理进程，OpenAI 兼容 `/v1/embeddings` | 文档、切块、索引、鉴权 |
| `backend` | 解析、切块、向量化、SQLite、检索、托管前端 | 模型加载与显存管理 |
| `frontend` | 交互、排序展示、高亮、上传 | 任何持久化 |
| `build` | 产物构建与打包 | 运行 |
| `deploy` | 进程编排、健康检查、停止、下载 | 业务逻辑 |

## 开发模式

```cmd
:: 终端 1：模型
deploy\start.cmd 8080 2048

:: 终端 2：后端（自动 reload 不开，改代码后重启）
set PYTHONPATH=backend\lib
python backend\run.py

:: 终端 3：前端（:5173，/api 代理到 :8000，热更新）
cd frontend
npm run dev
```

前端改完 `build\build.ps1`，后端直接托管新的 `release/web`，无需重启。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8000 | 后端端口 |
| `LLAMA_URL` | http://127.0.0.1:8080 | 推理服务地址 |
| `LLAMA_MODEL_ALIAS` | embeddinggemma2 | 请求体里的 model 名 |
| `DATA_DIR` | `<root>/data` | SQLite 所在目录 |

## 已知边界

- 纯向量检索，未做 BM25 混合：精确型号/错误码召回偏弱，可加关键词加权或 RRF
- 向量常驻内存，10 万块（约 300 MB）以内单机够用；更大换 sqlite-vec / FAISS
- 单用户无鉴权，只绑 `127.0.0.1`；多人用需加 token 与配额
- 切块粒度固定 900 字符，长表格会被切开

架构与取舍细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。
