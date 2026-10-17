# Non-elevated checks: parse helpers and exercise only temporary files / read-only SCM status.
param([string]$Wrapper)
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'manage-service.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($function in $tree.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $function.Extent.Text
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-helper-test-' + [Guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($temp)
try {
  $binaryRoot = $temp
  $runtime = Join-Path $temp 'runtime'
  [void][IO.Directory]::CreateDirectory($runtime)
  Assert-Contained $runtime $temp
  $escaped = $false
  try { Assert-Contained (Join-Path $temp '..\escape') $temp } catch { $escaped = $true }
  if (!$escaped) { throw 'Containment check accepted escaped path' }
  $untrusted = $false
  try { Protect-Directory $runtime '' } catch { $untrusted = $true }
  if (!$untrusted) { throw 'Unprivileged owner was accepted for service code' }
  Write-Json (Join-Path $temp 'record.json') @{phase='enabling'}
  Write-Json (Join-Path $temp 'record.json') @{phase='ready'}
  if ((Get-Content -LiteralPath (Join-Path $temp 'record.json') -Raw | ConvertFrom-Json).phase -ne 'ready') { throw 'Atomic record update failed' }
  $name = 'RescoreCatalogue-Validation-' + [Guid]::NewGuid()
  Write-Wrapper $runtime $name $temp
  [xml]$xml = Get-Content -LiteralPath (Join-Path $runtime 'RescoreService.xml') -Raw
  if ($xml.service.name -ne 'Rescore API' -or $xml.service.id -ne $name) { throw 'Service display name or profile identity invalid' }
  if (!$xml.service.startarguments -or !$xml.service.stoparguments -or $xml.service.arguments) { throw 'WinSW start/stop contract invalid' }
  if ($xml.service.startmode -ne 'Manual' -or $xml.service.delayedAutoStart -ne 'false') { throw 'Fresh registration must remain inactive until first launch' }
  Write-Wrapper $runtime $name $temp $true
  [xml]$xml = Get-Content -LiteralPath (Join-Path $runtime 'RescoreService.xml') -Raw
  if ($xml.service.startmode -ne 'Automatic' -or $xml.service.delayedAutoStart -ne 'true') { throw 'Activated service must start after Windows boot' }
  $legacy = Join-Path $runtime 'dist\scripts'
  [void][IO.Directory]::CreateDirectory($legacy)
  foreach ($entry in @('service-data', 'service-stop')) { [IO.File]::WriteAllText((Join-Path $legacy "$entry.js"), '') }
  Write-Wrapper $runtime $name $temp $true
  [xml]$xml = Get-Content -LiteralPath (Join-Path $runtime 'RescoreService.xml') -Raw
  if ($xml.service.stoparguments -notmatch 'dist\\scripts\\service-stop.js') { throw 'Recovery must retain the stop entry point of an older installed runtime' }
  if ((Get-LifecycleEntry $runtime 'service-data') -ne 'dist\scripts\service-data.js') { throw 'Data recovery must support older installed runtimes' }
  $current = Join-Path $runtime 'dist\lifecycle'
  [void][IO.Directory]::CreateDirectory($current)
  foreach ($entry in @('service-data', 'service-stop')) { [IO.File]::WriteAllText((Join-Path $current "$entry.js"), '') }
  Write-Wrapper $runtime $name $temp $true
  [xml]$xml = Get-Content -LiteralPath (Join-Path $runtime 'RescoreService.xml') -Raw
  if ($xml.service.stoparguments -notmatch 'dist\\lifecycle\\service-stop.js') { throw 'New runtimes must prefer functional lifecycle entry points' }
  if ((Get-LifecycleEntry $runtime 'service-data') -ne 'dist\lifecycle\service-data.js') { throw 'Data transfer must prefer the new lifecycle entry point' }
  if ($Wrapper) {
    Copy-Item -LiteralPath $Wrapper -Destination (Join-Path $runtime 'RescoreService.exe')
    $status = & (Join-Path $runtime 'RescoreService.exe') status
    if ($status -notmatch 'NonExistent') { throw "Unexpected wrapper status: $status" }
  }
  Write-Output 'PowerShell path, ownership, atomic record, XML, and read-only wrapper checks passed.'
} finally {
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-helper-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
