param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$platformRoot = $PSScriptRoot
$bridgeRoot = (Resolve-Path -LiteralPath (Join-Path $platformRoot '..\h3-bridge')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source

function Get-PortOwner([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  return [pscustomobject]@{ Pid = $listener.OwningProcess; Address = $listener.LocalAddress; Command = [string]$process.CommandLine }
}

function Assert-Service([int]$Port, [string]$ExpectedCommand, [string]$Name, [string]$HealthUrl, [string]$Identity) {
  $owner = Get-PortOwner $Port
  if (-not $owner) { return $false }
  if ($owner.Address -notin @('127.0.0.1', '::1') -or $owner.Command -notmatch $ExpectedCommand) {
    throw "$Name port $Port is occupied by another process (PID $($owner.Pid), $($owner.Address)). Nothing was stopped."
  }
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5 } catch { throw "$Name process exists on port $Port but its health check failed. Nothing was restarted." }
  if ($response.StatusCode -ne 200) { throw "$Name health check failed with HTTP $($response.StatusCode)." }
  if (-not $response.Content.Contains($Identity, [StringComparison]::Ordinal)) { throw "$Name port $Port responded without the expected service identity. Nothing was restarted." }
  Write-Host "$Name is already running on 127.0.0.1:$Port (PID $($owner.Pid))."
  return $true
}

if (-not (Assert-Service 8788 'node(\.exe)?"?\s+(?:--env-file-if-exists=\S+\s+)?("?.*[\\/])?dist[\\/]server\.js"?' 'H3 bridge' 'http://127.0.0.1:8788/health' 'ai-site-h3-bridge')) {
  if (-not (Test-Path -LiteralPath (Join-Path $bridgeRoot 'dist\server.js'))) { throw 'H3 bridge build is missing. Run npm run build in h3-bridge first.' }
  $bridge = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env.local',(Join-Path $bridgeRoot 'dist\server.js') -WorkingDirectory $bridgeRoot -RedirectStandardOutput (Join-Path $platformRoot 'bridge.stdout.log') -RedirectStandardError (Join-Path $platformRoot 'bridge.stderr.log') -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  if (-not (Assert-Service 8788 'node(\.exe)?"?\s+(?:--env-file-if-exists=\S+\s+)?("?.*[\\/])?dist[\\/]server\.js"?' 'H3 bridge' 'http://127.0.0.1:8788/health' 'ai-site-h3-bridge')) { throw "H3 bridge did not start. Check bridge.stderr.log (PID $($bridge.Id))." }
}

if (-not (Assert-Service 3100 'next(\.exe)?\s+start\s+-p\s+3100|next[\\/]dist[\\/]bin[\\/]next\s+start\s+-p\s+3100' 'AI Site' 'http://127.0.0.1:3100/login' 'AI Site')) {
  if (-not (Test-Path -LiteralPath (Join-Path $platformRoot '.next\BUILD_ID'))) { throw 'Platform build is missing. Run npm run build first.' }
  $platform = Start-Process -FilePath $nodePath -ArgumentList (Join-Path $platformRoot 'node_modules\next\dist\bin\next'),'start','-p','3100','-H','127.0.0.1' -WorkingDirectory $platformRoot -RedirectStandardOutput (Join-Path $platformRoot 'platform.stdout.log') -RedirectStandardError (Join-Path $platformRoot 'platform.stderr.log') -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  if (-not (Assert-Service 3100 'next(\.exe)?\s+start\s+-p\s+3100|next[\\/]dist[\\/]bin[\\/]next\s+start\s+-p\s+3100' 'AI Site' 'http://127.0.0.1:3100/login' 'AI Site')) { throw "AI Site did not start. Check platform.stderr.log (PID $($platform.Id))." }
}

Write-Host 'AI Site is ready at http://127.0.0.1:3100.'
if (-not $NoOpen) { Start-Process 'http://127.0.0.1:3100' }
