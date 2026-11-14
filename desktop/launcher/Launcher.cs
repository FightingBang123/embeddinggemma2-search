// EmbeddingGemma 2 launcher.
//
// Why this exists: Chromium/Electron exits silently when its executable path or
// working directory contains non-ASCII characters. Users routinely extract the
// zip into a Chinese-named folder and double-click the exe, see nothing happen.
//
// This small native launcher is the file users double-click. It:
//   1. runs from ANY path (it is plain .NET, not Chromium),
//   2. if the current folder is ASCII -> starts EmbeddingGemma2App.exe right here,
//   3. otherwise copies the app to %LOCALAPPDATA%\Programs\EmbeddingGemma2 (ASCII)
//      once, then starts it from there.
//
// Build: see build/build-launcher.ps1 (csc /target:winexe /r:System.Windows.Forms.dll)

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

internal static class Launcher
{
    private const string AppExe = "EmbeddingGemma2App.exe";
    private const string ProductName = "EmbeddingGemma 2";

    private static int Main(string[] args)
    {
        try
        {
            string here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string local = Path.Combine(here, AppExe);
            Log("start here=" + here + " ascii=" + IsAscii(here) + " appInPlace=" + File.Exists(local));

            if (IsAscii(here) && File.Exists(local))
            {
                return Start(here, local, args);
            }

            // Non-ASCII path: preferred fix is a junction with an ASCII name
            // (instant, no copying); fall back to copying the whole folder.
            string link = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\EmbeddingGemma2Runtime");
            string linkExe = Path.Combine(link, AppExe);

            if (TryEnsureJunction(link, here) && File.Exists(linkExe))
            {
                Log("launch via junction " + link);
                return Start(link, linkExe, args);
            }

            string target = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Programs\EmbeddingGemma2");
            string targetExe = Path.Combine(target, AppExe);

            if (!File.Exists(targetExe) || IsSourceNewer(here, target))
            {
                Log("copy -> " + target);
                CopyWithProgress(here, target);
                Log("copy done, exe=" + File.Exists(targetExe));
            }

            if (!File.Exists(targetExe))
            {
                Dialog(
                    "无法从当前目录启动（路径含非 ASCII 字符，Chromium 会直接退出），" +
                    "自动修复也失败了。\r\n\r\n" +
                    "请把压缩包解压到纯英文目录后重试，或运行压缩包里的 Install.cmd。\r\n\r\n" +
                    "当前目录：" + here,
                    MessageBoxIcon.Error);
                return 1;
            }

            return Start(target, targetExe, args);
        }
        catch (Exception ex)
        {
            Dialog("启动失败：\r\n\r\n" + ex.Message, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Creates/refreshes a directory junction so the app can be started through an
    // ASCII path even when it lives under a Chinese-named folder.
    private static bool TryEnsureJunction(string link, string target)
    {
        try
        {
            string linkExe = Path.Combine(link, AppExe);
            if (Directory.Exists(link))
            {
                bool isJunction = (File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0;
                if (!isJunction)
                {
                    Log("junction blocked: real directory at " + link);
                    return false;
                }
                if (File.Exists(linkExe) && IsSameSize(linkExe, Path.Combine(target, AppExe)))
                {
                    return true; // already pointing at this copy
                }
                Directory.Delete(link, false); // removes the link only
            }

            string cmd = "/c mklink /J \"" + link + "\" \"" + target + "\"";
            var psi = new ProcessStartInfo("cmd.exe", cmd)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (Process p = Process.Start(psi))
            {
                p.StandardOutput.ReadToEnd();
                p.StandardError.ReadToEnd();
                p.WaitForExit(15000);
            }

            bool ok = File.Exists(linkExe);
            Log("junction " + link + " -> " + target + " ok=" + ok);
            return ok;
        }
        catch (Exception ex)
        {
            Log("junction failed: " + ex.GetType().Name + " " + ex.Message);
            return false;
        }
    }

    private static bool IsSameSize(string a, string b)
    {
        try { return new FileInfo(a).Length == new FileInfo(b).Length; }
        catch { return false; }
    }

    private static int Start(string workDir, string exe, string[] args)
    {
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = workDir,
            UseShellExecute = false,
        };
        if (args != null && args.Length > 0)
        {
            psi.Arguments = JoinArgs(args);
        }
        // Some dev setups export this globally; Electron then runs as plain Node and quits.
        try { psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); }
        catch { /* older framework: ignore */ }

        Process.Start(psi);
        Log("started " + exe);
        return 0;
    }

    // Launcher-side diagnostics: users get no console, so leave a trail.
    // Temp first (normal case); if that is blocked, fall back next to the exe.
    private static void Log(string message)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n";
        try
        {
            string here = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string[] candidates = new string[]
            {
                Path.Combine(Path.GetTempPath(), "embeddinggemma2-launcher.log"),
                Path.Combine(here, "launcher.log"),
            };
            foreach (string file in candidates)
            {
                try
                {
                    File.AppendAllText(file, line);
                    return;
                }
                catch { /* try next location */ }
            }
        }
        catch { /* never fail because of logging */ }
    }

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

    // Re-copy when the launcher package is newer than what is installed.
    private static bool IsSourceNewer(string sourceDir, string targetDir)
    {
        string src = Path.Combine(sourceDir, AppExe);
        string dst = Path.Combine(targetDir, AppExe);
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
            if (File.Exists(dest) && new FileInfo(dest).Length == new FileInfo(file).Length
                && File.GetLastWriteTimeUtc(dest) >= File.GetLastWriteTimeUtc(file))
            {
                skipped++;
                continue; // already up to date
            }
            try
            {
                File.Copy(file, dest, true);
                copied++;
            }
            catch (IOException) { /* in use: keep existing */ }
        }

        Log("copyTree copied=" + copied + " skipped=" + skipped + " -> " + target);
    }

