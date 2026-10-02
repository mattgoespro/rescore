param([Parameter(Mandatory=$true)][ValidateSet('Install','UpgradeAll','RemoveAll')][string]$Action)
$ErrorActionPreference = 'Stop'
try {
  # Capture the installing user before elevation can change the Windows identity.
  if ($Action -eq 'Install') {
    $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($ownerSid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { throw 'The installing Windows user is not supported.' }
  } elseif (!(Get-Service -Name 'RescoreCatalogue-*' -ErrorAction SilentlyContinue)) { exit 0 }
  $script = Join-Path $PSScriptRoot 'manage-service.ps1'
  $quoted = "'" + $script.Replace("'", "''") + "'"
  if ($Action -eq 'Install') {
    $command = "`$ErrorActionPreference = 'Stop'; try { & $quoted -Action UpgradeAll; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }; & $quoted -Action Register -OwnerSid '$ownerSid'; exit `$LASTEXITCODE } catch { exit 1 }"
  } else {
    $command = "& $quoted -Action $Action; exit `$LASTEXITCODE"
  }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded)
  exit $process.ExitCode
} catch { exit 1 }
