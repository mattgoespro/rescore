param([string]$Id,[string]$Action,[string]$Name)
$ErrorActionPreference='Stop'
$root=Join-Path $env:TEMP 'rescore-installed-acceptance-20261014'
$reply=Join-Path $root "$Id.json"
if (!(Test-Path -LiteralPath $reply)) {
  $command=@{id=$Id;action=$Action}
  if($Name){$command.name=$Name}
  $command|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'command.json')
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  while(!(Test-Path -LiteralPath $reply) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
}
if(!(Test-Path -LiteralPath $reply)){throw "Installed app command timed out: $Id"}
$result=Get-Content -Raw -LiteralPath $reply|ConvertFrom-Json
if(!$result.ok){throw "$Id failed: $($result.error)"}
if($result.errors.Count){throw "$Id recorded renderer errors"}
$result
