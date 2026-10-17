# Production GUI broker/PowerShell workers with a stub management script.
# The alternate entry point skips only privilege detection; no UAC or SCM changes.
$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ("rescore-installer-test-" + [Guid]::NewGuid() + " Program Files O'Brien")
[void][IO.Directory]::CreateDirectory($temp)
function Assert-Test($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Invoke-Hidden([string]$File, [string]$Arguments) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $File; $start.Arguments = $Arguments
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  $output = $process.StandardOutput.ReadToEndAsync(); $errors = $process.StandardError.ReadToEndAsync()
  if (!$process.WaitForExit(30000)) { $process.Kill(); throw 'Native fixture timed out.' }
  if ($errors.Result) { Write-Host $errors.Result }
  if ($process.ExitCode -ne 0 -and $output.Result) { Write-Host $output.Result }
  $code = $process.ExitCode; $process.Dispose(); return $code
}
try {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'maintenance.ps1') -Destination $temp
  $harness = Join-Path $temp 'fixture.cs'
  Set-Content -LiteralPath $harness -Encoding UTF8 -Value @'
using System;
using System.IO;
using System.Runtime.InteropServices;
class Fixture {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  static int Main(string[] args) {
    if (GetConsoleWindow() != IntPtr.Zero) return 8;
    return RescoreMaintenance.Run(args, true);
  }
}
'@
  $native = Join-Path $temp 'console-probe.cs'
  Set-Content -LiteralPath $native -Encoding UTF8 -Value @'
using System;
using System.IO;
using System.Runtime.InteropServices;
class NativeProbe {
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  static void Main(string[] args) { File.WriteAllText(args[0], GetConsoleWindow().ToInt64().ToString()); }
}
'@
  $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $broker = Join-Path $temp 'Rescore Maintenance.exe'
  $brokerSource = Join-Path $PSScriptRoot 'maintenance-launcher.cs'
  $compileExit = Invoke-Hidden $compiler ('/nologo /target:winexe /platform:x64 /main:Fixture /out:"' + $broker + '" "' + $brokerSource + '" "' + $harness + '"')
  Assert-Test ($compileExit -eq 0) 'GUI broker fixture must compile.'
  $nativeExe = Join-Path $temp 'console-probe.exe'
  $compileExit = Invoke-Hidden $compiler ('/nologo /target:exe /platform:x64 /out:"' + $nativeExe + '" "' + $native + '"')
  Assert-Test ($compileExit -eq 0) 'Native console probe must compile.'
  $bytes = [IO.File]::ReadAllBytes($broker)
  $pe = [BitConverter]::ToInt32($bytes, 60)
  Assert-Test ([BitConverter]::ToUInt16($bytes, $pe + 24 + 68) -eq 2) 'Broker must use the Windows GUI subsystem.'
  Set-Content -LiteralPath (Join-Path $temp 'manage-service.ps1') -Encoding UTF8 -Value @'
param([string]$Action, [string]$DataDir, [switch]$DeleteCatalogue)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'calls.txt') -Value ("$Action|$([Environment]::Is64BitProcess)|$DeleteCatalogue|$([ConsoleProbe]::GetConsoleWindow().ToInt64())")
& (Join-Path $PSScriptRoot 'console-probe.exe') (Join-Path $PSScriptRoot 'native-console.txt')
if ($Action -in @('Install','EnsureRunning','Retry') -and $DataDir -ne $env:RESCORE_TEST_DATA) { exit 9 }
if ($env:RESCORE_TEST_NO_RESULT) { [Environment]::Exit(0) }
if ($Action -eq 'RemoveAll') { exit 4 }
if ($Action -eq 'Install' -and $env:RESCORE_TEST_UPGRADE_EXIT) { exit 5 }
exit 0
'@
  $env:RESCORE_TEST_DATA = Join-Path $env:APPDATA 'Rescore\data'
  $hosts = @($broker, (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'), (Join-Path $env:SystemRoot 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'))
  foreach ($hostPath in $hosts) {
    foreach ($case in @('Install', 'UpgradeAll', 'EnsureRunning', 'Retry', 'RemoveAll', 'Delete')) {
      $action = if ($case -eq 'Delete') { 'RemoveAll' } else { $case }
      $calls = Join-Path $temp 'calls.txt'
      Remove-Item -LiteralPath $calls -Force -ErrorAction SilentlyContinue
      if ($hostPath -eq $broker) {
        $arguments = '--action ' + $action
        if ($case -eq 'Delete') { $arguments += ' --delete-catalogue' }
      } else {
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $temp 'maintenance.ps1') + '" -Action ' + $action
        if ($case -eq 'Delete') { $arguments += ' -DeleteCatalogue' }
      }
      $code = Invoke-Hidden $hostPath $arguments
      $expectedExit = if ($action -eq 'RemoveAll') { 4 } else { 0 }
      $actualCalls = @(Get-Content -LiteralPath $calls -ErrorAction SilentlyContinue)
      $expectedCalls = @("$action|True|False|0")
      if ($case -eq 'Delete') { $expectedCalls = @('RemoveAll|True|True|0') }
      Assert-Test ($code -eq $expectedExit -and ($actualCalls -join ',') -eq ($expectedCalls -join ',')) "Maintenance $action failed through $hostPath (exit $code; calls $actualCalls)."
      Assert-Test (([IO.File]::ReadAllText((Join-Path $temp 'native-console.txt'))).Trim() -eq '0') 'Native descendants must not allocate a console.'
    }
  }
  $env:RESCORE_TEST_UPGRADE_EXIT = '5'
  Remove-Item -LiteralPath $calls -Force
  $code = Invoke-Hidden $broker '--action Install'
  Assert-Test ($code -eq 5 -and @(Get-Content -LiteralPath $calls).Count -eq 1) 'Failed upgrade must stop registration.'
  Remove-Item Env:RESCORE_TEST_UPGRADE_EXIT
  $env:RESCORE_TEST_NO_RESULT = '1'
  $code = Invoke-Hidden $broker '--action EnsureRunning'
  Assert-Test ($code -eq 1) 'Missing completion must fail even when PowerShell exits zero.'
  Remove-Item Env:RESCORE_TEST_NO_RESULT
  $code = Invoke-Hidden $broker '--action Retry --delete-catalogue'
  Assert-Test ($code -eq 1) 'Catalogue deletion must be rejected outside removal.'
  Write-Output 'PASS: GUI broker, 32/64-bit callers, workers and native descendants without consoles, upgrade ordering, deletion, and failure propagation'
} finally {
  Remove-Item Env:RESCORE_TEST_DATA, Env:RESCORE_TEST_UPGRADE_EXIT, Env:RESCORE_TEST_NO_RESULT -ErrorAction SilentlyContinue
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-installer-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
