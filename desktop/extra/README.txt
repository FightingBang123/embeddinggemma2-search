EmbeddingGemma 2 · 本地语义检索（Windows 包）
==============================================

怎么用
------
1. 双击 Install.cmd
   它会把整个目录复制到 %LOCALAPPDATA%\Programs\EmbeddingGemma2，
   在桌面创建「EmbeddingGemma 2」快捷方式并启动。
2. 本包已内置模型（resources\models\embeddinggemma-2-Q8_0.gguf，约 296 MB），
   首次启动无需联网、不会弹下载向导。

为什么不直接双击 EmbeddingGemma2.exe
------------------------------------
Chromium/Electron 在**路径含非 ASCII 字符**（如中文目录）时会静默退出，不报错。
如果当前目录路径是纯英文，双击 EmbeddingGemma2.exe 也能用（或运行 Run.cmd）。
否则请始终用 Install.cmd，或使用桌面快捷方式。

数据位置
--------
%APPDATA%\embeddinggemma2-desktop\
  data\app.db     SQLite（文档 + 向量）
  data\models\    模型缓存（有内置模型时以安装目录为准）
  logs\llama.log  推理进程日志（启动失败先看这里）

模型优先级
----------
安装目录 resources\models\  >  %APPDATA%\embeddinggemma2-desktop\data\models\
想换模型：把新的 .gguf 放进安装目录的 resources\models\ 并改名为
embeddinggemma-2-Q8_0.gguf，重启应用即可。

常见问题
--------
- 双击后没有任何反应：路径含中文，改用 Install.cmd。
- 提示缺少模型：说明用的是轻量包（文件名带 slim），可手动把
  embeddinggemma-2-Q8_0.gguf 放到 %APPDATA%\embeddinggemma2-desktop\data\models\。
- 端口被占用：应用会自动改用随机端口，无需处理。