    private static string Rel(string root, string path)
    {
        string full = Path.GetFullPath(path);
        return full.Substring(Path.GetFullPath(root).Length).TrimStart('\\');
    }

    private static bool SamePath(string a, string b)
    {
        return string.Equals(
            Path.GetFullPath(a).TrimEnd('\\'),
            Path.GetFullPath(b).TrimEnd('\\'),
            StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsUnder(string path, string dir)
    {
        string full = Path.GetFullPath(path).TrimEnd('\\');
        string root = Path.GetFullPath(dir).TrimEnd('\\');
        return full.Equals(root, StringComparison.OrdinalIgnoreCase)
            || full.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    private static void Dialog(string text, MessageBoxIcon icon)
    {
        MessageBox.Show(text, ProductName, MessageBoxButtons.OK, icon);
    }

    // Copy while showing a borderless "installing" window, so the user gets
    // feedback and the launcher never needs a click to proceed.
    private static void CopyWithProgress(string sourceDir, string targetDir)
    {
        Exception failure = null;
        using (var form = new InstallForm(targetDir))
        {
            // Start the worker only after the form has a handle, otherwise the
            // cross-thread Close() can be lost and the form would stay forever.
            form.Shown += delegate
            {
                var worker = new System.Threading.Thread(delegate()
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
                    catch { /* form already gone */ }
                });
                worker.IsBackground = true;
                worker.Start();
            };

            Application.Run(form);
        }

        if (failure != null)
        {
            Dialog("安装到本机目录失败：\r\n\r\n" + failure.Message +
                   "\r\n\r\n可以改用压缩包里的 Install.cmd。", MessageBoxIcon.Error);
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
            Width = 460;
            Height = 150;
            TopMost = true;

            var title = new Label
            {
                Text = "首次启动，正在准备运行环境…",
                Font = new System.Drawing.Font("Segoe UI", 10F, System.Drawing.FontStyle.Bold),
                AutoSize = true,
                Left = 24,
                Top = 22,
            };
            var path = new Label
            {
                Text = targetDir,
                AutoSize = false,
                Width = 400,
                Height = 18,
                Left = 24,
                Top = 52,
                AutoEllipsis = true,
                ForeColor = System.Drawing.Color.DimGray,
            };
            var bar = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 30,
                Left = 24,
                Top = 78,
                Width = 400,
                Height = 18,
            };
            Controls.Add(title);
            Controls.Add(path);
            Controls.Add(bar);
        }
    }
}
