using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Text;

[assembly: AssemblyTitle("Rescore Maintenance")]
[assembly: AssemblyProduct("Rescore")]

// A Windows GUI executable has no console, including when ShellExecute elevates it.
internal static class RescoreMaintenance
{
    private const int Timeout = 1800000;

    [STAThread]
    private static int Main(string[] args)
    {
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            return Run(args, new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator));
    }

    internal static string Quote(string value)
    {
        // CommandLineToArgvW quoting also preserves a trailing backslash.
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            quoted.Append(c);
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    internal static int Run(string[] args, bool administrator)
    {
        string result = null;
        bool ownsResult = false;
        try
        {
            if (!Environment.Is64BitProcess) return 1;
            var options = new Dictionary<string, string>(StringComparer.Ordinal);
            bool delete = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--delete-catalogue") { if (delete) return 1; delete = true; continue; }
                if (args[i] != "--action" && args[i] != "--data-dir" && args[i] != "--result") return 1;
                string key = args[i];
                if (++i == args.Length || options.ContainsKey(key)) return 1;
                options.Add(key, args[i]);
            }
            string action;
            if (!options.TryGetValue("--action", out action) ||
                (action != "Install" && action != "UpgradeAll" && action != "RemoveAll" && action != "EnsureRunning" && action != "Retry")) return 1;
            if (delete && action != "RemoveAll") return 1;
            string data;
            options.TryGetValue("--data-dir", out data);
            // Capture the launching user's folder before alternate administrator credentials change identity.
            if (data == null && (action == "Install" || action == "EnsureRunning" || action == "Retry"))
                data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Rescore", "data");
            if (data != null) data = Path.GetFullPath(data);
            if (!options.TryGetValue("--result", out result))
            {
                result = Path.Combine(Path.GetTempPath(), "rescore-maintenance-" + Guid.NewGuid().ToString("N") + ".txt");
                ownsResult = true;
            }
            result = Path.GetFullPath(result);
            File.WriteAllText(result, "");
            var forwarded = "--action " + Quote(action) + " --result " + Quote(result);
            if (data != null) forwarded += " --data-dir " + Quote(data);
            if (delete) forwarded += " --delete-catalogue";
            if (!administrator)
            {
                // Elevate this GUI executable, never powershell.exe. WindowStyle cannot
                // prevent a console from being allocated at a ShellExecute UAC boundary.
                using (Process child = Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, forwarded)
                {
                    UseShellExecute = true,
                    Verb = "runas"
                }))
                {
                    if (child == null || !child.WaitForExit(Timeout)) return 1;
                    // The elevated process handle may not expose ExitCode. The worker
                    // must record completion; an empty/missing result is always failure.
                    return ReadResult(result);
                }
            }
            string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "maintenance.ps1");
            string command = "& " + PowerShellQuote(script) + " -Worker -Action " + action + " -ResultPath " + PowerShellQuote(result);
            if (data != null) command += " -DataDir " + PowerShellQuote(data);
            if (delete) command += " -DeleteCatalogue";
            command += "; exit $LASTEXITCODE";
            int code = RunHiddenPowerShell(command);
            int reported = ReadResult(result);
            return code == 0 ? reported : code;
        }
        catch { return 1; }
        finally
        {
            if (ownsResult && result != null) { try { File.Delete(result); } catch {} }
        }
    }

    private static string PowerShellQuote(string value) { return "'" + value.Replace("'", "''") + "'"; }

    private static int ReadResult(string path)
    {
        int code;
        return File.Exists(path) && Int32.TryParse(File.ReadAllText(path).Trim(), out code) && code >= 0 ? code : 1;
    }

    internal static int RunHiddenPowerShell(string command, string diagnosticsPath = null)
    {
        string executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        var start = new ProcessStartInfo(executable,
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        // A packaged app can be launched from PowerShell 7. Its inherited module
        // paths must not redirect Windows PowerShell to incompatible modules.
        start.EnvironmentVariables["PSModulePath"] = Path.Combine(Path.GetDirectoryName(executable), "Modules");
        using (Process child = Process.Start(start))
        {
            if (child == null) return 1;
            var output = child.StandardOutput.ReadToEndAsync();
            var errors = child.StandardError.ReadToEndAsync();
            if (!child.WaitForExit(Timeout)) { child.Kill(); child.WaitForExit(); return 1; }
            System.Threading.Tasks.Task.WaitAll(output, errors);
            if (diagnosticsPath != null) File.WriteAllText(diagnosticsPath, output.Result + errors.Result);
            return child.ExitCode;
        }
    }
}
