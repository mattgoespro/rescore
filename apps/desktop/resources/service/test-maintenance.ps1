$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'maintenance.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($function in $tree.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $function.Extent.Text
}
function Assert-Test($Condition, [string]$Message) { if (!$Condition) { throw $Message } }

$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-maintenance-test-' + [Guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($temp)
try {
  $stub = Join-Path $temp 'manage-service.ps1'
  $calls = Join-Path $temp 'calls.txt'
  $callsQuoted = $calls.Replace("'", "''")
  Set-Content -LiteralPath $stub -Encoding ASCII -Value @"
param([string]`$Action, [string]`$DataDir)
Add-Content -LiteralPath '$callsQuoted' -Value `$Action
if (`$Action -eq 'Install' -and `$env:RESCORE_TEST_UPGRADE_EXIT) { exit ([int]`$env:RESCORE_TEST_UPGRADE_EXIT) }
if (`$Action -eq 'Install' -and `$DataDir -ne 'C:\Users\Tester\AppData\Roaming\Rescore\data') { exit 9 }
if (`$Action -eq 'RemoveAll') { exit 4 }
exit 0
"@
  function Invoke-CommandFile([string]$Command) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
    $output = Join-Path $temp 'stdout.txt'
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $output -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded)
    return $process.ExitCode
  }
  $result = Join-Path $temp 'result.txt'
  $remove = Get-ElevatedMaintenanceCommand 'RemoveAll' $stub $result $null
  Assert-Test ($remove.Contains('-Action RemoveAll') -and $remove.Contains($result)) 'Removal command must record its result'
  $removeExit = Invoke-CommandFile $remove
  Assert-Test ($removeExit -eq 4 -and (Get-Content -LiteralPath $result -Raw).Trim() -eq '4') 'Removal must preserve a non-zero service exit code'
  Remove-Item -LiteralPath $calls, $result -Force -ErrorAction SilentlyContinue

  $env:RESCORE_TEST_UPGRADE_EXIT = '5'
  $failed = Get-ElevatedMaintenanceCommand 'Install' $stub $result 'C:\Users\Tester\AppData\Roaming\Rescore\data'
  $failedExit = Invoke-CommandFile $failed
  $failedCalls = @(Get-Content -LiteralPath $calls -ErrorAction SilentlyContinue)
  Assert-Test ($failedExit -eq 5 -and (Get-Content -LiteralPath $result -Raw).Trim() -eq '5' -and $failedCalls -eq @('Install')) 'Failed reconciliation must propagate without a second registration process'
  Remove-Item Env:RESCORE_TEST_UPGRADE_EXIT
  Remove-Item -LiteralPath $calls, $result -Force -ErrorAction SilentlyContinue

  $installed = Get-ElevatedMaintenanceCommand 'Install' $stub $result 'C:\Users\Tester\AppData\Roaming\Rescore\data'
  $installedExit = Invoke-CommandFile $installed
  $installedCalls = @(Get-Content -LiteralPath $calls)
  Assert-Test ($installedExit -eq 0 -and (Get-Content -LiteralPath $result -Raw).Trim() -eq '0' -and ($installedCalls -join ',') -eq 'Install') 'Setup must use one service operation and one lock'
} finally {
  Remove-Item Env:RESCORE_TEST_UPGRADE_EXIT -ErrorAction SilentlyContinue
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-maintenance-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}


Write-Output 'PASS: maintenance upgrade ordering and failure propagation'
