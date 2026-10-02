param(
  [Parameter(Mandatory=$true)][ValidateSet('Register','EnsureRunning','Enable','Disable','Retry','UpgradeAll','RemoveAll')][string]$Action,
  [ValidatePattern('^S-1-5-21-\d+-\d+-\d+-\d+$')][string]$OwnerSid
)
$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$payload = Join-Path $desktopRoot 'resources\api'
$machineRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'Rescore'
$binaryRoot = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Rescore Catalogue'

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
function Protect-Directory([string]$Path, [string]$Sid, [string]$ServiceSid = '', [bool]$Writable = $false) {
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
  if ($Sid) {
    $identity = New-Object Security.Principal.SecurityIdentifier($Sid)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'ReadAndExecute',$inherit,'None','Allow')))
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
  if ($service -and $service.Status -ne 'Stopped') {
    Stop-Service -Name $Name
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(40))
  }
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
function Copy-Data([string]$Runtime, [string]$Source, [string]$Target) {
  Assert-NoLinks $Source
  Assert-NoLinks $Target
  Run (Join-Path $Runtime 'node.exe') @((Join-Path $Runtime 'dist\scripts\service-data.js'), $Source, $Target)
}
function Remove-Runtime([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $base = [IO.Path]::GetFullPath($binaryRoot).TrimEnd('\') + '\'
  if (!$full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime cleanup path escaped its installation directory' }
  Assert-NoLinks $full
  if (Test-Path -LiteralPath $full) {
    foreach ($entry in Get-ChildItem -LiteralPath $full -Recurse -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime cleanup found a link' }
    }
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}
function Write-Wrapper([string]$Runtime, [string]$Name, [string]$Root, [bool]$Activated = $false) {
  $configPath = [Security.SecurityElement]::Escape((Join-Path $Root 'config.json'))
  $logs = [Security.SecurityElement]::Escape((Join-Path $Root 'logs'))
  $startMode = if ($Activated) { 'Automatic' } else { 'Manual' }
  $delayed = if ($Activated) { 'true' } else { 'false' }
  $xml = @"
<service>
  <id>$Name</id><name>Rescore API</name>
  <description>Required catalogue service for one Rescore profile.</description>
  <executable>%BASE%\node.exe</executable><startarguments>"%BASE%\dist\index.js"</startarguments>
  <workingdirectory>%BASE%</workingdirectory>
  <env name="RESCORE_SERVICE_CONFIG" value="$configPath"/>
  <startmode>$startMode</startmode><delayedAutoStart>$delayed</delayedAutoStart>
  <stoparguments>"%BASE%\dist\scripts\service-stop.js"</stoparguments><stoptimeout>30 sec</stoptimeout>
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
  return [string]$manifest.version
}
function Manage-Profile([string]$Sid, [string]$Operation) {
  # Keep Enable as a compatible alias for standalone callers.
  if ($Operation -eq 'Enable') { $Operation = 'EnsureRunning' }
  $root = Join-Path $machineRoot $Sid
  $runtimeParent = Join-Path $binaryRoot $Sid
  Assert-NoLinks $root
  Assert-NoLinks $runtimeParent
  if (Test-Path -LiteralPath $root) {
    $owner = (Get-Acl -LiteralPath $root).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Untrusted service profile directory' }
  }
  $recordPath = Join-Path $root 'installation.json'
  $record = if (Test-Path -LiteralPath $recordPath) { Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
  $name = 'RescoreCatalogue-' + $Sid
  if ($record) {
    if ($record.ownerSid -ne $Sid -or $record.serviceName -ne $name) { throw 'Stored service profile identity mismatch' }
    Assert-Contained $record.runtime $runtimeParent
    # Registration belongs to the Windows profile. A new app location may adopt
    # it through a staged upgrade; an old location must never remove it.
    if ($record.enabled -and $record.desktopRoot -ne $desktopRoot -and $Operation -in @('Disable','RemoveAll')) { throw 'This catalogue is managed by another Rescore installation.' }
  }
  $profile = (Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$Sid" -ErrorAction SilentlyContinue).ProfileImagePath
  if (!$profile -and $Operation -eq 'RemoveAll' -and $record) {
    Stop-Catalogue $name
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) { Run (Join-Path $record.runtime 'RescoreService.exe') @('uninstall') }
    $record.enabled = $false; $record.phase = 'disabled'; Write-Json $recordPath $record
    Remove-Runtime $runtimeParent
    return
  }
  if (!$profile) { throw 'Windows profile is unavailable. The catalogue remains preserved in ProgramData.' }
  $userData = Join-Path ([Environment]::ExpandEnvironmentVariables($profile)) 'AppData\Roaming\Rescore\data'
  Assert-NoLinks $userData
  $region = 'US'
  $settingsPath = Join-Path (Split-Path -Parent $userData) 'rescore.json'
  Assert-NoLinks $settingsPath
  if (Test-Path -LiteralPath $settingsPath) {
    try {
      $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($settings.settings.region -match '^[A-Za-z]{2}$') { $region = $settings.settings.region.ToUpperInvariant() }
    } catch { $region = 'US' }
  }
  if ($record) {
    if ($record.ownerSid -ne $Sid -or $record.serviceName -ne $name -or $record.originalDataDir -ne $userData) { throw 'Stored service profile identity mismatch' }
    Assert-Contained $record.runtime $runtimeParent
  }
  if ($Operation -in @('EnsureRunning','Retry') -and (!$record -or !$record.enabled)) {
    Manage-Profile $Sid 'Register'
    Manage-Profile $Sid 'EnsureRunning'
    return
  }
  if ($Operation -eq 'Register' -and $record -and $record.enabled -and $record.phase -ne 'enabling') {
    if ($record.desktopRoot -eq $desktopRoot) { return }
    # Installer adoption preserves activation state, including never-started services.
    $Operation = 'UpgradeAll'
  }
  if ($Operation -ne 'Register' -and (!$record -or !$record.enabled)) { return }
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if ($record -and $record.enabled -and $record.phase -eq 'enabling') {
    # No activation committed: preserve the original and retry registration.
    Stop-Catalogue $name
    if ($service) { Run (Join-Path $record.runtime 'RescoreService.exe') @('uninstall') }
    $record.enabled = $false; $record.phase = 'rolled-back'; Write-Json $recordPath $record
    if ($Operation -in @('Register','EnsureRunning','Retry')) {
      Manage-Profile $Sid 'Register'
      if ($Operation -ne 'Register') { Manage-Profile $Sid 'EnsureRunning' }
    }
    return
  }
  if ($Operation -eq 'Register' -and $service) { throw 'A service without a valid ownership record already exists. Repair its registration before continuing.' }
  if ($Operation -eq 'Register') {
    Protect-Directory $root $Sid
    Protect-Directory $runtimeParent $Sid
  }
  $stamp = [Guid]::NewGuid().ToString()
  if ($Operation -eq 'Register') {
    $runtime = Join-Path $runtimeParent $stamp
    $version = Stage-Runtime $runtime
    $data = Join-Path $root "data-$stamp"
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $config = @{protocolVersion=1;catalogId=[Guid]::NewGuid().ToString();runtimeVersion=$version;token=([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant());port=$port;dataDir=$data;region=$region}
    $record = @{enabled=$true;activated=$false;phase='enabling';serviceName=$name;ownerSid=$Sid;desktopRoot=$desktopRoot;runtime=$runtime;originalDataDir=$userData;runtimeHash=(Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash}
    Write-Json $recordPath $record
    try {
      Write-Json (Join-Path $root 'config.json') $config
      Copy-Data $runtime $userData $data
      Write-Wrapper $runtime $name $root
      Run (Join-Path $runtime 'RescoreService.exe') @('install')
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'obj=',"NT SERVICE\$name")
      $serviceSid = Get-ServiceSid $name
      Protect-Directory $root $Sid $serviceSid
      Protect-Directory $runtimeParent $Sid $serviceSid
      Protect-Directory $data $Sid $serviceSid $true
      Protect-Directory (Join-Path $root 'logs') $Sid $serviceSid $true
      $record.phase = 'ready'
      Write-Json $recordPath $record
    } catch {
      $failure = $_
      Stop-Catalogue $name
      if (Get-Service -Name $name -ErrorAction SilentlyContinue) { Run (Join-Path $runtime 'RescoreService.exe') @('uninstall') }
      $record.enabled = $false; $record.phase = 'rolled-back'
      Write-Json $recordPath $record
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
    Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $rollback.runtime 'RescoreService.exe') + '"'))
    $record.runtime = $rollback.runtime; $record.phase = 'ready'; Write-Json $recordPath $record
  }
  $config = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-Contained $config.dataDir $root
  if ($record.activated -and !(Test-Path -LiteralPath (Join-Path $config.dataDir 'catalog.sqlite'))) { throw 'Service catalogue is missing. Restore its data before transferring ownership.' }
  if ($Operation -in @('EnsureRunning','Retry','UpgradeAll')) {
    if (!(Get-Service -Name $name -ErrorAction SilentlyContinue)) {
      Write-Wrapper $record.runtime $name $root ([bool]$record.activated)
      Run (Join-Path $record.runtime 'RescoreService.exe') @('install')
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'obj=',"NT SERVICE\$name")
    }
    $serviceSid = Get-ServiceSid $name
    Protect-Directory $root $Sid $serviceSid
    Protect-Directory $runtimeParent $Sid $serviceSid
  }
  if ($Operation -in @('EnsureRunning','Retry')) {
    if ($record.phase -eq 'disabling') {
      Manage-Profile $Sid 'Disable'
      Manage-Profile $Sid 'Register'
      Manage-Profile $Sid 'EnsureRunning'
      return
    }
    if ($record.phase -ne 'ready') { throw 'Interrupted service transition. Use the standalone Disable helper to recover catalogue data.' }
    $manifest = Get-Content -LiteralPath (Join-Path $payload 'service-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.desktopRoot -ne $desktopRoot -or $config.runtimeVersion -ne $manifest.version -or $record.runtimeHash -ne (Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash) {
      Manage-Profile $Sid 'UpgradeAll'
      Manage-Profile $Sid 'EnsureRunning'
      return
    }
    if ($Operation -eq 'Retry') { Stop-Catalogue $name }
    $config | Add-Member -NotePropertyName region -NotePropertyValue $region -Force
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
    $staging = "$userData.service-$stamp"
    Copy-Data $record.runtime $config.dataDir $staging
    # The original catalogue remains recoverable. Never overwrite it in place.
    Assert-Contained $staging (Split-Path -Parent $userData)
    Assert-Contained "$userData.backup-$stamp" (Split-Path -Parent $userData)
    Assert-NoLinks $userData
    if (Test-Path -LiteralPath $userData) { Move-Item -LiteralPath $userData -Destination "$userData.backup-$stamp" }
    Move-Item -LiteralPath $staging -Destination $userData
    if (Get-Service -Name $name -ErrorAction SilentlyContinue) { Run (Join-Path $record.runtime 'RescoreService.exe') @('uninstall') }
    $record.enabled = $false; $record.phase = 'disabled'; Write-Json $recordPath $record
    Remove-Runtime $runtimeParent
    return
  }
  if ($Operation -eq 'UpgradeAll') {
    if ($record.phase -ne 'ready') { throw 'Finish the catalogue service transition before upgrading.' }
    $runtime = Join-Path $runtimeParent $stamp
    $version = Stage-Runtime $runtime
    Stop-Catalogue $name
    $previousConfig = $config | ConvertTo-Json | ConvertFrom-Json
    $previousRuntime = $record.runtime
    $previousDesktopRoot = $record.desktopRoot
    $previousRuntimeHash = $record.runtimeHash
    Write-Json (Join-Path $root 'rollback.json') @{config=$previousConfig;runtime=$previousRuntime}
    $record.phase = 'upgrading'; Write-Json $recordPath $record
    try {
      # A full staged data copy makes schema rollback independent of migrations.
      $data = Join-Path $root "data-$stamp"
      Copy-Data $runtime $config.dataDir $data
      Protect-Directory $data $Sid $serviceSid $true
      $config.dataDir = $data; $config.runtimeVersion = $version
      $config | Add-Member -NotePropertyName region -NotePropertyValue $region -Force
      Write-Json (Join-Path $root 'config.json') $config
      Write-Wrapper $runtime $name $root ([bool]$record.activated)
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $runtime 'RescoreService.exe') + '"'),'DisplayName=','Rescore API')
      if ($record.activated) {
        Start-Service -Name $name
        Check-Health $config
      }
      $record | Add-Member -NotePropertyName runtimeHash -NotePropertyValue (Get-FileHash -LiteralPath (Join-Path $payload 'service-manifest.json') -Algorithm SHA256).Hash -Force
      $record.desktopRoot = $desktopRoot
      $record.runtime = $runtime; $record.phase = 'ready'; Write-Json $recordPath $record
    } catch {
      $failure = $_
      Stop-Catalogue $name
      Write-Json (Join-Path $root 'config.json') $previousConfig
      Run "$env:SystemRoot\System32\sc.exe" @('config',$name,'binPath=',('"' + (Join-Path $previousRuntime 'RescoreService.exe') + '"'))
      if ($record.activated) { Start-Service -Name $name }
      $record.desktopRoot = $previousDesktopRoot
      $record | Add-Member -NotePropertyName runtimeHash -NotePropertyValue $previousRuntimeHash -Force
      $record.runtime = $previousRuntime; $record.phase = 'ready'; Write-Json $recordPath $record
      throw $failure
    }
  }
}

