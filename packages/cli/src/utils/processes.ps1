# The CLI's reads of Windows' process table and a file's version (utils/windowsProcesses.ts), run with -File; nothing
# a call passes is run as code. identity <id>: its start as a FILETIME. parent <id>: its parent's id.
# table: `id parent start name` lines. version <path>: the file's product version.
param([ValidateSet('identity', 'parent', 'table', 'version')][string]$Read, [string]$Target = '')
$ErrorActionPreference = 'SilentlyContinue'

function Find-Process([string]$Id) {
  if ($Id -match '^\d+$') { Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Id)" }
}

switch ($Read) {
  'identity' { $process = Find-Process $Target; if ($process) { $process.CreationDate.ToFileTimeUtc() } }
  'parent' { $process = Find-Process $Target; if ($process) { $process.ParentProcessId } }
  'table' {
    Get-CimInstance Win32_Process | ForEach-Object {
      '{0} {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc(), $_.Name
    }
  }
  'version' { if ($Target) { (Get-Item -LiteralPath $Target).VersionInfo.ProductVersion } }
}
