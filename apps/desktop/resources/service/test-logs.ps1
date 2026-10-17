$ErrorActionPreference = 'Stop'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('rescore-logs-test-' + [Guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($temp)
try {
  $log = Join-Path $temp "O'Brien service.out.log"
  $lines = 1..75 | ForEach-Object { "Log entry $_" }
  Set-Content -LiteralPath $log -Encoding UTF8 -Value $lines
  $output = @(& (Join-Path $PSScriptRoot 'logs.ps1') -LogPath $log -Once)
  if ($output.Count -ne 51 -or $output[1] -ne 'Log entry 26' -or $output[-1] -ne 'Log entry 75') { throw 'Log viewer must display the latest 50 lines.' }
  $missing = @(& (Join-Path $PSScriptRoot 'logs.ps1') -LogPath (Join-Path $temp 'missing.log') -Once)
  if (($missing -join ' ') -notmatch 'No catalogue log is available yet') { throw 'Missing log must explain how to start the catalogue.' }
  Write-Output 'PASS: log viewer reads the latest lines and handles missing logs'
} finally {
  $full = [IO.Path]::GetFullPath($temp)
  $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (!$full.StartsWith($parent) -or !(Split-Path -Leaf $full).StartsWith('rescore-logs-test-')) { throw 'Invalid test cleanup path' }
  Remove-Item -LiteralPath $full -Recurse -Force
}
