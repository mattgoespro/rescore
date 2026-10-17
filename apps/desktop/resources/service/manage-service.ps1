param(
  [Parameter(Mandatory=$true)][ValidateSet('Install','Register','EnsureRunning','Enable','Disable','Retry','UpgradeAll','RemoveAll')][string]$Action,
  [string]$DataDir,
  [switch]$DeleteCatalogue
)
$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$payload = Join-Path $desktopRoot 'resources\api'
$machineRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'Rescore'
$programFiles = [Environment]::GetFolderPath('ProgramFiles')
$binaryRoot = Join-Path $programFiles 'Rescore Catalogue'
# Read old registrations while migrating service code out of the desktop folder.
$legacyBinaryRoot = Join-Path $programFiles 'Rescore\Catalogue'
$serviceName = 'RescoreCatalogue'

function Assert-NoLinks([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Service paths cannot contain links: $current"
      }
    }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
}
function Protect-Directory([string]$Path, [string]$ServiceSid = '', [bool]$Writable = $false, [bool]$SharedRead = $false) {
  Assert-NoLinks $Path
  if (Test-Path -LiteralPath $Path) {
    $owner = (Get-Acl -LiteralPath $Path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw "An untrusted directory occupies the service installation path: $Path" }
  }
  [void][IO.Directory]::CreateDirectory($Path)
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  foreach ($id in @('S-1-5-18','S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier($id)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$inherit,'None','Allow')))
  }
  if ($SharedRead) {
    $readers = New-Object Security.Principal.SecurityIdentifier('S-1-5-11')
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($readers,'ReadAndExecute',$inherit,'None','Allow')))
  }
  if ($ServiceSid) {
    $identity = New-Object Security.Principal.SecurityIdentifier($ServiceSid)
    $rights = if ($Writable) { 'Modify' } else { 'ReadAndExecute' }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,$rights,$inherit,'None','Allow')))
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}
function Run([string]$File, [string[]]$Arguments) {
  & $File @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Service operation failed ($([IO.Path]::GetFileName($File)), exit $LASTEXITCODE)." }
}
function Assert-Contained([string]$Path, [string]$Base) {
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
  if (!$full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Stored service path escaped its profile directory' }
  Assert-NoLinks $full
}
function Write-Json([string]$Path, $Value) {
  Assert-NoLinks $Path
  $temp = "$Path.new"
  [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, [NullString]::Value) }
  else { [IO.File]::Move($temp, $Path) }
}
function Stop-Catalogue([string]$Name) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($service) {
    try { if ($service.Status -ne 'Stopped') {
      Stop-Service -Name $Name
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(40))
    } } finally { if ($service.PSObject.Methods['Dispose']) { $service.Dispose() } }
  }
}
function Test-CatalogueRegistration([string]$Name) {
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  try { return $null -ne $service }
  finally { if ($service -and $service.PSObject.Methods['Dispose']) { $service.Dispose() } }
}
function Remove-CatalogueRegistration([string]$Name) {
  # SCM removal must work even if a previous installer removed the wrapper file.
  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (!$service) { return }
  if ($service.PSObject.Methods['Dispose']) { $service.Dispose() }
  Run "$env:SystemRoot\System32\sc.exe" @('delete',$Name)
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (!$service) { return }
    if ($service.PSObject.Methods['Dispose']) { $service.Dispose() }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Windows is still releasing the catalogue service. Close the Services window and retry.'
}
function Get-ServiceSid([string]$Name) {
  $account = New-Object Security.Principal.NTAccount("NT SERVICE\$Name")
  return $account.Translate([Security.Principal.SecurityIdentifier]).Value
}
function Check-Health($Config) {
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Config.port)/health" -Headers @{Authorization="Bearer $($Config.token)"} -TimeoutSec 3
      if ($health.runtimeMode -eq 'service' -and $health.protocolVersion -eq 1 -and $health.catalogId -eq $Config.catalogId -and $health.runtimeVersion -eq $Config.runtimeVersion) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Catalogue service did not pass its identity and health check. Open service logs for details.'
}
function Get-LifecycleEntry([string]$Runtime, [ValidateSet('service-data','service-stop')][string]$Name) {
  $current = "dist\lifecycle\$Name.js"
  $legacy = "dist\scripts\$Name.js"
  # Recovery/removal can still operate on a runtime installed before this move.
  if (!(Test-Path -LiteralPath (Join-Path $Runtime $current)) -and (Test-Path -LiteralPath (Join-Path $Runtime $legacy))) { return $legacy }
  return $current
}
function Copy-Data([string]$Runtime, [string]$Source, [string]$Target) {
  Assert-NoLinks $Source
  Assert-NoLinks $Target
  Run (Join-Path $Runtime 'node.exe') @((Join-Path $Runtime (Get-LifecycleEntry $Runtime 'service-data')), $Source, $Target)
}
function Test-RuntimeRoot([string]$Full) {
  $roots = @($binaryRoot)
  if ((Get-Variable -Name legacyBinaryRoot -Scope Script -ErrorAction SilentlyContinue) -and $script:legacyBinaryRoot) {
    $roots += $script:legacyBinaryRoot
  }
  foreach ($root in $roots) {
    $base = [IO.Path]::GetFullPath($root).TrimEnd('\')
    if ($Full.Equals($base, [StringComparison]::OrdinalIgnoreCase) -or $Full.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
function Resolve-RuntimeParent($Record) {
  if ($Record -and $Record.runtime) {
    $runtime = [IO.Path]::GetFullPath([string]$Record.runtime)
    if (Test-RuntimeRoot $runtime) { return Split-Path -Parent $runtime }
  }
  return $binaryRoot
}
function Remove-Runtime([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (!(Test-RuntimeRoot $full)) { throw 'Runtime cleanup path escaped its installation directory' }
  Assert-NoLinks $full
  if (Test-Path -LiteralPath $full) {
    foreach ($entry in Get-ChildItem -LiteralPath $full -Recurse -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime cleanup found a link' }
    }
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}
function Remove-CatalogueData($Record) {
  # Deletion is an explicit uninstall choice. Settings and logs remain.
  $paths = @()
  foreach ($entry in Get-ChildItem -LiteralPath $machineRoot -Directory -Force) {
    if ($entry.Name -match '^data-[0-9a-f-]{36}$') { $paths += $entry.FullName }
  }
  $original = [string]$Record.originalDataDir
  if ($original) {
    $original = [IO.Path]::GetFullPath($original)
    if ($original -notmatch '(?i)\\AppData\\Roaming\\Rescore\\data$') { throw 'Stored desktop catalogue path is unsupported for deletion.' }
    Assert-NoLinks $original
    $parent = Split-Path -Parent $original
    if (Test-Path -LiteralPath $parent) {
      foreach ($entry in Get-ChildItem -LiteralPath $parent -Directory -Force) {
        if ($entry.Name -eq 'data' -or $entry.Name -match '^data\.(backup|service)-[0-9a-f-]{36}$') { $paths += $entry.FullName }
      }
    }
  }
  # Validate every target before deleting any catalogue copy.
  foreach ($path in $paths) {
    Assert-NoLinks $path
    foreach ($entry in Get-ChildItem -LiteralPath $path -Recurse -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Catalogue cleanup found a link' }
    }
  }
  foreach ($path in $paths) { Remove-Item -LiteralPath $path -Recurse -Force }
}
function Write-Wrapper([string]$Runtime, [string]$Name, [string]$Root, [bool]$Activated = $false) {
  $configPath = [Security.SecurityElement]::Escape((Join-Path $Root 'config.json'))
  $logs = [Security.SecurityElement]::Escape((Join-Path $Root 'logs'))
  $startMode = if ($Activated) { 'Automatic' } else { 'Manual' }
  $delayed = if ($Activated) { 'true' } else { 'false' }
  $stopEntry = Get-LifecycleEntry $Runtime 'service-stop'
  $xml = @"
<service>
  <id>$Name</id><name>Rescore API</name>
  <description>Shared catalogue service for this computer.</description>
  <executable>%BASE%\node.exe</executable><startarguments>"%BASE%\dist\index.js"</startarguments>
  <workingdirectory>%BASE%</workingdirectory>
  <env name="RESCORE_SERVICE_CONFIG" value="$configPath"/>
  <startmode>$startMode</startmode><delayedAutoStart>$delayed</delayedAutoStart>
  <stoparguments>"%BASE%\$stopEntry"</stoparguments><stoptimeout>30 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec"/><onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/><onfailure action="none"/>
  <logpath>$logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@
  [IO.File]::WriteAllText((Join-Path $Runtime 'RescoreService.xml'), $xml)
}
function Stage-Runtime([string]$Destination) {
  Assert-NoLinks $payload
  Assert-NoLinks $Destination
  $manifest = Get-Content -LiteralPath (Join-Path $payload 'service-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  [void][IO.Directory]::CreateDirectory($Destination)
  foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ([IO.Path]::IsPathRooted($relative) -or ($relative -split '[\\/]') -contains '..') { throw 'Invalid runtime manifest path' }
    $source = Join-Path $payload $relative
    Assert-NoLinks $source
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Catalogue runtime checksum mismatch' }
    $target = Join-Path $Destination $relative
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $target))
    Copy-Item -LiteralPath $source -Destination $target
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Copied runtime checksum mismatch' }
  }
  Copy-Item -LiteralPath (Join-Path $payload 'service-manifest.json') -Destination (Join-Path $Destination 'service-manifest.json')
  return [string]$manifest.version
}
function Test-RuntimeAvailable([string]$Runtime) {
  if (!(Test-Path -LiteralPath (Join-Path $Runtime 'RescoreService.exe'))) { return $false }
  $manifestFile = Join-Path $Runtime 'service-manifest.json'
  if (Test-Path -LiteralPath $manifestFile) {
    $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in $manifest.files) {
      $path = Join-Path $Runtime ([string]$entry.path)
      Assert-Contained $path $Runtime
      if (!(Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    }
  }
  return $true
}
function Manage-Profile([string]$Operation) {
  if ($Operation -eq 'Install') {
    # One lock covers reconciliation and registration. Repeated setup is a no-op
    # when the packaged manifest, managing location, and service are unchanged.
    Manage-Profile 'UpgradeAll'
    Manage-Profile 'Register'
    return
  }
  # Keep Enable as a compatible alias for standalone callers.
  if ($Operation -eq 'Enable') { $Operation = 'EnsureRunning' }
  $root = $machineRoot
  $runtimeParent = $binaryRoot
  Assert-NoLinks $root
  Assert-NoLinks $runtimeParent
  if (Test-Path -LiteralPath $root) {
    $owner = (Get-Acl -LiteralPath $root).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Untrusted service profile directory' }
  }
  $recordPath = Join-Path $root 'installation.json'
  $record = if (Test-Path -LiteralPath $recordPath) { Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
  $name = $serviceName
  if ($record) {
    if ($record.serviceName -ne $name) { throw 'Stored service profile identity mismatch' }
    $runtimeParent = Resolve-RuntimeParent $record
    Assert-NoLinks $runtimeParent
    Assert-Contained $record.runtime $runtimeParent
    # A new app location may adopt the catalogue through a staged upgrade.
    # An old location must never remove it.
    if ($record.enabled -and $record.desktopRoot -ne $desktopRoot -and $Operation -in @('Disable','RemoveAll')) { throw 'This catalogue is managed by another Rescore installation.' }
  }
  if ($Operation -eq 'RemoveAll') {
    if (!$record -and (Test-CatalogueRegistration $name)) { throw 'A service without a valid ownership record still exists. Repair its registration before removal.' }
    # Removal has no dependency on the wrapper, config JSON, SQLite, or a Windows
    # profile. Retain shared data in place and release SCM before deleting code.
    Stop-Catalogue $name
    Remove-CatalogueRegistration $name
    if ($record) { $record.enabled = $false; $record.phase = 'disabled'; Write-Json $recordPath $record }
    Remove-Runtime $runtimeParent
    if ($DeleteCatalogue) { Remove-CatalogueData $record }
    return
  }
  if ($record -and $record.enabled -and $record.phase -eq 'disabling' -and $Operation -in @('Register','UpgradeAll','EnsureRunning','Retry')) {
    Manage-Profile 'RemoveAll'
    Manage-Profile 'Register'
    if ($Operation -in @('EnsureRunning','Retry')) { Manage-Profile 'EnsureRunning' }
    return
  }
  $returnData = if ($record -and $record.originalDataDir) { [IO.Path]::GetFullPath([string]$record.originalDataDir) } else { $null }
  $launchData = if ($DataDir) { [IO.Path]::GetFullPath($DataDir) } else { $null }
  $userData = if ($Operation -in @('Disable','RemoveAll')) { $returnData } else { $launchData }
  $profile = if ($userData) { [IO.Path]::GetFullPath((Join-Path $userData '..\..\..\..')) } else { $null }
  if (!$userData -and $Operation -notin @('UpgradeAll','RemoveAll')) { throw 'The catalogue data directory is required.' }
  if ($userData -and (!$profile -or !(Test-Path -LiteralPath $profile)) -and $Operation -notin @('UpgradeAll','RemoveAll')) { throw 'Windows profile is unavailable. The catalogue remains preserved in ProgramData.' }
  if ($userData) { Assert-NoLinks $userData }
  if ($Operation -in @('EnsureRunning','Retry') -and (!$record -or !$record.enabled)) {
    Manage-Profile 'Register'
    Manage-Profile 'EnsureRunning'
    return
  }
  if ($Operation -eq 'Register' -and $record -and $record.enabled -and $record.phase -ne 'enabling') {
    if ($record.desktopRoot -eq $desktopRoot) {
      if (Test-CatalogueRegistration $name) { return }
      $Operation = 'RepairRegistration'
    } else {
      # Installer adoption preserves activation state, including never-started services.
      $Operation = 'UpgradeAll'
    }
  }
  if ($Operation -ne 'Register' -and (!$record -or !$record.enabled)) { return }
  $registered = Test-CatalogueRegistration $name
  if ($record -and $record.enabled -and $record.phase -eq 'enabling') {
    # No activation committed: preserve the original and retry registration.
    Stop-Catalogue $name
    Remove-CatalogueRegistration $name
    $record.enabled = $false; $record.phase = 'rolled-back'; Write-Json $recordPath $record
    Remove-Runtime $record.runtime
    if ($Operation -eq 'RemoveAll') {
      Remove-Runtime $runtimeParent
      if ($DeleteCatalogue) { Remove-CatalogueData $record }
    }
    if ($Operation -in @('Register','EnsureRunning','Retry')) {
      Manage-Profile 'Register'
      if ($Operation -ne 'Register') { Manage-Profile 'EnsureRunning' }
    }
    return
  }
  if ($Operation -eq 'Register' -and $registered) { throw 'A service without a valid ownership record already exists. Repair its registration before continuing.' }
  if ($Operation -eq 'Register') {
    Protect-Directory $root '' $false $true
    Protect-Directory $runtimeParent
  }
  $stamp = [Guid]::NewGuid().ToString()
  if ($Operation -eq 'Register') {
    $sourceData = $userData
    # A retained shared catalogue remains the seed when its original profile is
    # gone or another account reinstalls. Never silently start from empty data.
    $oldConfigPath = Join-Path $root 'config.json'
    if ($record -and !$record.enabled -and $record.phase -eq 'disabled' -and (Test-Path -LiteralPath $oldConfigPath)) {
      $retained = Get-Content -LiteralPath $oldConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      Assert-Contained $retained.dataDir $root
      if (Test-Path -LiteralPath $retained.dataDir) { $sourceData = [string]$retained.dataDir }
    }
    $runtime = Join-Path $runtimeParent $stamp
    try { $version = Stage-Runtime $runtime } catch { Remove-Runtime $runtime; throw }
    $data = Join-Path $root "data-$stamp"
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $config = @{protocolVersion=1;catalogId=[Guid]::NewGuid().ToString();runtimeVersion=$version;token=([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant());port=$port;dataDir=$data;region='US'}
    $record = @{enabled=$true;activated=$false;phase='enabling';serviceName=$name;desktopRoot=$desktopRoot;runtime=$runtime;originalDataDir=$userData;runtimeHash=(Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash}
    Write-Json $recordPath $record
    try {
      Write-Json (Join-Path $root 'config.json') $config
      Copy-Data $runtime $sourceData $data
      Write-Wrapper $runtime $name $root
      Run (Join-Path $runtime 'RescoreService.exe') @('install')
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'obj=',"NT SERVICE\$name")
      $serviceSid = Get-ServiceSid $name
      Protect-Directory $root $serviceSid $false $true
      Protect-Directory $runtimeParent $serviceSid
      Protect-Directory $data $serviceSid $true
      Protect-Directory (Join-Path $root 'logs') $serviceSid $true $true
      $record.phase = 'ready'
      Write-Json $recordPath $record
    } catch {
      $failure = $_
      Stop-Catalogue $name
      Remove-CatalogueRegistration $name
      $record.enabled = $false; $record.phase = 'rolled-back'
      Write-Json $recordPath $record
      Remove-Runtime $runtime
      throw $failure
    }
    return
  }
  # Existing opt-in registrations were already activated before this field existed.
  if (!$record.PSObject.Properties['activated']) { $record | Add-Member -NotePropertyName activated -NotePropertyValue $true }
  if ($record.phase -eq 'upgrading') {
    $rollback = Get-Content -LiteralPath (Join-Path $root 'rollback.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Contained $rollback.runtime $runtimeParent
    Assert-Contained $rollback.config.dataDir $root
    Stop-Catalogue $name
    Write-Json (Join-Path $root 'config.json') $rollback.config
    if (Test-CatalogueRegistration $name) { Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $rollback.runtime 'RescoreService.exe') + '"')) }
    if ($rollback.record) { $record = $rollback.record }
    $record.runtime = $rollback.runtime; $record.phase = 'ready'; Write-Json $recordPath $record
    Remove-Item -LiteralPath (Join-Path $root 'rollback.json') -Force
  }
  $config = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-Contained $config.dataDir $root
  if ($record.activated -and $Operation -notin @('RemoveAll') -and !(Test-Path -LiteralPath (Join-Path $config.dataDir 'catalog.sqlite'))) { throw 'Service catalogue is missing. Restore its data before transferring ownership.' }
  $runtimeAvailable = Test-RuntimeAvailable $record.runtime
  if (!$runtimeAvailable -and $Operation -in @('EnsureRunning','Retry','RepairRegistration')) {
    Manage-Profile 'UpgradeAll'
    if ($Operation -in @('EnsureRunning','Retry')) { Manage-Profile 'EnsureRunning' }
    return
  }
  $serviceSid = ''
  if ($Operation -in @('EnsureRunning','Retry','UpgradeAll','RepairRegistration') -and $runtimeAvailable) {
    if (!(Test-CatalogueRegistration $name)) {
      Write-Wrapper $record.runtime $name $root ([bool]$record.activated)
      Run (Join-Path $record.runtime 'RescoreService.exe') @('install')
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'obj=',"NT SERVICE\$name")
    }
    $serviceSid = Get-ServiceSid $name
    Protect-Directory $root $serviceSid $false $true
    Protect-Directory $runtimeParent $serviceSid
    Protect-Directory $config.dataDir $serviceSid $true
    Protect-Directory (Join-Path $root 'logs') $serviceSid $true $true
  }
  if ($Operation -eq 'RepairRegistration') { return }
  if ($Operation -in @('EnsureRunning','Retry')) {
    if ($record.phase -eq 'disabling') {
      Manage-Profile 'Disable'
      Manage-Profile 'Register'
      Manage-Profile 'EnsureRunning'
      return
    }
    if ($record.phase -ne 'ready') { throw 'Interrupted service transition. Use the standalone Disable helper to recover catalogue data.' }
    $manifest = Get-Content -LiteralPath (Join-Path $payload 'service-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.desktopRoot -ne $desktopRoot -or $config.runtimeVersion -ne $manifest.version -or $record.runtimeHash -ne (Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash) {
      Manage-Profile 'UpgradeAll'
      Manage-Profile 'EnsureRunning'
      return
    }
    if ($Operation -eq 'Retry') { Stop-Catalogue $name }
    Write-Json (Join-Path $root 'config.json') $config
    Start-Service -Name $name
    Check-Health $config
    Write-Wrapper $record.runtime $name $root $true
    Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'start=','delayed-auto','DisplayName=','Rescore API')
    $record.activated = $true
    Write-Json $recordPath $record
    return
  }
  if ($Operation -eq 'Disable' -or $Operation -eq 'RemoveAll') {
    Stop-Catalogue $name
    $record.phase = 'disabling'; Write-Json $recordPath $record
    if (!$DeleteCatalogue -and $Operation -eq 'Disable') {
      $staging = "$userData.service-$stamp"
      Copy-Data $record.runtime $config.dataDir $staging
      # The original catalogue remains recoverable. Never overwrite it in place.
      Assert-Contained $staging (Split-Path -Parent $userData)
      Assert-Contained "$userData.backup-$stamp" (Split-Path -Parent $userData)
      Assert-NoLinks $userData
      if (Test-Path -LiteralPath $userData) { Move-Item -LiteralPath $userData -Destination "$userData.backup-$stamp" }
      Move-Item -LiteralPath $staging -Destination $userData
    }
    Remove-CatalogueRegistration $name
    $record.enabled = $false; $record.phase = 'disabled'; Write-Json $recordPath $record
    Remove-Runtime $runtimeParent
    if ($DeleteCatalogue) { Remove-CatalogueData $record }
    return
  }
  if ($Operation -eq 'UpgradeAll') {
    if ($record.phase -ne 'ready') { throw 'Finish the catalogue service transition before upgrading.' }
    $expectedHash = (Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash
    if ($record.desktopRoot -eq $desktopRoot -and $record.runtimeHash -eq $expectedHash -and
        $runtimeParent -eq $binaryRoot -and $runtimeAvailable) { return }
    $previousRuntimeParent = $runtimeParent
    $runtimeParent = $binaryRoot
    Protect-Directory $runtimeParent $serviceSid
    $runtime = Join-Path $runtimeParent $stamp
    try { $version = Stage-Runtime $runtime } catch { Remove-Runtime $runtime; throw }
    Stop-Catalogue $name
    $previousConfig = $config | ConvertTo-Json | ConvertFrom-Json
    $previousRuntime = $record.runtime
    $previousDesktopRoot = $record.desktopRoot
    $previousRuntimeHash = $record.runtimeHash
    Write-Json (Join-Path $root 'rollback.json') @{config=$previousConfig;runtime=$previousRuntime;record=$record}
    $record.phase = 'upgrading'; Write-Json $recordPath $record
    try {
      # A full staged data copy makes schema rollback independent of migrations.
      $data = Join-Path $root "data-$stamp"
      Copy-Data $runtime $config.dataDir $data
      $config.dataDir = $data; $config.runtimeVersion = $version
      Write-Json (Join-Path $root 'config.json') $config
      Write-Wrapper $runtime $name $root ([bool]$record.activated)
      if (!(Test-CatalogueRegistration $name)) {
        Run (Join-Path $runtime 'RescoreService.exe') @('install')
        Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'obj=',"NT SERVICE\$name")
      }
      $serviceSid = Get-ServiceSid $name
      Protect-Directory $root $serviceSid $false $true
      Protect-Directory $runtimeParent $serviceSid
      Protect-Directory $data $serviceSid $true
      Protect-Directory (Join-Path $root 'logs') $serviceSid $true $true
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $runtime 'RescoreService.exe') + '"'),'DisplayName=','Rescore API')
      if ($record.activated) {
        Start-Service -Name $name
        Check-Health $config
      }
      $record | Add-Member -NotePropertyName runtimeHash -NotePropertyValue (Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash -Force
      $record.desktopRoot = $desktopRoot
      $record.runtime = $runtime; $record.phase = 'ready'; Write-Json $recordPath $record
      Remove-Item -LiteralPath (Join-Path $root 'rollback.json') -Force -ErrorAction SilentlyContinue
    } catch {
      $failure = $_
      Stop-Catalogue $name
      Write-Json (Join-Path $root 'config.json') $previousConfig
      if (Test-CatalogueRegistration $name) { Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $previousRuntime 'RescoreService.exe') + '"')) }
      if ($record.activated -and $runtimeAvailable) { Start-Service -Name $name }
      $record.desktopRoot = $previousDesktopRoot
      $record | Add-Member -NotePropertyName runtimeHash -NotePropertyValue $previousRuntimeHash -Force
      $record.runtime = $previousRuntime; $record.phase = 'ready'; Write-Json $recordPath $record
      Remove-Runtime $runtime
      throw $failure
    }
    # Retire code only after the new service/configuration is committed. Data
    # recovery copies remain available until the user explicitly deletes them.
    try { Remove-Runtime $previousRuntime } catch { }
    if ($previousRuntimeParent -ne $runtimeParent -and (Test-Path -LiteralPath $previousRuntimeParent)) {
      try { Remove-Runtime $previousRuntimeParent } catch { }
    }
  }
}

