param(
  [string]$LogPath = (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'Rescore\logs\RescoreService.out.log'),
  [switch]$Once
)
$ErrorActionPreference = 'Stop'
Write-Output 'Rescore API live log'
if (!(Test-Path -LiteralPath $LogPath)) {
  Write-Output 'No catalogue log is available yet. Open Rescore to start the catalogue service, then reopen Rescore Logs.'
  return
}
if ($Once) { Get-Content -LiteralPath $LogPath -Encoding UTF8 -Tail 50 }
else { Get-Content -LiteralPath $LogPath -Encoding UTF8 -Tail 50 -Wait }
