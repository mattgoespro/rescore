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
function Protect-Directory([string]$Path, [string]$ServiceSid = '', [bool]$Writable = $false, [bool]$SharedRead = $false) {
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
  if ($script:failStage) { throw 'Simulated staging failure' }
  $script:state.stages++
  return [string](Get-Content -LiteralPath (Join-Path $payload 'service-manifest.json') -Raw | ConvertFrom-Json).version
}
function Copy-Data([string]$Runtime, [string]$Source, [string]$Target) {
  Assert-Contained $Source $temp; Assert-Contained $Target $temp
  [void][IO.Directory]::CreateDirectory($Target)
  if ($script:failCopy) { throw 'Simulated copy failure' }
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
  } elseif ([IO.Path]::GetFileName($File) -eq 'sc.exe' -and $Arguments[0] -eq 'delete') {
    $script:state.registered = $false; $script:state.uninstalls++
  } else { throw 'Unexpected native command; no native command is executed by this test' }
}
function New-Fixture([string]$Case) {
  $script:failHealth = $false
  $script:failStage = $false; $script:failCopy = $false
  $script:DeleteCatalogue = $false
  $script:state = @{registered=$false;status='Stopped';starts=0;copies=0;stages=0;installs=0;uninstalls=0;startMode=''}
  $base = Join-Path $temp $Case
  $script:desktopRoot = Join-Path $base 'desktop'
  $script:payload = Join-Path $desktopRoot 'resources\api'
  $script:machineRoot = Join-Path $base 'machine'
  $script:binaryRoot = Join-Path $base 'binaries'
  $script:legacyBinaryRoot = Join-Path $base 'desktop\Catalogue'
  $script:profile = Join-Path $base 'user'
  $script:serviceName = 'RescoreCatalogue'
  $script:userData = Join-Path $profile 'AppData\Roaming\Rescore\data'
  $script:DataDir = $script:userData
  foreach ($dir in @($payload, $machineRoot, $binaryRoot, $userData)) { [void][IO.Directory]::CreateDirectory($dir) }
  Write-Json (Join-Path $payload 'service-manifest.json') @{version='1.0.0';files=@()}
  [IO.File]::WriteAllText((Join-Path $userData 'catalog.sqlite'), 'original catalogue')
  $script:recordPath = Join-Path $machineRoot 'installation.json'
  $script:configPath = Join-Path $machineRoot 'config.json'
}
function Read-Record { return Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json }
function Read-Config { return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
try {
  New-Fixture 'identical-reinstall'
  Manage-Profile 'Register'
  $beforeRecord = Read-Record; $beforeConfig = Read-Config
  $copies = $state.copies; $stages = $state.stages
  Manage-Profile 'UpgradeAll'
  Assert-Test ((Read-Record).runtime -eq $beforeRecord.runtime -and (Read-Config).dataDir -eq $beforeConfig.dataDir -and $state.copies -eq $copies -and $state.stages -eq $stages) 'Identical reinstall must not replace the service runtime or copy the catalogue'
  Write-Output 'PASS: identical reinstall reuses runtime and catalogue'

  New-Fixture 'embedded-runtime-migration'
  $canonicalRoot = $binaryRoot
  $script:binaryRoot = $legacyBinaryRoot
  Manage-Profile 'Register'
  $oldRuntime = (Read-Record).runtime
  $script:binaryRoot = $canonicalRoot
  Manage-Profile 'Install'
  Assert-Test ((Read-Record).runtime.StartsWith($canonicalRoot + '\') -and !(Test-Path $oldRuntime)) 'Reinstall must migrate embedded service files outside the app folder'
  Write-Output 'PASS: embedded service runtime migrates outside the desktop install'

  New-Fixture 'interrupted-uninstall-reinstall'
  Manage-Profile 'EnsureRunning'
  [IO.File]::WriteAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite'), 'latest service catalogue')
  $record = Read-Record; $record.phase = 'disabling'; Write-Json $recordPath $record
  Manage-Profile 'Install'
  Assert-Test ((Read-Record).enabled -and (Read-Record).phase -eq 'ready' -and [IO.File]::ReadAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite')) -eq 'latest service catalogue') 'Reinstall must recover interrupted removal without reseeding stale desktop data'
  Write-Output 'PASS: reinstall recovers interrupted uninstall'

  New-Fixture 'missing-wrapper-removal'
  Manage-Profile 'Register'
  $missingWrapper = Join-Path (Read-Record).runtime 'RescoreService.exe'
  Assert-Contained $missingWrapper $temp
  Remove-Item -LiteralPath $missingWrapper -Force
  Manage-Profile 'RemoveAll'
  Assert-Test (!$state.registered -and !(Read-Record).enabled) 'Uninstall must remove SCM registration even when its wrapper file is missing'
  Write-Output 'PASS: missing wrapper does not block service removal'

  New-Fixture 'missing-runtime-reinstall'
  Manage-Profile 'Register'
  Remove-Runtime (Read-Record).runtime
  $state.registered = $false
  Manage-Profile 'Install'
  Assert-Test ($state.registered -and (Test-Path -LiteralPath (Join-Path (Read-Record).runtime 'RescoreService.exe'))) 'Reinstall must reconstruct missing runtime and SCM registration without losing retained data'
  Write-Output 'PASS: reinstall reconstructs missing runtime and SCM registration'

  New-Fixture 'activation'
  Manage-Profile 'Register'
  $record = Read-Record
  Assert-Test ($state.registered -and $state.status -eq 'Stopped' -and $state.starts -eq 0 -and $state.startMode -eq 'Manual') 'Fresh registration must stay stopped and Manual'
  Assert-Test ($record.enabled -and !$record.activated -and $record.phase -eq 'ready') 'Fresh registration must remain inactive'
  Manage-Profile 'EnsureRunning'
  Assert-Test ((Read-Record).activated -and $state.status -eq 'Running' -and $state.startMode -eq 'delayed-auto') 'First launch must activate automatic service startup'
  $runtime = (Read-Record).runtime; $copies = $state.copies; $stages = $state.stages
  Manage-Profile 'EnsureRunning'
  Assert-Test ((Read-Record).runtime -eq $runtime -and $state.copies -eq $copies -and $state.stages -eq $stages) 'Repeated launch must reuse runtime and data'
  Write-Output 'PASS: registration, activation, repeated launch'

  New-Fixture 'inactive-upgrade'
  Manage-Profile 'Register'
  Write-Json (Join-Path $payload 'service-manifest.json') @{version='2.0.0';files=@()}
  Manage-Profile 'UpgradeAll'
  $record = Read-Record; [xml]$wrapper = Get-Content -LiteralPath (Join-Path $record.runtime 'RescoreService.xml') -Raw
  Assert-Test (!$record.activated -and $state.starts -eq 0 -and $state.status -eq 'Stopped' -and $wrapper.service.startmode -eq 'Manual') 'Upgrade must not activate an unused installation'
  Assert-Test ((Read-Config).runtimeVersion -eq '2.0.0') 'Inactive upgrade must install the new runtime'
  Write-Output 'PASS: inactive upgrade stays stopped'

  New-Fixture 'missing-registration'
  Manage-Profile 'EnsureRunning'
  $config = Read-Config; $copies = $state.copies
  [IO.File]::WriteAllText((Join-Path $config.dataDir 'catalog.sqlite'), 'hydrated catalogue')
  $state.registered = $false; $state.status = 'Stopped'
  Manage-Profile 'EnsureRunning'
  Assert-Test ($state.registered -and $state.status -eq 'Running' -and $state.copies -eq $copies) 'Missing SCM registration must repair without recopying data'
  Assert-Test ((Read-Config).dataDir -eq $config.dataDir -and [IO.File]::ReadAllText((Join-Path $config.dataDir 'catalog.sqlite')) -eq 'hydrated catalogue') 'Registration repair must retain the current catalogue'
  Write-Output 'PASS: missing registration preserves hydrated data'

  New-Fixture 'interrupted-registration'
  Manage-Profile 'Register'
  $record = Read-Record; $record.phase = 'enabling'; Write-Json $recordPath $record
  Manage-Profile 'Register'
  Assert-Test ((Read-Record).phase -eq 'ready' -and !(Read-Record).activated -and $state.uninstalls -eq 1 -and $state.starts -eq 0) 'Interrupted registration must recover without activation'
  Assert-Test ([IO.File]::ReadAllText((Join-Path $userData 'catalog.sqlite')) -eq 'original catalogue') 'Recovery must preserve original catalogue'
  Write-Output 'PASS: interrupted registration recovery'

  foreach ($activated in @($false, $true)) {
    New-Fixture "relocated-$activated"
    Manage-Profile 'Register'
    if ($activated) { Manage-Profile 'EnsureRunning' }
    $oldRoot = $desktopRoot
    $oldPayload = $payload
    $before = Read-Config
    [IO.File]::WriteAllText((Join-Path $before.dataDir 'catalog.sqlite'), 'current service catalogue')
    $script:desktopRoot = Join-Path (Split-Path -Parent $oldRoot) 'new-app-location'
    $script:payload = Join-Path $desktopRoot 'resources\api'
    [void][IO.Directory]::CreateDirectory($payload)
    Copy-Item -LiteralPath (Join-Path $oldPayload 'service-manifest.json') -Destination $payload
    $operation = if ($activated) { 'EnsureRunning' } else { 'Register' }
    Manage-Profile $operation
    Assert-Test ((Read-Record).desktopRoot -eq $desktopRoot) 'New app location must adopt the registration automatically'
    Assert-Test ([IO.File]::ReadAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite')) -eq 'current service catalogue') 'Relocation must preserve the latest service data'
    Assert-Test ((Read-Record).activated -eq $activated) 'Installer adoption must preserve activation state'
    if (!$activated) { Assert-Test ($state.starts -eq 0) 'Relocation must not start a never-activated service' }
    $script:desktopRoot = $oldRoot
    $rejected = $false
    try { Manage-Profile 'Disable' } catch { $rejected = $true }
    Assert-Test ($rejected -and $state.registered) 'Old app location must not remove the adopted service'
  }
  Write-Output 'PASS: moved unpacked folder and installed-copy adoption preserve data and activation'

  New-Fixture 'relocation-rollback'
  Manage-Profile 'EnsureRunning'
  $beforeRecord = Read-Record; $beforeConfig = Read-Config
  $oldPayload = $payload
  $script:desktopRoot = Join-Path (Split-Path -Parent $desktopRoot) 'failing-new-location'
  $script:payload = Join-Path $desktopRoot 'resources\api'
  [void][IO.Directory]::CreateDirectory($payload)
  Copy-Item -LiteralPath (Join-Path $oldPayload 'service-manifest.json') -Destination $payload
  $script:failHealth = $true
  $failed = $false
  try { Manage-Profile 'EnsureRunning' } catch { $failed = $true }
  Assert-Test ($failed -and (Read-Record).desktopRoot -eq $beforeRecord.desktopRoot -and (Read-Record).runtime -eq $beforeRecord.runtime) 'Failed relocation must preserve the previous managing app and runtime'
  Assert-Test ((Read-Config).dataDir -eq $beforeConfig.dataDir -and $state.status -eq 'Running') 'Failed relocation must restore the prior catalogue and restart it'
  Write-Output 'PASS: failed relocation rolls back app ownership, runtime, and data'

  $failures = @()
  foreach ($case in @('register-missing-scm', 'failed-stage', 'rolled-back-removal', 'interrupted-removal', 'remove-missing-scm')) {
    try {
      New-Fixture $case
      if ($case -eq 'failed-stage') {
        $script:failStage = $true
        try { Manage-Profile 'Register' } catch {}
        Assert-Test (@(Get-ChildItem -LiteralPath $binaryRoot -ErrorAction SilentlyContinue).Count -eq 0) 'Failed runtime staging must clean up its partial executable files'
      } elseif ($case -eq 'rolled-back-removal') {
        $script:failCopy = $true
        try { Manage-Profile 'Register' } catch {}
        $script:failCopy = $false
        Manage-Profile 'RemoveAll'
        Assert-Test (!(Test-Path -LiteralPath $binaryRoot)) 'Removal must clean protected runtime files after failed registration'
      } else {
        Manage-Profile 'Register'
        if ($case -eq 'register-missing-scm') {
          $state.registered = $false
          Manage-Profile 'Register'
          Assert-Test $state.registered 'Installer registration must repair a ready record whose SCM service is missing'
        } else {
          if ($case -eq 'interrupted-removal') { $record = Read-Record; $record.phase = 'enabling'; Write-Json $recordPath $record }
          if ($case -eq 'remove-missing-scm') { $state.registered = $false }
          Manage-Profile 'RemoveAll'
          Assert-Test (!$state.registered -and !(Read-Record).enabled -and !(Test-Path -LiteralPath $binaryRoot)) 'Removal must finish interrupted registration or missing SCM cleanup'
          Assert-Test ([IO.File]::ReadAllText((Join-Path $userData 'catalog.sqlite')) -eq 'original catalogue') 'Removal must preserve the original catalogue'
        }
      }
      Write-Output "PASS: $case"
    } catch { $failures += "$case : $($_.Exception.Message)" }
  }
  if ($failures.Count) { throw ($failures -join "`n") }

  New-Fixture 'uninstall-preserves-data'
  Manage-Profile 'EnsureRunning'
  [IO.File]::WriteAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite'), 'latest service catalogue')
  $script:DataDir = $null
  $latest = (Read-Config).dataDir; $copies = $state.copies
  Invoke-ServiceManagement 'RemoveAll'
  Assert-Test (!$state.registered -and !(Test-Path $binaryRoot)) 'Uninstall must remove the registered service and protected runtime'
  Assert-Test ([IO.File]::ReadAllText((Join-Path $latest 'catalog.sqlite')) -eq 'latest service catalogue' -and $state.copies -eq $copies) 'Uninstall must retain shared catalogue without copying it into a Windows profile'
  Assert-Test ([IO.File]::ReadAllText((Join-Path $userData 'catalog.sqlite')) -eq 'original catalogue') 'Uninstall must leave original desktop data intact'
  $script:DataDir = $userData
  Manage-Profile 'Install'
  Assert-Test ([IO.File]::ReadAllText((Join-Path (Read-Config).dataDir 'catalog.sqlite')) -eq 'latest service catalogue') 'Same-user reinstall must seed from retained shared data, never the stale desktop copy'
  Write-Output 'PASS: uninstall and same-user reinstall preserve the latest shared catalogue'

  New-Fixture 'uninstall-deletes-data'
  Manage-Profile 'EnsureRunning'
  $settings = Join-Path (Split-Path -Parent $userData) 'rescore.json'
  [IO.File]::WriteAllText($settings, 'settings')
  $recovery = "$userData.backup-$([Guid]::NewGuid())"
  [void][IO.Directory]::CreateDirectory($recovery)
  $script:DataDir = $null; $script:DeleteCatalogue = $true; $copies = $state.copies
  Invoke-ServiceManagement 'RemoveAll'
  Assert-Test (!$state.registered -and !(Read-Record).enabled -and !(Test-Path $binaryRoot)) 'Explicit deletion must remove the service before its runtime'
  Assert-Test (!(Test-Path $userData) -and !(Test-Path $recovery) -and !(Test-Path (Read-Config).dataDir)) 'Explicit deletion must remove desktop, shared, and recovery catalogue copies'
  Assert-Test ((Test-Path $settings) -and (Test-Path (Join-Path $machineRoot 'logs')) -and $state.copies -eq $copies) 'Deletion must keep settings/logs and avoid an unnecessary catalogue copy'
  Write-Output 'PASS: explicit uninstall deletion keeps settings and logs'

  New-Fixture 'deleted-windows-profile'
  Manage-Profile 'EnsureRunning'
  $latest = (Read-Config).dataDir
  Assert-Contained $profile $temp
  Remove-Item -LiteralPath $profile -Recurse -Force
  Invoke-ServiceManagement 'RemoveAll'
  Assert-Test (!(Test-Path $profile) -and (Test-Path $latest) -and !$state.registered) 'A missing Windows profile must not be recreated or lose the retained catalogue'
  Write-Output 'PASS: deleted Windows profile retains the shared catalogue'
  $script:DataDir = Join-Path $temp 'new-user\AppData\Roaming\Rescore\data'
  [void][IO.Directory]::CreateDirectory((Join-Path $temp 'new-user'))
  Manage-Profile 'Register'
  Assert-Test ((Test-Path (Join-Path (Read-Config).dataDir 'catalog.sqlite')) -and !(Test-Path $profile)) 'Reinstall by another account must reuse retained data without recreating the deleted profile'
  Write-Output 'PASS: reinstall retains the catalogue after its original profile is gone'

  New-Fixture 'foreign-uninstall'
  Manage-Profile 'Register'
  $script:desktopRoot = Join-Path $temp 'another-install'
  $rejected = $false
  try { Invoke-ServiceManagement 'RemoveAll' } catch { $rejected = $true }
  Assert-Test ($rejected -and $state.registered -and (Test-Path $binaryRoot)) 'An unrelated uninstaller must stop before deleting the active runtime'
  Write-Output 'PASS: foreign uninstall cannot remove the active installation'

  New-Fixture 'orphan-runtime'
  [IO.File]::WriteAllText((Join-Path $binaryRoot 'leftover.exe'), '')
  Invoke-ServiceManagement 'RemoveAll'
  Assert-Test (!(Test-Path $binaryRoot)) 'No-record uninstall must clean its orphaned protected runtime'
  Write-Output 'PASS: orphaned runtime cleanup without SCM or a record'

  New-Fixture 'orphan-service'
  $state.registered = $true
  $rejected = $false
  try { Invoke-ServiceManagement 'RemoveAll' } catch { $rejected = $true }
  Assert-Test ($rejected -and (Test-Path $binaryRoot)) 'No-record uninstall must refuse to delete runtime files while an orphan service exists'
  Write-Output 'PASS: orphaned service blocks destructive cleanup'

  New-Fixture 'delete-linked-catalogue'
  Manage-Profile 'Register'
  $data = (Read-Config).dataDir
  $outside = Join-Path $temp 'unrelated-files'
  [void][IO.Directory]::CreateDirectory($outside)
  [IO.File]::WriteAllText((Join-Path $outside 'keep.txt'), 'unrelated')
  $junction = Join-Path $data 'linked-cache'
  New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
  try {
    $script:DeleteCatalogue = $true
    $rejected = $false
    try { Invoke-ServiceManagement 'RemoveAll' } catch { $rejected = $true }
    Assert-Test ($rejected -and (Test-Path $userData) -and (Test-Path (Join-Path $outside 'keep.txt'))) 'Deletion must reject links before deleting any retained data'
  } finally {
    Assert-Contained (Split-Path -Parent $junction) $temp
    [IO.Directory]::Delete($junction)
  }
  Write-Output 'PASS: catalogue deletion rejects linked paths and retains unrelated files'
} finally {
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-lifecycle-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
