// EmbeddingGemma 2 启动器（用户双击的就是这个 exe）。
//
// 它存在的原因：Electron/Chromium 有一类"静默失败"——进程起来了，但拿不到
// 进程单例锁 / 初始化不了沙箱 / 写不了数据目录时，不弹窗、不写日志、退出码 0。
// 用户看到的就是"双击了没反应"。这个启动器是纯 .NET，能从任何目录启动，因此可以：
//   1. 发现主程序秒退时，换一种方式再试（受限目录下加 --no-sandbox）；
//   2. 仍然不行就把整个目录复制到一个普通目录再启动（带进度窗）；
//   3. 全都不行时弹窗说明原因，并指出日志在哪，而不是留一片安静。
//
// 主程序叫 EmbeddingGemma2Core.exe；本文件编译成 EmbeddingGemma2.exe，
// 并额外复制一份 EmbeddingGemma2App.exe，用户点哪个名字都走得进这条路。
//
// Build: build/build-launcher.ps1（csc /target:winexe /r:System.Windows.Forms.dll）

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const string CoreExe = "EmbeddingGemma2Core.exe";
    private const string ProductName = "EmbeddingGemma 2";

    // 主程序正常时一秒内就会显示启动动画；这里只等"退出或出窗口"。
    private const int ProbeMs = 4000;

    private static string _here = "";

    private static int Main(string[] args)
    {
        try
        {
            _here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string core = Path.Combine(_here, CoreExe);
            Log("start here=" + _here + " coreExists=" + File.Exists(core));

            if (!File.Exists(core))
            {
                Fail("启动器找不到主程序 " + CoreExe + "。\r\n\r\n" +
                     "压缩包可能没有完整解压，或者主程序被杀毒软件移走了。\r\n\r\n" +
                     "当前目录：" + _here);
                return 1;
            }

            // 已有实例在跑：再起一次只会触发"聚焦已有窗口"，不要误判成失败。
            if (IsCoreRunning())
            {
                Log("core already running -> hand off");
                Spawn(_here, core, args, null);
                return 0;
            }

            int exitCode;
            if (TryLaunch(_here, core, args, null, out exitCode)) return 0;
            Log("in-place launch ended early, exit=" + exitCode);

            // 上一次的崩溃处理子进程可能还没退干净；等它退出再重试，
            // 否则新实例会被单实例锁挡住，看起来又是"启动失败"。
            WaitForCoreGone(2500);

            // 受限目录（只读 / 低完整性 / 沙箱）里 Chromium 的沙箱初始化不了，
            // 会立刻退出。只在"已经失败过一次"之后才放宽沙箱重试，正常启动不会走这里。
            if (TryLaunch(_here, core, args, "--no-sandbox", out exitCode)) return 0;
            Log("in-place retry (--no-sandbox) ended early, exit=" + exitCode);
            WaitForCoreGone(2500);

            // 还是不行：把整包复制到一个普通目录再跑（首次 10–30 秒，带进度窗）。
            string lastError = null;
            foreach (string target in RelocationTargets())
            {
                try
                {
                    if (!IsAscii(target)) continue;
                    string targetCore = Path.Combine(target, CoreExe);
                    if (!File.Exists(targetCore) || IsSourceNewer(_here, target))
                    {
                        Log("copy -> " + target);
                        CopyWithProgress(_here, target);
                    }
                    if (File.Exists(targetCore) && TryLaunch(target, targetCore, args, null, out exitCode))
                    {
                        Log("launched from " + target);
                        return 0;
                    }
                    Log("relocated launch failed in " + target);
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    Log("target failed " + target + ": " + ex.Message);
                }
            }

            Fail("程序从这个目录启动不了，换目录复制也没成功。\r\n\r\n" +
                 "常见原因：\r\n" +
                 "  · 目录被安全策略 / 沙箱限制（低完整性标签、AppLocker、受控文件夹）；\r\n" +
                 "  · 目录只读，或所在磁盘被安全软件拦截；\r\n" +
                 "  · 压缩包没有解压完整，缺 DLL。\r\n\r\n" +
                 "可以试试：\r\n" +
                 "  1. 把整个文件夹移到 D:\\Apps\\EmbeddingGemma2 这类普通目录后重试；\r\n" +
                 "  2. 双击同一目录里的 Install.cmd（用 PowerShell 安装并建快捷方式）；\r\n" +
                 "  3. 打开日志看具体停在哪一步。\r\n\r\n" +
                 (lastError == null ? "" : "最近一次错误：" + lastError + "\r\n\r\n") +
                 "启动器日志：" + LauncherLogPath() + "\r\n" +
                 "主程序日志：" + StartupLogPath() + "\r\n\r\n" +
                 "当前目录：" + _here);
            return 1;
        }
        catch (Exception ex)
        {
            Log("fatal: " + ex);
            Fail("启动失败：\r\n\r\n" + ex.Message + "\r\n\r\n日志：" + LauncherLogPath());
            return 1;
        }
    }

    /// <summary>
    /// 启动主程序并观察它是不是"秒退"。
    /// true = 主程序还活着（或已经出窗口），启动器可以退场。
    /// </summary>
    private static bool TryLaunch(string workDir, string exe, string[] args, string extraSwitches, out int exitCode)
    {
        exitCode = 0;
        Process proc;
        try
        {
            proc = Spawn(workDir, exe, args, extraSwitches);
        }
        catch (Exception ex)
        {
            Log("spawn failed " + exe + ": " + ex.Message);
            exitCode = -1;
            return false;
        }
        if (proc == null)
        {
            exitCode = -1;
            return false;
        }

        int waited = 0;
        while (waited < ProbeMs)
        {
            if (proc.HasExited)
            {
                exitCode = SafeExitCode(proc);
                return false;
            }
            try
            {
                proc.Refresh();
                if (proc.MainWindowHandle != IntPtr.Zero) return true;
            }
            catch
            {
                /* 进程刚好退出 */
            }
            Thread.Sleep(120);
            waited += 120;
        }

        // 没退出也没窗口：多半只是慢（杀毒软件在扫 250 MB 的 exe），交给主程序继续。
        Log("still starting after " + ProbeMs + "ms - assuming success");
        return true;
    }

    private static Process Spawn(string workDir, string exe, string[] args, string extraSwitches)
    {
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = workDir,
            UseShellExecute = false,
        };

        var sb = new StringBuilder();
        if (args != null && args.Length > 0) sb.Append(JoinArgs(args));
        if (!string.IsNullOrEmpty(extraSwitches))
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(extraSwitches);
        }
        if (sb.Length > 0) psi.Arguments = sb.ToString();

        // 某些开发 / 自动化环境会全局设置 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 立即退出。
        try { psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); }
        catch { /* 老版本 framework 没有这个属性 */ }

        return Process.Start(psi);
    }

    private static bool IsCoreRunning()
    {
        try
        {
            return Process.GetProcessesByName(Path.GetFileNameWithoutExtension(CoreExe)).Length > 0;
        }
        catch
        {
            return false;
        }
    }

    // 上一次尝试失败后，等它的子进程彻底退出，避免被单实例锁挡住。
    private static void WaitForCoreGone(int timeoutMs)
    {
        int waited = 0;
        while (waited < timeoutMs)
        {
            if (!IsCoreRunning()) return;
            Thread.Sleep(150);
            waited += 150;
        }
        Log("core processes still present after " + timeoutMs + "ms");
    }

    private static int SafeExitCode(Process proc)
    {
        try { return proc.ExitCode; }
        catch { return 0; }
    }

    private static string[] RelocationTargets()
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new string[]
        {
            Path.Combine(localAppData, @"Programs\EmbeddingGemma2"),
            Path.Combine(Path.GetTempPath(), "EmbeddingGemma2"),
        };
    }

    // ---------------------------------------------------------------- 日志
    private static string LauncherLogPath()
    {
        try { return Path.Combine(Path.GetTempPath(), "embeddinggemma2-launcher.log"); }
        catch { return Path.Combine(_here, "launcher.log"); }
    }

    private static string StartupLogPath()
    {
        try { return Path.Combine(Path.GetTempPath(), "embeddinggemma2-startup.log"); }
        catch { return "%TEMP%\\embeddinggemma2-startup.log"; }
    }

    private static void Log(string message)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n";
        string[] candidates = new string[]
        {
            SaferTemp("embeddinggemma2-launcher.log"),
            Path.Combine(_here, "launcher.log"),
        };
        foreach (string file in candidates)
        {
            if (file == null) continue;
            try
            {
                File.AppendAllText(file, line);
                return;
            }
            catch { /* 试下一个位置 */ }
        }
    }

    private static string SaferTemp(string name)
    {
        try { return Path.Combine(Path.GetTempPath(), name); }
        catch { return null; }
    }

    // ---------------------------------------------------------------- 工具
    private static string JoinArgs(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
        }
        return sb.ToString();
    }

    private static bool IsAscii(string s)
    {
        foreach (char c in s)
        {
            if (c > 0x7F) return false;
        }
        return true;
    }

    // 启动器目录里的主程序比目标新时，重新复制。
    private static bool IsSourceNewer(string sourceDir, string targetDir)
    {
        string src = Path.Combine(sourceDir, CoreExe);
        string dst = Path.Combine(targetDir, CoreExe);
        try
        {
            return File.GetLastWriteTimeUtc(src) > File.GetLastWriteTimeUtc(dst);
        }
        catch
        {
            return true;
        }
    }

    private static void CopyTree(string sourceDir, string targetDir, string skipDir)
    {
        string source = Path.GetFullPath(sourceDir).TrimEnd('\\');
        string target = Path.GetFullPath(targetDir).TrimEnd('\\');
        Directory.CreateDirectory(target);

        int copied = 0;
        int skipped = 0;

        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            if (IsUnder(dir, skipDir)) continue;
            Directory.CreateDirectory(Path.Combine(target, Rel(source, dir)));
        }

        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            if (IsUnder(file, skipDir)) continue;
            string dest = Path.Combine(target, Rel(source, file));
            string parent = Path.GetDirectoryName(dest);
            if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);

            FileInfo srcInfo = new FileInfo(file);
            if (File.Exists(dest))
            {
                FileInfo dstInfo = new FileInfo(dest);
                if (dstInfo.Length == srcInfo.Length
                    && File.GetLastWriteTimeUtc(dest) >= File.GetLastWriteTimeUtc(file))
                {
                    skipped++;
                    continue; // 已经是最新的
                }
            }
            try
            {
                File.Copy(file, dest, true);
                copied++;
            }
            catch (IOException) { /* 文件被占用：保留现有版本 */ }
        }

        Log("copyTree copied=" + copied + " skipped=" + skipped + " -> " + target);
    }

    private static string Rel(string root, string path)
    {
        string full = Path.GetFullPath(path);
        return full.Substring(Path.GetFullPath(root).Length).TrimStart('\\');
    }

    private static bool IsUnder(string path, string dir)
    {
        string full = Path.GetFullPath(path).TrimEnd('\\');
        string root = Path.GetFullPath(dir).TrimEnd('\\');
        return full.Equals(root, StringComparison.OrdinalIgnoreCase)
            || full.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    private static void Fail(string text)
    {
        try { MessageBox.Show(text, ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error); }
        catch { /* 连弹窗都不行就只剩日志了 */ }
    }

    // 复制时用无边框进度窗：用户能看到进度，也不需要点任何按钮。
    private static void CopyWithProgress(string sourceDir, string targetDir)
    {
        Exception failure = null;
        using (var form = new InstallForm(targetDir))
        {
            // 等窗体有句柄再起线程，否则跨线程 Close() 可能丢失、窗体永远关不掉
            form.Shown += delegate
            {
                var worker = new Thread(delegate()
                {
                    try
                    {
                        CopyTree(sourceDir, targetDir, targetDir);
                    }
                    catch (Exception ex)
                    {
                        failure = ex;
                    }
                    try { form.BeginInvoke(new Action(form.Close)); }
                    catch { /* 窗体已经关了 */ }
                });
                worker.IsBackground = true;
                worker.Start();
            };

            Application.Run(form);
        }

        if (failure != null)
        {
            Log("copy failed: " + failure.Message);
            throw failure;
        }
    }

    private sealed class InstallForm : Form
    {
        public InstallForm(string targetDir)
        {
            Text = ProductName;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            Width = 484;
            Height = 162;
            TopMost = true;

            var title = new Label
            {
                Text = "首次启动，正在把程序准备到本机目录…",
                Font = new System.Drawing.Font("Segoe UI", 10F, System.Drawing.FontStyle.Bold),
                AutoSize = true,
                Left = 24,
                Top = 20,
            };
            var path = new Label
            {
                Text = targetDir,
                AutoSize = false,
                Width = 424,
                Height = 18,
                Left = 24,
                Top = 50,
                AutoEllipsis = true,
                ForeColor = System.Drawing.Color.DimGray,
            };
            var hint = new Label
            {
                Text = "只需要一次，之后启动会跳过这一步。",
                AutoSize = true,
                Left = 24,
                Top = 70,
                ForeColor = System.Drawing.Color.DimGray,
            };
            var bar = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30,
                Left = 24,
                Top = 98,
                Width = 424,
                Height = 16,
            };
            Controls.Add(title);
            Controls.Add(path);
            Controls.Add(hint);
            Controls.Add(bar);
        }
    }
}
