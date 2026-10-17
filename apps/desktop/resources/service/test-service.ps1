$ErrorActionPreference = 'Stop'
foreach ($test in @('test-helper.ps1', 'test-maintenance.ps1', 'test-installer-workflow.ps1', 'test-lifecycle.ps1', 'test-installer-files.ps1', 'test-installer-processes.ps1', 'test-logs.ps1')) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot $test) + '"'
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  # npm launched from PowerShell 7 can retain modules incompatible with Windows PowerShell.
  $start.EnvironmentVariables['PSModulePath'] = Join-Path $PSHOME 'Modules'
  $process = [Diagnostics.Process]::Start($start)
  $output = $process.StandardOutput.ReadToEndAsync()
  $errorOutput = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  if ($output.Result) { Write-Output $output.Result.TrimEnd() }
  if ($errorOutput.Result) { Write-Output $errorOutput.Result.TrimEnd() }
  if ($process.ExitCode -ne 0) { throw "$test failed (exit $($process.ExitCode))." }
  $process.Dispose()
}
