EmbeddingGemma 2 · 本地语义检索（Windows 包）
==============================================

怎么用
------
1. 解压到任意目录（中文目录也可以）。
2. 双击 EmbeddingGemma2.exe，等 3～10 秒出现窗口。
   本包已内置模型（resources\models\，约 296 MB），首次启动无需联网。

目录里两个 exe 的分工
--------------------
EmbeddingGemma2.exe      启动器（11 KB），**双击这个**
EmbeddingGemma2App.exe   真正的 Electron 主程序

为什么不能直接双击 App.exe：Chromium/Electron 在路径含非 ASCII 字符（如中文目录）时
会静默退出、不报错。启动器会先建一个纯英文的目录联接
  %LOCALAPPDATA%\Programs\EmbeddingGemma2Runtime
指向当前目录，再从那里启动主程序；若联接不可用，则退化为把整个目录复制到
  %LOCALAPPDATA%\Programs\EmbeddingGemma2

想要桌面快捷方式 / 固定安装位置：双击 Install.cmd（复制到上述目录并建快捷方式）。

数据位置
--------
%APPDATA%\embeddinggemma2-desktop\
  data\app.db     SQLite（文档 + 向量）
  data\models\    模型缓存（有内置模型时以安装目录为准）
  logs\llama.log  推理进程日志

模型优先级
----------
安装目录 resources\models\  >  %APPDATA%\embeddinggemma2-desktop\data\models\
想换模型：把新的 .gguf 放进 resources\models\ 并改名为
embeddinggemma-2-Q8_0.gguf，重启应用即可。

常见问题
--------
- 双击后没反应：
  1) 先看 %TEMP%\embeddinggemma2-launcher.log（或 exe 同目录 launcher.log）；
  2) 直接双击 Install.cmd（PowerShell 安装，最稳）；
  3) 或把整个目录移到 D:\Apps\EmbeddingGemma2 这类纯英文路径再双击。
- 提示缺少模型：说明用的是轻量包（文件名带 slim），可手动把
  embeddinggemma-2-Q8_0.gguf 放到 %APPDATA%\embeddinggemma2-desktop\data\models\。
- 端口被占用：应用会自动改用随机端口，无需处理。
- 启动后窗口空白：看 %APPDATA%\embeddinggemma2-desktop\logs\llama.log。
