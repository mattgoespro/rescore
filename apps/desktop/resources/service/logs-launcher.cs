using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class RescoreLogs
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "resources", "service", "logs.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("The Rescore log viewer is missing. Reinstall Rescore.");
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            Process.Start(new ProcessStartInfo(powershell, "-NoProfile -NoExit -ExecutionPolicy Bypass -File \"" + script + "\"")
            {
                UseShellExecute = true,
                WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory
            });
            return 0;
        }
        catch (Exception)
        {
            MessageBox.Show("Rescore Logs could not open. Reinstall Rescore to restore the log viewer.", "Rescore Logs", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
