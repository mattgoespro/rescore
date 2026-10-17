param([string]$Makensis)
$ErrorActionPreference = 'Stop'
if (!$Makensis) {
  $Makensis = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache') -Recurse -Filter makensis.exe |
    Where-Object { $_.Directory.Name -eq 'Bin' } | Select-Object -First 1 -ExpandProperty FullName
}
if (!$Makensis) { throw 'Build the Windows installer to populate the NSIS compiler cache.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-process-test-' + [Guid]::NewGuid())
$desktopRoot = Join-Path $temp 'Rescore'
$serviceRoot = Join-Path $temp 'Rescore Catalogue'
$processes = @()
try {
  [void][IO.Directory]::CreateDirectory($desktopRoot)
  [void][IO.Directory]::CreateDirectory($serviceRoot)
  $entry = Join-Path $temp 'process.cs'
  Set-Content -LiteralPath $entry -Value 'class Fixture { [System.STAThread] static void Main() { System.Threading.Thread.Sleep(120000); } }'
  $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  $desktop = Join-Path $desktopRoot 'Rescore.exe'
  & $compiler /nologo /target:winexe "/out:$desktop" $entry
  if ($LASTEXITCODE -ne 0) { throw 'Could not compile disposable process.' }
  $service = Join-Path $serviceRoot 'RescoreService.exe'
  Copy-Item -LiteralPath $desktop -Destination $service
  $sibling = Start-Process -FilePath $service -WindowStyle Hidden -PassThru
  $processes += $sibling
  $include = Join-Path $PSScriptRoot 'installer.nsh'
  $builder = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..\node_modules\app-builder-lib\templates\nsis\include'))
  $program = Join-Path $temp 'probe.exe'
  $nsi = Join-Path $temp 'probe.nsi'
  $result = Join-Path $temp 'result.txt'
  Set-Content -LiteralPath $nsi -Encoding UTF8 -Value @"
!include LogicLib.nsh
!define APP_EXECUTABLE_FILENAME 'Rescore.exe'
!include "$include"
!addincludedir "$builder"
!include allowOnlyOneInstallerInstance.nsh
!insertmacro customHeader
Var CmdPath
Var PowerShellPath
Var IsPowerShellAvailable
Name 'Rescore process scope test'
OutFile "$program"
RequestExecutionLevel user
SilentInstall silent
InstallDir "$desktopRoot"
Section
  StrCpy `$PowerShellPath '`$SYSDIR\WindowsPowerShell\v1.0\powershell.exe'
  StrCpy `$CmdPath '`$SYSDIR\cmd.exe'
  StrCpy `$IsPowerShellAvailable 0
  System::Call 'kernel32::SetEnvironmentVariable(t "RESCORE_INSTALL_EXE", t "`$INSTDIR\Rescore.exe")'
  !insertmacro FIND_PROCESS 'Rescore.exe' `$R0
  FileOpen `$R1 "$result" w
  FileWrite `$R1 '`$R0'
  FileClose `$R1
  !insertmacro KILL_PROCESS 'Rescore.exe' 1
SectionEnd
"@
  & $Makensis /V2 $nsi
  if ($LASTEXITCODE -ne 0) { throw 'NSIS process probe compilation failed.' }
  foreach ($running in @($false, $true)) {
    if ($running) { $processes += Start-Process -FilePath $desktop -WindowStyle Hidden -PassThru }
    $probe = Start-Process -FilePath $program -WindowStyle Hidden -PassThru -Wait
    if ($probe.ExitCode -ne 0) { throw 'NSIS process probe failed.' }
    $sibling.Refresh()
    if ($sibling.HasExited) { throw 'Installer killed the sibling Rescore Catalogue process.' }
    $found = (Get-Content -Raw -LiteralPath $result).Trim()
    if ((!$running -and $found -eq '0') -or ($running -and $found -ne '0')) { throw 'Installer did not distinguish the desktop executable from its sibling service.' }
    if ($running) { $processes[-1].Refresh(); if (!$processes[-1].HasExited) { throw 'Installer failed to close its desktop executable.' } }
  }
  Write-Output 'PASS: native NSIS process checks close only the exact desktop executable and preserve the sibling catalogue service'
} finally {
  foreach ($process in $processes) { $process.Refresh(); if (!$process.HasExited) { $process.Kill(); $process.WaitForExit() }; $process.Dispose() }
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-process-test-')) { throw 'Invalid process-test cleanup target.' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
