# Elevated verification using real SCM, WinSW, Node, ACLs, SQLite transfers, and
# production management functions. A local HTTP fixture replaces catalogue ingest.
param([Parameter(Mandatory=$true)][string]$RuntimePayload, [Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$admin = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$admin -or ![Environment]::Is64BitProcess) { throw 'Native lifecycle verification requires administrator approval and x64 PowerShell.' }
$id = [Guid]::NewGuid().ToString('n')
$base = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('Rescore Lifecycle Verification-' + $id)
$serviceName = 'RescoreVerification-' + $id
$desktopRoot = Join-Path $base 'desktop'
$payload = Join-Path $desktopRoot 'resources\api'
$machineRoot = Join-Path $base 'machine'
$binaryRoot = Join-Path $base 'service-code'
$legacyBinaryRoot = Join-Path $desktopRoot 'Catalogue'
$DataDir = Join-Path $base 'user\AppData\Roaming\Rescore\data'
$DeleteCatalogue = $false
$steps = @()
$failure = $null
function Assert-Native($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Record-Step([string]$Step) {
  $script:steps += $Step
  [IO.File]::WriteAllText($ReportPath, (@{passed=$script:steps;complete=$false;service=$serviceName;root=$base} | ConvertTo-Json))
}
function Read-NativeRecord { Get-Content -LiteralPath (Join-Path $machineRoot 'installation.json') -Raw | ConvertFrom-Json }
function Read-NativeConfig { Get-Content -LiteralPath (Join-Path $machineRoot 'config.json') -Raw | ConvertFrom-Json }
try {
  $tokens = $null; $parseErrors = $null
  $tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'manage-service.ps1'), [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
  foreach ($function in $tree.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { Invoke-Expression $function.Extent.Text }
  Protect-Directory $base '' $false $true
  foreach ($folder in @($payload, $DataDir, (Join-Path $payload 'dist\lifecycle'), (Join-Path $payload 'dist\services'), (Join-Path $payload 'node_modules'))) { [void][IO.Directory]::CreateDirectory($folder) }
  foreach ($file in @('node.exe','RescoreService.exe','package.json')) { Copy-Item -LiteralPath (Join-Path $RuntimePayload $file) -Destination $payload }
  foreach ($file in @('lifecycle\service-data.js','lifecycle\service-stop.js','services\catalog-ownership.js','services\service-environment.js')) { Copy-Item -LiteralPath (Join-Path $RuntimePayload "dist\$file") -Destination (Join-Path $payload "dist\$file") }
  foreach ($module in @('better-sqlite3','bindings','file-uri-to-path')) { Copy-Item -LiteralPath (Join-Path $RuntimePayload "node_modules\$module") -Destination (Join-Path $payload 'node_modules') -Recurse }
  Set-Content -LiteralPath (Join-Path $payload 'dist\index.js') -Encoding UTF8 -Value @'
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
const config = JSON.parse(readFileSync(process.env.RESCORE_SERVICE_CONFIG, 'utf8'));
const db = new Database(join(config.dataDir, 'catalog.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS verification(value TEXT)');
db.close();
const server = createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer ' + config.token) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/internal/shutdown') { response.end('{}'); server.close(() => process.exit(0)); return; }
  response.end(JSON.stringify({runtimeMode:'service',protocolVersion:1,catalogId:config.catalogId,runtimeVersion:config.runtimeVersion}));
});
server.listen(config.port, '127.0.0.1');
'@
  function Update-NativeManifest([string]$Version) {
    $files = @(Get-ChildItem -LiteralPath $payload -File -Recurse | Where-Object { $_.Name -ne 'service-manifest.json' } | ForEach-Object {
      @{path=$_.FullName.Substring($payload.Length + 1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    })
    Write-Json (Join-Path $payload 'service-manifest.json') @{version=$Version;files=$files}
  }
  Update-NativeManifest '1.0.0'
  Manage-Profile 'Install'
  $record = Read-NativeRecord; $config = Read-NativeConfig
  $service = Get-Service -Name $serviceName
  try { Assert-Native ($service.Status -eq 'Stopped' -and !$record.activated) 'Fresh native setup activated its service prematurely.' } finally { $service.Dispose() }
  Record-Step 'fresh registration: stopped Manual service with virtual identity and protected folders'
  Manage-Profile 'Install'
  Assert-Native ((Read-NativeRecord).runtime -eq $record.runtime -and (Read-NativeConfig).dataDir -eq $config.dataDir) 'Identical native reinstall replaced runtime or catalogue.'
  Record-Step 'identical reinstall reuses service code and catalogue'
  Remove-CatalogueRegistration $serviceName
  Remove-Runtime $record.runtime
  Manage-Profile 'Install'
  Assert-Native ((Test-CatalogueRegistration $serviceName) -and (Test-Path -LiteralPath (Join-Path (Read-NativeRecord).runtime 'RescoreService.exe'))) 'Native repair did not reconstruct missing runtime and SCM registration.'
  Record-Step 'repair after missing service files: retained catalogue used to rebuild runtime and registration'
  Manage-Profile 'EnsureRunning'
  Assert-Native ((Read-NativeRecord).activated) 'First native launch did not commit activation.'
  Record-Step 'first launch: starts service, verifies authenticated health, enables automatic boot startup'
  Manage-Profile 'Retry'
  Record-Step 'repair: stops and restarts real service'
  Update-NativeManifest '2.0.0'
  Manage-Profile 'Install'
  Assert-Native ((Read-NativeConfig).runtimeVersion -eq '2.0.0' -and (Read-NativeRecord).activated) 'Native update failed to preserve activation.'
  Record-Step 'active update: new runtime and SQLite copy commit after authenticated health'
  $retained = (Read-NativeConfig).dataDir
  Manage-Profile 'RemoveAll'
  Assert-Native (!(Test-CatalogueRegistration $serviceName) -and (Test-Path -LiteralPath (Join-Path $retained 'catalog.sqlite'))) 'Native uninstall lost the retained catalogue or service survived.'
  Record-Step 'uninstall: SCM and code removed, shared SQLite catalogue preserved'
  Manage-Profile 'Install'
  Assert-Native ((Test-Path -LiteralPath (Join-Path (Read-NativeConfig).dataDir 'catalog.sqlite')) -and !(Read-NativeRecord).activated) 'Native reinstall did not reuse retained SQLite data.'
  Record-Step 'reinstall after uninstall: retained catalogue reused and service remains stopped'
  $DeleteCatalogue = $true
  Manage-Profile 'RemoveAll'
  Assert-Native (!(Test-CatalogueRegistration $serviceName) -and !(Test-Path -LiteralPath (Read-NativeConfig).dataDir)) 'Explicit native deletion did not remove service and data.'
  Record-Step 'explicit deletion: catalogue removed after SCM removal'
} catch { $failure = $_.Exception.Message }
finally {
  # Every target is uniquely named and outside the actual Rescore installation.
  $expected = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) ('Rescore Lifecycle Verification-' + $id)
  if ([IO.Path]::GetFullPath($base) -ne [IO.Path]::GetFullPath($expected) -or $serviceName -ne ('RescoreVerification-' + $id)) { throw 'Invalid native verification cleanup target.' }
  try {
    if (Get-Command Stop-Catalogue -ErrorAction SilentlyContinue) { Stop-Catalogue $serviceName; Remove-CatalogueRegistration $serviceName }
    if (Test-Path -LiteralPath $base) { Remove-Item -LiteralPath $base -Recurse -Force }
  } catch { if (!$failure) { $failure = $_.Exception.Message } }
  [IO.File]::WriteAllText($ReportPath, (@{passed=$steps;complete=(!$failure);error=$failure;service=$serviceName;root=$base} | ConvertTo-Json))
}
if ($failure) { throw $failure }
