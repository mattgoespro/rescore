param([string]$Makensis)
$ErrorActionPreference = 'Stop'
if (!$Makensis) {
  $Makensis = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache') -Recurse -Filter makensis.exe |
    Where-Object { $_.Directory.Name -eq 'Bin' } | Select-Object -First 1 -ExpandProperty FullName
}
if (!$Makensis) { throw 'Build the Windows installer first to populate the NSIS compiler cache.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-nsis-test-' + [Guid]::NewGuid() + ' Program Files')
[void][IO.Directory]::CreateDirectory($temp)
function Assert-Test($Condition, [string]$Message) { if (!$Condition) { throw $Message } }
try {
  $include = Join-Path $PSScriptRoot 'installer.nsh'
  $source = Get-Content -LiteralPath $include -Raw
  $builder = Join-Path $PSScriptRoot '..\..\..\..\node_modules\app-builder-lib\templates\nsis\uninstaller.nsh'
  $restore = [regex]::Match((Get-Content -LiteralPath $builder -Raw), '(?s)Function un\.restoreFiles\b.*?FunctionEnd').Value
  Assert-Test ([bool]$restore) 'Missing electron-builder restore implementation'
  $program = Join-Path $temp 'fixture.exe'
  $uninstaller = Join-Path $temp 'uninstall.exe'
  $nsi = Join-Path $temp 'fixture.nsi'
  Set-Content -LiteralPath $nsi -Encoding UTF8 -Value @"
!include LogicLib.nsh
!define BUILD_UNINSTALLER
!define isUpdated '1 == 1'
!define UNINSTALL_FILENAME 'uninstall.exe'
!include "$include"
!insertmacro customHeader
$restore
Name 'Rescore file cleanup test'
OutFile "$program"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
Section
  WriteUninstaller "$uninstaller"
SectionEnd
Section 'Uninstall'
  InitPluginsDir
  !insertmacro customRemoveFiles
  SetErrorLevel 0
SectionEnd
"@
  & $Makensis /V2 $nsi
  Assert-Test ($LASTEXITCODE -eq 0) 'NSIS test compilation failed'
  $writer = Start-Process -FilePath $program -PassThru -Wait -WindowStyle Hidden -ArgumentList '/S'
  Assert-Test ($writer.ExitCode -eq 0) 'NSIS fixture uninstaller was not written'
  foreach ($locked in @($false, $true)) {
    $fixture = Join-Path $temp "app-$locked"
    [void][IO.Directory]::CreateDirectory((Join-Path $fixture 'Catalogue'))
    [void][IO.Directory]::CreateDirectory((Join-Path $fixture 'resources\empty'))
    [IO.File]::WriteAllText((Join-Path $fixture 'Catalogue\service.exe'), 'service')
    $appFile = Join-Path $fixture 'resources\app.dat'
    [IO.File]::WriteAllText($appFile, 'desktop')
    $handle = $null
    try {
      if ($locked) { $handle = [IO.File]::Open($appFile, 'Open', 'Read', 'None') }
      $process = Start-Process -FilePath $uninstaller -PassThru -WindowStyle Hidden -ArgumentList ("/S _?=" + $fixture)
      if (!$process.WaitForExit(10000)) { $process.Kill(); throw 'NSIS cleanup hung on a busy file' }
      Assert-Test (Test-Path -LiteralPath (Join-Path $fixture 'Catalogue\service.exe')) 'An update must preserve the service runtime'
      if ($locked) { Assert-Test ($process.ExitCode -ne 0 -and (Test-Path $appFile)) 'A busy app file must stop update removal' }
      else { Assert-Test ($process.ExitCode -eq 0 -and !(Test-Path (Join-Path $fixture 'resources'))) 'Successful update must remove obsolete files and empty directories' }
    } finally { if ($handle) { $handle.Dispose() } }
  }
  Write-Output 'PASS: native NSIS update cleanup preserves Catalogue, removes empty directories, and stops on locked files'
} finally {
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-nsis-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
