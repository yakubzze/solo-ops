<#
  Stops the app server listening on the given port.

  It checks the process command line before killing anything: port 4321 can be
  held by anything at all, and killing someone else's process because it sits on
  your port is worse than stopping nothing.
#>
param(
  [int] $Port = 4321
)

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
  Write-Host "Nothing was listening on port $Port - the app is not running."
  exit 0
}

$stopped = 0
foreach ($listener in $listeners) {
  $processId = $listener.OwningProcess
  $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue).CommandLine

  if ($commandLine -and $commandLine -match 'index\.mjs') {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "Stopped (PID $processId)."
      $stopped++
    } catch {
      Write-Host "Could not stop PID $processId : $($_.Exception.Message)"
    }
  } else {
    Write-Host "Port $Port is held by something else (PID $processId). Leaving it alone."
    Write-Host "  $commandLine"
    exit 1
  }
}

if ($stopped -eq 0) { exit 1 }