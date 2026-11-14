# 排障手册

## 双击 `EmbeddingGemma2.exe` 没反应（最常见）

**原因**：Chromium/Electron 在路径（或工作目录）含**非 ASCII 字符**时启动失败，
而且不弹窗、不写日志、退出码为空——表现就是"双击了没动静"。中文目录（如
`D:\AI\GPU混合集群\...`）就会触发。

已实测（同一份打包产物）：

| 启动方式 | 结果 |
|---|---|
| 真正的 Electron 主程序 `EmbeddingGemma2App.exe`，位于 `D:\AI\GPU混合集群\...` | 静默退出，stderr：`crashpad_client_win.cc:887 not connected` |
| 同一 exe 放到 `C:\eg2app\`（纯英文路径） | 正常启动，窗口标题「EmbeddingGemma 2 · 语义检索」 |
| 安装到 `%LOCALAPPDATA%\Programs\EmbeddingGemma2\`（ASCII） | 正常启动 |

**现在的处理**：v1.6.0 起，解压目录里的 `EmbeddingGemma2.exe` 是一个 10 KB 的
**启动器**，而 Electron 主程序改名 `EmbeddingGemma2App.exe`。双击启动器时：

1. 路径是纯英文 → 直接启动主程序；
2. 路径含中文 → 先把整个目录安装到 `%LOCALAPPDATA%\Programs\EmbeddingGemma2`
   （ASCII，首次 10–30 秒，带进度窗），再从那里启动；
3. 该目录不可写 → 退化到 `%TEMP%\EmbeddingGemma2`（同样是 ASCII）；
4. 都不行 → 弹窗说明原因，并提示改用 `Install.cmd` 或移到英文目录。

之后再次双击：主程序已存在且版本一致时**跳过复制**，直接启动。

诊断日志：`%TEMP%\embeddinggemma2-launcher.log`；该位置不可写时写到 exe 同目录的
`launcher.log`。里面记录了 `here=… ascii=…`、`copy -> …`、`copyTree copied=… skipped=…`、
`launch …` 等关键步骤。

**仍然失败时的三步**：

1. 看上面的 launcher 日志，确认卡在哪一步；
2. 双击 `Install.cmd`（PowerShell 安装到 ASCII 目录 + 桌面快捷方式，最稳）；
3. 或把整个目录移到 `D:\Apps\EmbeddingGemma2` 这类纯英文路径，再双击 exe。

> 含中文的**工作目录**同样会让 Chromium 初始化失败，所以启动器/安装脚本都会在
> 启动主程序前把工作目录切到 ASCII 路径，并清掉开发环境可能残留的
> `ELECTRON_RUN_AS_NODE=1`（该变量会让 Electron 退化成 Node 直接退出）。

## 看日志

| 日志 | 位置 |
|---|---|
| 启动器决策 | `%TEMP%\embeddinggemma2-launcher.log`（或 exe 同目录 `launcher.log`） |
| 主进程 stdout/stderr | 从终端启动才能看到（双击看不到） |
| 推理进程 | `%APPDATA%\embeddinggemma2-desktop\logs\llama.log` |
| 数据目录 | `%APPDATA%\embeddinggemma2-desktop\data\`（菜单「文件 → 打开数据目录」） |

命令行观察一次：

```cmd
cd /d "%LOCALAPPDATA%\Programs\EmbeddingGemma2"
set ELECTRON_RUN_AS_NODE=
EmbeddingGemma2App.exe --enable-logging=stderr
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
