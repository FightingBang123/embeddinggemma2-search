EmbeddingGemma 2 · 本地语义检索（Windows 包）
==============================================

怎么用
------
1. 解压到任意目录（中文目录也可以）。
2. 双击 EmbeddingGemma2.exe（或 EmbeddingGemma2App.exe），立刻出现启动动画，
   依次是：启动内核 → 加载推理模型 → 载入本地索引 → 打开界面。
   本包已内置模型（resources\models\，约 296 MB），首次启动无需联网。

目录里的 exe
------------
EmbeddingGemma2.exe      启动器（约 30 KB），**双击这个**
EmbeddingGemma2App.exe   同一个启动器（沿用了老版本的文件名，点它也一样）
EmbeddingGemma2Core.exe  真正的 Electron 主程序，不要直接双击

启动器会做什么：
1. 先原地启动主程序；
2. 主程序立刻退出（受限目录、数据目录不可写、被安全软件拦截）时，
   会换一种方式再试一次；
3. 仍然不行，就把整包复制到 %LOCALAPPDATA%\Programs\EmbeddingGemma2
   （首次约 10-30 秒，带进度窗；该目录不可写时改用 %TEMP%\EmbeddingGemma2），
   再从那里启动；
4. 全都不行，弹窗说明原因，并指出日志在哪里。

想要桌面快捷方式：双击 Install.cmd。

启动慢 / 没反应？
-----------------
启动动画会显示当前阶段，所以"没窗口"这件事本身就能看出来。
如果一直卡在某个阶段，或者窗口根本没出现，看这两个日志：
  %TEMP%\embeddinggemma2-startup.log    主程序启动日志（每次启动重写）
  %TEMP%\embeddinggemma2-launcher.log   启动器的判断过程
再不行就双击 Install.cmd（PowerShell 安装到本机目录 + 快捷方式，最稳）。

数据位置
--------
默认：%APPDATA%\embeddinggemma2-desktop\
  data\app.db     SQLite（文档 + 向量）
  data\models\    模型缓存（有内置模型时以安装目录为准）
  logs\llama.log  推理进程日志
如果这个位置不可写（漫游配置、组策略、安全软件、沙箱目录），主程序会自动
改用程序目录下的 userdata\，并在启动动画里提示实际位置。

模型优先级
----------
安装目录 resources\models\  >  %APPDATA%\embeddinggemma2-desktop\data\models\
想换模型：把新的 .gguf 放进 resources\models\ 并改名为
embeddinggemma-2-Q8_0.gguf，重启应用即可。

常见问题
--------
- 提示缺少模型：说明用的是轻量包（文件名带 slim），可手动把
  embeddinggemma-2-Q8_0.gguf 放到 %APPDATA%\embeddinggemma2-desktop\data\models\。
- 端口被占用：应用会自动改用随机端口，无需处理。
- 启动后窗口空白：看 %APPDATA%\embeddinggemma2-desktop\logs\llama.log。
