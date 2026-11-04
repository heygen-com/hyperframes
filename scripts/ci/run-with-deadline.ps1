# Runs a command and, if it outlives the deadline, prints the process tree it left and kills it.
# GitHub's step timeout did not fire on a hung Windows test step and the log was lost with it.
param(
  [Parameter(Mandatory)][int]$Minutes,
  [Parameter(Mandatory)][string]$Command
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:RUNNER_TEMP "deadline-step.log"
$null = New-Item $log -ItemType File
$child = Start-Process pwsh -ArgumentList '-NoProfile', '-Command', "$Command *>> '$log'" -PassThru -WindowStyle Hidden
$read = 0
$stop = (Get-Date).AddMinutes($Minutes)
function Show-NewOutput {
  $stream = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
  try {
    $null = $stream.Seek($script:read, 'Begin')
    $text = (New-Object IO.StreamReader($stream)).ReadToEnd()
    $script:read = $stream.Position
    if ($text) { [Console]::Out.Write($text) }
  } finally { $stream.Dispose() }
}
while (-not $child.HasExited -and (Get-Date) -lt $stop) { Show-NewOutput; Start-Sleep -Seconds 2 }
Show-NewOutput
if ($child.HasExited) { exit $child.ExitCode }
Write-Host "::error::'$Command' ran past $Minutes minutes; process tree at the deadline:"
$table = Get-CimInstance Win32_Process
$tree = @($child.Id)
for ($i = 0; $i -lt $tree.Count; $i++) { $tree += @($table | Where-Object ParentProcessId -eq $tree[$i] | ForEach-Object ProcessId) }
$table | Where-Object { $tree -contains $_.ProcessId } |
  ForEach-Object { "{0} <- {1} {2} {3:N0}s old: {4}" -f $_.ProcessId, $_.ParentProcessId, $_.Name, ((Get-Date) - $_.CreationDate).TotalSeconds, $_.CommandLine }
taskkill /T /F /PID $child.Id | Out-Null
exit 124
