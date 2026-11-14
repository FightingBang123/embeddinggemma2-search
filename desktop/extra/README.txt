EmbeddingGemma 2 · 本地语义检索（Windows 免安装包）
====================================================

怎么用
------
1. 双击 Install.cmd
   它会把整个目录复制到 %LOCALAPPDATA%\Programs\EmbeddingGemma2，
   在桌面创建「EmbeddingGemma 2」快捷方式并启动。
2. 首次启动如果没有模型，会弹出下载向导（约 310 MB，只需一次）。

为什么不直接双击 EmbeddingGemma2.exe
------------------------------------
Chromium/Electron 在**路径含非 ASCII 字符**（如中文目录）时会静默退出，不报错。
如果当前目录路径是纯英文，双击 EmbeddingGemma2.exe 也能用（或运行 Run.cmd）。
否则请始终用 Install.cmd，或使用开始菜单里的安装版。

数据位置
--------
%APPDATA%\embeddinggemma2-desktop\
  data\app.db     SQLite（文档 + 向量）
  data\models\    模型缓存
  logs\llama.log  推理进程日志（启动失败先看这里）

常见问题
--------
- 双击后没有任何反应：路径含中文，改用 Install.cmd。
- 提示缺少模型且下载失败：可手动把 embeddinggemma-2-Q8_0.gguf 放到
  %APPDATA%\embeddinggemma2-desktop\data\models\ 下再启动。
- 端口被占用：应用会自动改用随机端口，无需处理。

离线包（文件名带 offline）
--------------------------
已内置模型，首次启动无需联网。
