param([string]$RuntimePayload, [string]$ReportPath)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
if (!$RuntimePayload) { $RuntimePayload = Join-Path $repo 'dist\win-unpacked\resources\api' }
if (!$ReportPath) { $ReportPath = Join-Path $repo 'apps\desktop\build\service\windows-lifecycle-report.json' }
$build = Join-Path $repo 'apps\desktop\build\service\windows-lifecycle-verification'
[void][IO.Directory]::CreateDirectory($build)
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $ReportPath))
$quote = { param([string]$Value) "'" + $Value.Replace("'", "''") + "'" }
$command = '& ' + (& $quote (Join-Path $PSScriptRoot 'test-native-lifecycle.ps1')) + ' -RuntimePayload ' + (& $quote $RuntimePayload) + ' -ReportPath ' + (& $quote $ReportPath)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$logPath = Join-Path $build 'worker.log'
$logCs = $logPath.Replace('\','\\').Replace('"','\"')
$entry = Join-Path $build 'entry.cs'
Set-Content -LiteralPath $entry -Encoding UTF8 -Value @"
using System;
using System.Text;
using System.Runtime.InteropServices;
class NativeVerification {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [STAThread] static int Main() {
    if (GetConsoleWindow() != IntPtr.Zero) return 8;
    return RescoreMaintenance.RunHiddenPowerShell(Encoding.Unicode.GetString(Convert.FromBase64String("$encoded")), "$logCs");
  }
}
"@
$executable = Join-Path $build 'Rescore Lifecycle Verification.exe'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /main:NativeVerification "/out:$executable" (Join-Path $PSScriptRoot 'maintenance-launcher.cs') $entry
if ($LASTEXITCODE -ne 0) { throw 'Could not compile native lifecycle verification.' }
Remove-Item -LiteralPath $ReportPath -Force -ErrorAction SilentlyContinue
# Elevate a GUI program, preserving the same no-console boundary as production.
$process = Start-Process -FilePath $executable -Verb RunAs -WindowStyle Hidden -PassThru
Write-Output "Verification process: $($process.Id)"
Write-Output "Report: $ReportPath"
Write-Output "Worker diagnostics: $logPath"
