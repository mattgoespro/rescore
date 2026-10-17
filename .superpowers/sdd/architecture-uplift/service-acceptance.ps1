param([ValidateSet('Stop','Start','Crash','Snapshot','RecoverRegistration')][string]$Action)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$serviceName = 'RescoreCatalogue'
$record = Get-Content -Raw -LiteralPath "$env:ProgramData\Rescore\installation.json" | ConvertFrom-Json
if ($record.serviceName -ne $serviceName -or $record.desktopRoot -ne 'C:\Program Files\Rescore' -or $record.phase -ne 'ready') { throw 'Installed catalogue identity is not ready for acceptance testing.' }
$service = Get-CimInstance Win32_Service -Filter "Name='RescoreCatalogue'"
if (!$service) { throw 'Installed catalogue service missing.' }
if ($Action -eq 'Stop') {
  Stop-Service -Name $serviceName
  $controller = Get-Service -Name $serviceName
  try { $controller.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(40)) } finally { $controller.Dispose() }
} elseif ($Action -eq 'Start') {
  Start-Service -Name $serviceName
} elseif ($Action -eq 'RecoverRegistration') {
  # Restore a fresh SCM restart budget after deliberate crash testing. Retain
  # registration/configuration and every catalogue/runtime file for production Retry.
  $managementLock = [IO.File]::Open("$env:ProgramData\Rescore\management.lock", 'OpenOrCreate', 'ReadWrite', 'None')
  try {
    Stop-Service -Name $serviceName
    $controller = Get-Service -Name $serviceName
    try { $controller.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(40)) } finally { $controller.Dispose() }
    & "$env:SystemRoot\System32\sc.exe" delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the test-exercised SCM registration.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
      $controller = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if (!$controller) { break }
      $controller.Dispose()
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($controller) { throw 'Windows has not released the test-exercised SCM registration.' }
  } finally { $managementLock.Dispose() }
  $maintenance = Join-Path $record.desktopRoot 'resources\service\Rescore Maintenance.exe'
  & $maintenance '--action' 'Retry' '--data-dir' ([string]$record.originalDataDir) | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Production Retry did not reconstruct the retained registration.' }
} elseif ($Action -eq 'Snapshot') {
  $snapshot = Join-Path $PSScriptRoot 'snapshot-installed.cjs'
  $config = Get-Content -Raw -LiteralPath "$env:ProgramData\Rescore\config.json" | ConvertFrom-Json
  & (Join-Path $record.runtime 'node.exe') $snapshot (Join-Path $config.dataDir 'catalog.sqlite') (Join-Path $env:TEMP 'rescore-installed-acceptance-20261014\data-final.json') (Join-Path $record.runtime 'node_modules\better-sqlite3')
  if ($LASTEXITCODE -ne 0) { throw 'Catalogue snapshot verification failed.' }
} else {
  if ($service.State -ne 'Running') { throw 'Crash recovery requires a running service.' }
  $nodePath = Join-Path $record.runtime 'node.exe'
  $nodes = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId)" | Where-Object { $_.ExecutablePath -eq $nodePath })
  if ($nodes.Count -ne 1) { throw 'Cannot identify the unique catalogue API child.' }
  Stop-Process -Id $nodes[0].ProcessId -Force
}
$facts = Get-CimInstance Win32_Service -Filter "Name='RescoreCatalogue'" | Select-Object Name,State,StartMode,ProcessId
[IO.File]::WriteAllText((Join-Path $env:TEMP "rescore-installed-acceptance-20261014\service-$Action.json"), ($facts | ConvertTo-Json))
