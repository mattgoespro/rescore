param(
  [Parameter(Mandatory=$true)][ValidateSet('Install','UpgradeAll','RemoveAll','EnsureRunning','Retry')][string]$Action,
  [switch]$Worker,
  [string]$ResultPath,
  [string]$DataDir,
  [switch]$DeleteCatalogue
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-ElevatedMaintenanceCommand([string]$MaintenanceAction, [string]$ScriptPath, [string]$ResultPath, [string]$DataDir, [bool]$DeleteData = $false) {
  if ($null -eq $DataDir) { $DataDir = '' }
  $scriptQ = "'" + $ScriptPath.Replace("'", "''") + "'"
  $resultQ = "'" + $ResultPath.Replace("'", "''") + "'"
  $dataQ = "'" + $DataDir.Replace("'", "''") + "'"
  $write = "[IO.File]::WriteAllText($resultQ, [string]`$code)"
  $deleteArgument = if ($DeleteData -and $MaintenanceAction -eq 'RemoveAll') { ' -DeleteCatalogue' } else { '' }
  if ($MaintenanceAction -in @('Install','EnsureRunning','Retry')) { $deleteArgument += " -DataDir $dataQ" }
  return @"
`$ErrorActionPreference = 'Stop'
try {
  & $scriptQ -Action $MaintenanceAction$deleteArgument
  `$code = 0
  if (`$null -ne `$LASTEXITCODE) { `$code = [int]`$LASTEXITCODE }
  $write
  exit `$code
} catch {
  try { [IO.File]::WriteAllText($resultQ, '1') } catch {}
  exit 1
}
"@
}

try {
  if ($DeleteCatalogue -and $Action -ne 'RemoveAll') { throw 'Catalogue deletion is only supported during removal.' }
  if ($Worker) {
    # Only the x64 GUI broker starts this worker. manage-service.ps1 also enforces
    # administrator rights before any protected service/filesystem operation.
    if (-not [Environment]::Is64BitProcess -or -not $ResultPath) { exit 1 }
    $command = Get-ElevatedMaintenanceCommand $Action (Join-Path $PSScriptRoot 'manage-service.ps1') $ResultPath $DataDir ([bool]$DeleteCatalogue)
    Invoke-Expression $command
    exit 1
  }
  # Compatibility for administrator CLI tooling, including a 32-bit caller.
  # The broker itself is x64 and has no console at the elevation boundary.
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = Join-Path $PSScriptRoot 'Rescore Maintenance.exe'
  $start.Arguments = '--action ' + $Action
  if ($DataDir) { $start.Arguments += ' --data-dir "' + $DataDir.TrimEnd('\') + '"' }
  if ($ResultPath) { $start.Arguments += ' --result "' + $ResultPath + '"' }
  if ($DeleteCatalogue) { $start.Arguments += ' --delete-catalogue' }
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $process = [Diagnostics.Process]::Start($start)
  try {
    if (-not $process.WaitForExit(1800000)) { exit 1 }
    exit $process.ExitCode
  } finally {
    $process.Dispose()
  }
} catch { exit 1 }
