# 排障手册

## 双击 `EmbeddingGemma2.exe` 没反应（最常见）

**原因**：Chromium/Electron 在路径（或工作目录）含**非 ASCII 字符**时启动失败，
而且不弹窗、不写日志、退出码为空——表现就是"双击了没动静"。中文目录（如
`D:\AI\GPU混合集群\...`）就会触发。

已实测：

| 启动位置 | 结果 |
|---|---|
| `D:\AI\GPU混合集群\release\desktop\win-unpacked\EmbeddingGemma2.exe` | 静默退出，stderr：`crashpad_client_win.cc:887 not connected` |
| `C:\eg2app\EmbeddingGemma2.exe`（纯英文路径） | 正常启动，窗口标题「EmbeddingGemma 2 · 语义检索」 |
| `%LOCALAPPDATA%\Programs\EmbeddingGemma2\`（`Install.cmd` 安装后） | 正常启动 |

**解决**：用解压目录里的 `Install.cmd`。它会：

1. 把整个目录复制到 `%LOCALAPPDATA%\Programs\EmbeddingGemma2`（纯 ASCII）
2. 在桌面创建快捷方式
3. 用正确的工作目录启动

也可以手动把整个目录移到 `D:\Apps\EmbeddingGemma2` 这类纯英文路径，再双击 exe。

> 同一台机器上，含中文的**工作目录**同样会让 Chromium 初始化失败，
> 所以 `Install.ps1` / `Run.ps1` 都会先 `cd` 到安装目录再启动，并清掉
> 开发环境可能残留的 `ELECTRON_RUN_AS_NODE=1`（该变量会让 Electron 退化成 Node 直接退出）。

## 看日志

| 日志 | 位置 |
|---|---|
| 主进程 stdout/stderr | 从终端启动才能看到（双击看不到） |
| 推理进程 | `%APPDATA%\embeddinggemma2-desktop\logs\llama.log` |
| 数据目录 | `%APPDATA%\embeddinggemma2-desktop\data\`（菜单「文件 → 打开数据目录」） |

命令行观察一次：

```cmd
cd /d "%LOCALAPPDATA%\Programs\EmbeddingGemma2"
set ELECTRON_RUN_AS_NODE=
EmbeddingGemma2.exe --enable-logging=stderr
```

## 首次启动弹「准备模型」但下载失败

- 下载走 hf-mirror；若网络能直连 HF，可设 `HF_MIRROR=https://huggingface.co` 后重启
- 也可以手动下载 `embeddinggemma-2-Q8_0.gguf`（约 310 MB）放到
  `%APPDATA%\embeddinggemma2-desktop\data\models\`，再启动
- 默认包已内置模型（`resources\models\`），只有 `*-win-slim-*.zip` 才会走这一步

## 窗口起来了但检索报错

- 检查 `logs\llama.log` 末尾：模型加载失败 / Vulkan 初始化失败会写在这里
- 显存不足时把 `desktop/src/main/llama.js` 里的 `-ngl 99` 改为 `0`（走 CPU）后重新打包
- 端口冲突不用管：应用会先试 8080，占用则自动换随机端口

## 打包相关

- `npm run dist:win` 需要 NSIS；受限/低内存环境会报
  `makensis ... error creating mmap`，改用 `--win zip` 或 `--dir`
- 构建路径含中文时 NSIS 也会失败（脚本里的路径被 ANSI 截断）；
  可临时把工程目录映射成 ASCII 盘符或 junction 再打包
- 无签名时 SmartScreen 会提示"未知发布者"，签名步骤见 [SIGNING.md](SIGNING.md)
