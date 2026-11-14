# 排障手册

## 双击 exe 没反应（最常见）

**症状**：双击后没有窗口、没有报错、任务管理器里进程一闪就没。

**真实原因**（已复现并定位到具体代码路径）：主进程起来了，但 Chromium 的
**进程单例锁**建不出来，于是直接退出——退出码 0、不弹窗、不写日志。
锁文件建在 userData 目录里，所以只要那个目录不可写就会触发：

| 场景 | 典型表现 |
|---|---|
| `%APPDATA%` 被组策略 / 漫游配置 / 备份软件锁住 | 企业机器、域账户 |
| 程序被放在只读或受限目录（低完整性标签、AppLocker、受控文件夹） | 沙箱目录、只读挂载 |
| 整包被安全软件隔离或拦截 | 双击立刻消失 |

> **和中文路径无关。** 同一份产物放在 `C:\中文测试\下载\`、`D:\下载\软件\`、
> `%USERPROFILE%\桌面\我的软件\` 都能正常启动，已逐个实测。
> 之前把原因归到"Chromium 不能从非 ASCII 路径启动"是**误判**——当时是在一个带
> 低完整性标签的目录里测的，主程序连 Chromium 初始化都没走完。

**现在的处理**：

1. 主程序启动时先探测 userData 能不能写，不能写就依次退到
   程序目录下的 `userdata\`、`%LOCALAPPDATA%\Temp\embeddinggemma2-<hash>\`，
   并在启动动画里显示实际使用的目录。
2. 启动动画立刻出现，按阶段推进：启动内核 → 加载推理模型 → 载入本地索引 → 打开界面。
   不会再出现"等半天什么都没有"。
3. 启动日志：`%TEMP%\embeddinggemma2-startup.log`（每次启动重写，含每个阶段的耗时）。
4. `EmbeddingGemma2.exe` 和 `EmbeddingGemma2App.exe` 是**同一个约 30 KB 的启动器**：
   先原地启动主程序；主程序秒退时用 `--no-sandbox` 再试一次（受限目录里
   Chromium 的沙箱初始化不了）；仍然不行就把整包复制到
   `%LOCALAPPDATA%\Programs\EmbeddingGemma2` 再启动；最差也会弹窗说明原因，
   并指向上面两个日志。

> `--no-sandbox` 只在"正常启动已经失败过一次"之后才用，正常启动不会走到。
> 应用只加载本地打包的前端文件，不访问外部站点，所以这条兜底路径的风险很低；
> 但它确实降低了 Chromium 的隔离级别，只作为排障兜底。

**还是起不来时的四步**：

1. 看 `%TEMP%\embeddinggemma2-startup.log` 的最后一行；
2. 看 `%TEMP%\embeddinggemma2-launcher.log`（记录试过哪几种方式、退出码多少）；
3. 双击 `Install.cmd`（走 cmd + PowerShell 复制到本机目录，不受 exe 所在目录权限影响）；
4. 或把整个目录移到 `D:\Apps\EmbeddingGemma2` 这类普通目录再双击。

## 启动很慢

正常范围：首次 5–20 秒（加载约 300 MB 的 GGUF + Vulkan 初始化）。

- 启动动画会显示当前阶段，卡在哪个阶段一目了然；
- 长时间停在"加载推理模型"：看 `%APPDATA%\embeddinggemma2-desktop\logs\llama.log`；
- 从没出现过启动动画：说明主进程都没起来，走上面「双击没反应」的四步。

## 看日志

| 日志 | 位置 |
|---|---|
| 主程序启动（阶段/耗时/数据目录/异常） | `%TEMP%\embeddinggemma2-startup.log` |
| 启动器决策（原地/放宽/复制/退出码） | `%TEMP%\embeddinggemma2-launcher.log` |
| 推理进程 | `%APPDATA%\embeddinggemma2-desktop\logs\llama.log` |
| 数据目录 | `%APPDATA%\embeddinggemma2-desktop\data\`（菜单「文件 → 打开数据目录」） |

数据目录被自动切换过的话，启动动画底部会写明实际路径，`desktop:info` 里也有
`userDataDir` / `userDataKind`。

命令行观察一次：

```cmd
cd /d "%LOCALAPPDATA%\Programs\EmbeddingGemma2"
set ELECTRON_RUN_AS_NODE=
EmbeddingGemma2Core.exe --enable-logging=stderr
```

（`ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成 Node 直接退出；启动器会主动清掉它。）

## 首次启动弹「准备模型」但下载失败

只有 `*-slim-*.zip` 会走下载：

- 下载走 hf-mirror；若网络能直连 HF，可设 `HF_MIRROR=https://huggingface.co` 后重启
- 也可以手动下载 `embeddinggemma-2-Q8_0.gguf`（约 310 MB）放到
  `%APPDATA%\embeddinggemma2-desktop\data\models\`，再启动
- 默认包已内置模型（`resources\models\`），不会走这一步

## 窗口起来了但检索报错

- 检查 `logs\llama.log` 末尾：模型加载失败 / Vulkan 初始化失败会写在这里
- 显存不足时把 `desktop/src/main/llama.js` 里的 `-ngl 99` 改为 `0`（走 CPU）后重新打包
- 端口冲突不用管：应用会先试 8080，占用则自动换随机端口

## 打包相关

- `npm run dist:win` 需要 NSIS；受限/低内存环境会报
  `makensis ... error creating mmap`，改用 `--win zip` 或 `--dir`
- 构建路径含中文时 NSIS 也会失败（脚本里的路径被 ANSI 截断）；
  可临时把工程目录映射成 ASCII 盘符或 junction 再打包
- 安装包（NSIS）的快捷方式指向 `EmbeddingGemma2Core.exe`；免安装 zip 里
  用户双击的 `EmbeddingGemma2.exe` / `EmbeddingGemma2App.exe` 是启动器
- 无签名时 SmartScreen 会提示"未知发布者"，签名步骤见 [SIGNING.md](SIGNING.md)
