using System;
using System.Text;
class ServiceAcceptance {
  [STAThread] static int Main(string[] args) {
    if(args.Length != 1 || (args[0] != "Stop" && args[0] != "Start" && args[0] != "Crash" && args[0] != "Snapshot" && args[0] != "RecoverRegistration")) return 1;
    string script = @"C:\Users\Matt\Desktop\Code\Desktop\rescore\.superpowers\sdd\architecture-uplift\service-acceptance.ps1";
    string log = Environment.GetEnvironmentVariable("TEMP") + @"\rescore-installed-acceptance-20261014\service-" + args[0] + ".log";
    return RescoreMaintenance.RunHiddenPowerShell("& '" + script.Replace("'", "''") + "' -Action " + args[0], log);
  }
}