function Invoke-ServiceManagement([string]$Operation) {
  if ($Operation -eq 'UpgradeAll') {
    $file = Join-Path $machineRoot 'installation.json'
    if (Test-Path -LiteralPath $file) {
      $record = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($record.enabled -and $record.desktopRoot -eq $desktopRoot) { Manage-Profile $Operation }
    }
  } else { Manage-Profile $Operation }
}

$managementLock = $null
try {
  $admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (!$admin) { throw 'Administrator approval is required to manage the catalogue service.' }
  if ($DeleteCatalogue -and $Action -ne 'RemoveAll') { throw 'Catalogue deletion is only supported during removal.' }
  Assert-NoLinks $machineRoot
  Assert-NoLinks $binaryRoot
  # Do not strip the running service's permissions just to acquire the lock.
  if (Test-Path -LiteralPath $machineRoot) {
    $owner = (Get-Acl -LiteralPath $machineRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Untrusted service profile directory' }
  } else { Protect-Directory $machineRoot '' $false $true }
  $lockDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    try { $managementLock = [IO.File]::Open((Join-Path $machineRoot 'management.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch {
      if ([DateTime]::UtcNow -ge $lockDeadline) { throw 'Another catalogue service operation is still running. Wait for it to finish, then retry.' }
      Start-Sleep -Milliseconds 200
    }
  } while (!$managementLock)
  Remove-Item -LiteralPath (Join-Path $machineRoot 'last-error.txt') -Force -ErrorAction SilentlyContinue
  Invoke-ServiceManagement $Action
  exit 0
} catch {
  # Never include service secrets or command arguments.
  $failure = $_
  if ($managementLock) {
    try {
      $errorFile = Join-Path $machineRoot 'last-error.txt'
      Assert-NoLinks $errorFile
      $owner = (Get-Acl -LiteralPath $machineRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($owner -in @('S-1-5-18','S-1-5-32-544')) { [IO.File]::WriteAllText($errorFile, $failure.Exception.Message) }
    } catch { }
  }
  Write-Error $failure -ErrorAction Continue
  exit 1
} finally {
  if ($managementLock) { $managementLock.Dispose() }
}
