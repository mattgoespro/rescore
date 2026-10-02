# Non-elevated lifecycle tests. Only function definitions are loaded; SCM and privilege operations are mocked.
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'manage-service.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($function in $tree.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $function.Extent.Text
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-lifecycle-test-' + [Guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($temp)
function Assert-Test($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Protect-Directory([string]$Path, [string]$Sid, [string]$ServiceSid = '', [bool]$Writable = $false) {
  Assert-Contained $Path $temp
  [void][IO.Directory]::CreateDirectory($Path)
}
function Get-Acl {
  param([string]$LiteralPath)
  Assert-Contained $LiteralPath $temp
  $acl = [pscustomobject]@{}
  $acl | Add-Member -MemberType ScriptMethod -Name GetOwner -Value { param($Type) [pscustomobject]@{Value='S-1-5-32-544'} }
  return $acl
}
function Get-ItemProperty { param([string]$LiteralPath, $ErrorAction) return [pscustomobject]@{ProfileImagePath=$script:profile} }
function Get-ServiceSid([string]$Name) { return 'S-1-5-80-1-2-3-4-5' }
function Get-Service {
  param([string]$Name, $ErrorAction)
  if ($script:state.registered) { return [pscustomobject]@{Status=$script:state.status} }
}
function Start-Service {
  param([string]$Name)
  Assert-Test $script:state.registered 'Starting an unregistered service'
  $script:state.starts++; $script:state.status = 'Running'
}
function Stop-Catalogue([string]$Name) { $script:state.status = 'Stopped' }
function Check-Health($Config) {
  Assert-Test ($script:state.status -eq 'Running') 'Health checked before service start'
  if ($script:failHealth) { $script:failHealth = $false; throw 'Simulated health failure' }
}
function Stage-Runtime([string]$Destination) {
  Assert-Contained $Destination $temp
  [void][IO.Directory]::CreateDirectory($Destination)
  [IO.File]::WriteAllText((Join-Path $Destination 'RescoreService.exe'), '')
  $script:state.stages++
  return [string](Get-Content -LiteralPath (Join-Path $payload 'service-manifest.json') -Raw | ConvertFrom-Json).version
}
function Copy-Data([string]$Runtime, [string]$Source, [string]$Target) {
  Assert-Contained $Source $temp; Assert-Contained $Target $temp
  [void][IO.Directory]::CreateDirectory($Target)
  foreach ($file in Get-ChildItem -LiteralPath $Source) { Copy-Item -LiteralPath $file.FullName -Destination $Target -Recurse }
  $script:state.copies++
}
function Run([string]$File, [string[]]$Arguments) {
  if ([IO.Path]::GetFileName($File) -eq 'RescoreService.exe') {
    Assert-Contained $File $temp
    if ($Arguments[0] -eq 'install') {
      $script:state.registered = $true; $script:state.status = 'Stopped'; $script:state.installs++
      [xml]$wrapper = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $File) 'RescoreService.xml') -Raw
      $script:state.startMode = [string]$wrapper.service.startmode
    } elseif ($Arguments[0] -eq 'uninstall') { $script:state.registered = $false; $script:state.uninstalls++ }
    else { throw 'Unexpected wrapper operation' }
  } elseif ([IO.Path]::GetFileName($File) -eq 'sc.exe' -and $Arguments[0] -eq 'config') {
    if ($Arguments[2] -eq 'start=') { $script:state.startMode = $Arguments[3] }
  } else { throw 'Unexpected native command; no native command is executed by this test' }
}
function New-Fixture([string]$Case) {
  $script:failHealth = $false
  $script:state = @{registered=$false;status='Stopped';starts=0;copies=0;stages=0;installs=0;uninstalls=0;startMode=''}
  $base = Join-Path $temp $Case
  $script:desktopRoot = Join-Path $base 'desktop'
  $script:payload = Join-Path $desktopRoot 'resources\api'
  $script:machineRoot = Join-Path $base 'machine'
  $script:binaryRoot = Join-Path $base 'binaries'
  $script:profile = Join-Path $base 'user'
  $script:OwnerSid = 'S-1-5-21-1-2-3-1001'
  $script:userData = Join-Path $profile 'AppData\Roaming\Rescore\data'
  foreach ($dir in @($payload, $machineRoot, $binaryRoot, $userData)) { [void][IO.Directory]::CreateDirectory($dir) }
  Write-Json (Join-Path $payload 'service-manifest.json') @{version='1.0.0';files=@()}
  [IO.File]::WriteAllText((Join-Path $userData 'catalog.sqlite'), 'original catalogue')
  $script:recordPath = Join-Path (Join-Path $machineRoot $OwnerSid) 'installation.json'
  $script:configPath = Join-Path (Join-Path $machineRoot $OwnerSid) 'config.json'
}
function Read-Record { return Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
function Read-Config { return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
try {
  New-Fixture 'activation'
  Manage-Profile $OwnerSid 'Register'
  $record = Read-Record
  Assert-Test ($state.registered -and $state.status -eq 'Stopped' -and $state.starts -eq 0 -and $state.startMode -eq 'Manual') 'Fresh registration must stay stopped and Manual'
  Assert-Test ($record.enabled -and !$record.activated -and $record.phase -eq 'ready') 'Fresh registration must remain inactive'
  Manage-Profile $OwnerSid 'EnsureRunning'
  Assert-Test ((Read-Record).activated -and $state.status -eq 'Running' -and $state.startMode -eq 'delayed-auto') 'First launch must activate automatic service startup'
  $runtime = (Read-Record).runtime; $copies = $state.copies; $stages = $state.stages
  Manage-Profile $OwnerSid 'EnsureRunning'
  Assert-Test ((Read-Record).runtime -eq $runtime -and $state.copies -eq $copies -and $state.stages -eq $stages) 'Repeated launch must reuse runtime and data'
  Write-Output 'PASS: registration, activation, repeated launch'

  New-Fixture 'inactive-upgrade'
  Manage-Profile $OwnerSid 'Register'
  Write-Json (Join-Path $payload 'service-manifest.json') @{version='2.0.0';files=@()}
  Manage-Profile $OwnerSid 'UpgradeAll'
  $record = Read-Record; [xml]$wrapper = Get-Content -LiteralPath (Join-Path $record.runtime 'RescoreService.xml') -Raw
  Assert-Test (!$record.activated -and $state.starts -eq 0 -and $state.status -eq 'Stopped' -and $wrapper.service.startmode -eq 'Manual') 'Upgrade must not activate an unused installation'
  Assert-Test ((Read-Config).runtimeVersion -eq '2.0.0') 'Inactive upgrade must install the new runtime'
  Write-Output 'PASS: inactive upgrade stays stopped'

  New-Fixture 'missing-registration'
  Manage-Profile $OwnerSid 'EnsureRunning'
  $config = Read-Config; $copies = $state.copies
  [IO.File]::WriteAllText((Join-Path $config.dataDir 'catalog.sqlite'), 'hydrated catalogue')
  $state.registered = $false; $state.status = 'Stopped'
  Manage-Profile $OwnerSid 'EnsureRunning'
  Assert-Test ($state.registered -and $state.status -eq 'Running' -and $state.copies -eq $copies) 'Missing SCM registration must repair without recopying data'
  Assert-Test ((Read-Config).dataDir -eq $config.dataDir -and [IO.File]::ReadAllText((Join-Path $config.dataDir 'catalog.sqlite')) -eq 'hydrated catalogue') 'Registration repair must retain the current catalogue'
  Write-Output 'PASS: missing registration preserves hydrated data'

  New-Fixture 'interrupted-registration'
  Manage-Profile $OwnerSid 'Register'
  $record = Read-Record; $record.phase = 'enabling'; Write-Json $recordPath $record
  Manage-Profile $OwnerSid 'Register'
  Assert-Test ((Read-Record).phase -eq 'ready' -and !(Read-Record).activated -and $state.uninstalls -eq 1 -and $state.starts -eq 0) 'Interrupted registration must recover without activation'
  Assert-Test ([IO.File]::ReadAllText((Join-Path $userData 'catalog.sqlite')) -eq 'original catalogue') 'Recovery must preserve original catalogue'
  Write-Output 'PASS: interrupted registration recovery'

  foreach ($activated in @($false, $true)) {
    New-Fixture "relocated-$activated"
    Manage-Profile $OwnerSid 'Register'
    if ($activated) { Manage-Profile $OwnerSid 'EnsureRunning' }
    $oldRoot = $desktopRoot
    $oldPayload = $payload
    $before = Read-Config
    [IO.File]::WriteAllText((Join-Path $before.dataDir 'catalog.sqlite'), 'current service catalogue')
    $script:desktopRoot = Join-Path (Split-Path -Parent $oldRoot) 'new-app-location'
    $script:payload = Join-Path $desktopRoot 'resources\api'
    [void][IO.Directory]::CreateDirectory($payload)
    Copy-Item -LiteralPath (Join-Path $oldPayload 'service-manifest.json') -Destination $payload
    $operation = if ($activated) { 'EnsureRunning' } else { 'Register' }
    Manage-Profile $OwnerSid $operation
    Assert-Test ((Read-Record).desktopRoot -eq $desktopRoot) 'New app location must adopt the registration automatically'
    Assert-Test ([IO.File]::ReadAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite')) -eq 'current service catalogue') 'Relocation must preserve the latest service data'
    Assert-Test ((Read-Record).activated -eq $activated) 'Installer adoption must preserve activation state'
    if (!$activated) { Assert-Test ($state.starts -eq 0) 'Relocation must not start a never-activated service' }
    $script:desktopRoot = $oldRoot
    $rejected = $false
    try { Manage-Profile $OwnerSid 'Disable' } catch { $rejected = $true }
    Assert-Test ($rejected -and $state.registered) 'Old app location must not remove the adopted service'
  }
  Write-Output 'PASS: moved unpacked folder and installed-copy adoption preserve data and activation'

  New-Fixture 'relocation-rollback'
  Manage-Profile $OwnerSid 'EnsureRunning'
  $beforeRecord = Read-Record; $beforeConfig = Read-Config
  $oldPayload = $payload
  $script:desktopRoot = Join-Path (Split-Path -Parent $desktopRoot) 'failing-new-location'
  $script:payload = Join-Path $desktopRoot 'resources\api'
  [void][IO.Directory]::CreateDirectory($payload)
  Copy-Item -LiteralPath (Join-Path $oldPayload 'service-manifest.json') -Destination $payload
  $script:failHealth = $true
  $failed = $false
  try { Manage-Profile $OwnerSid 'EnsureRunning' } catch { $failed = $true }
  Assert-Test ($failed -and (Read-Record).desktopRoot -eq $beforeRecord.desktopRoot -and (Read-Record).runtime -eq $beforeRecord.runtime) 'Failed relocation must preserve the previous managing app and runtime'
  Assert-Test ((Read-Config).dataDir -eq $beforeConfig.dataDir -and $state.status -eq 'Running') 'Failed relocation must restore the prior catalogue and restart it'
  Write-Output 'PASS: failed relocation rolls back app ownership, runtime, and data'
} finally {
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-lifecycle-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