$managementLock = $null
try {
  $admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (!$admin) { throw 'Administrator approval is required to manage the catalogue service.' }
  Assert-NoLinks $machineRoot
  Assert-NoLinks $binaryRoot
  Protect-Directory $machineRoot ''
  try {
    $managementLock = [IO.File]::Open((Join-Path $machineRoot 'management.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch { throw 'Another catalogue service operation is running. Wait for it to finish, then retry.' }
  Protect-Directory $binaryRoot ''
  if ($Action -eq 'UpgradeAll' -or $Action -eq 'RemoveAll') {
    foreach ($dir in Get-ChildItem -LiteralPath $machineRoot -Directory) {
      $file = Join-Path $dir.FullName 'installation.json'
      if (!(Test-Path -LiteralPath $file)) { continue }
      $record = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($record.enabled -and $record.desktopRoot -eq $desktopRoot) { Manage-Profile $dir.Name $Action }
    }
  } else {
    if (!$OwnerSid) { throw 'A Windows profile is required.' }
    Manage-Profile $OwnerSid $Action
  }
  exit 0
} catch {
  # Fixed owner-specific error path; never include service secrets or command arguments.
  $failure = $_
  if ($managementLock -and $OwnerSid) {
    try {
      $errorRoot = Join-Path $machineRoot $OwnerSid
      $errorFile = Join-Path $errorRoot 'last-error.txt'
      Assert-NoLinks $errorFile
      $owner = (Get-Acl -LiteralPath $errorRoot).GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($owner -in @('S-1-5-18','S-1-5-32-544')) { [IO.File]::WriteAllText($errorFile, $failure.Exception.Message) }
    } catch { }
  }
  Write-Error $failure -ErrorAction Continue
  exit 1
} finally {
  if ($managementLock) { $managementLock.Dispose() }
}
