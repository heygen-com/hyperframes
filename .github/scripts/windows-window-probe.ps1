# Runs agent-facing commands from a launcher with no console (like an app that starts an agent), and fails if any
# of them opens a visible top-level window.
param([Parameter(Mandatory)][string]$Cli, [Parameter(Mandatory)][string]$Project)
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Windows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static List<string[]> Visible() {
    var rows = new List<string[]>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var t = new StringBuilder(256); var c = new StringBuilder(256);
      GetWindowText(h, t, 256); GetClassName(h, c, 256);
      rows.Add(new[] { h.ToString(), pid.ToString(), c.ToString(), t.ToString() });
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@

function Snapshot {
  $seen = @{}
  foreach ($w in [Windows]::Visible()) {
    $proc = Get-Process -Id ([int]$w[1]) -ErrorAction SilentlyContinue
    $seen[$w[0]] = [pscustomobject]@{ Process = $proc.ProcessName; Id = $w[1]; Class = $w[2]; Title = $w[3]; Cmd = '' }
  }
  $seen
}

# Starts `node launcher.mjs <cli> <cwd> <seconds> <args...>` and reports every window that appears meanwhile.
function Watch([string]$Name, [int]$Seconds, [string[]]$CliArgs) {
  $baseline = Snapshot
  $p = Start-Process -FilePath node -ArgumentList (@($launcher, $Cli, $Project, $Seconds) + $CliArgs) -WindowStyle Hidden -PassThru
  $found = @{}
  while (-not $p.HasExited) {
    foreach ($entry in (Snapshot).GetEnumerator()) {
      if (-not $baseline.ContainsKey($entry.Key) -and -not $found.ContainsKey($entry.Key)) {
        $row = $entry.Value
        if ($row.Process -match 'chrome') {
          $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.Id)" -ErrorAction SilentlyContinue
          $parent = if ($q) { Get-CimInstance Win32_Process -Filter "ProcessId=$($q.ParentProcessId)" -ErrorAction SilentlyContinue }
          $row.Cmd = "pid=$($row.Id) parent=[$($parent.Name) $($parent.ProcessId) main=$((($parent.CommandLine -replace '^.*chrome-headless-shell.exe"? ',''))) ] cmd=[$((("$($q.CommandLine)") -replace '^.*chrome-headless-shell.exe"? ','').Substring(0, [Math]::Min(260, ("$($q.CommandLine)" -replace '^.*chrome-headless-shell.exe"? ','').Length)))]"
        }
        $found[$entry.Key] = $row
      }
    }
    Start-Sleep -Milliseconds 50
  }
  $p.WaitForExit()
  Write-Host ("{0,-10} exit={1} new windows={2}" -f $Name, $p.ExitCode, $found.Count)
  if ($p.ExitCode -ne 0) { Get-Content (Join-Path $env:RUNNER_TEMP "command.log") -Tail 12 | ForEach-Object { Write-Host "    | $_" } }
  $found.Values | ForEach-Object { Write-Host "    $($_.Process) class=$($_.Class) title=[$($_.Title)] $($_.Cmd)" }
  [pscustomobject]@{ Name = $Name; Exit = $p.ExitCode; Windows = $found.Count }
}

# The launcher has no console and no window; windowsHide only reaches the CLI itself, never what the CLI starts.
$launcher = Join-Path $env:RUNNER_TEMP 'launch-cli.mjs'
@'
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
const [cli, cwd, seconds, ...args] = process.argv.slice(2);
const log = openSync(process.env.RUNNER_TEMP + "\\command.log", "w");
const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true, stdio: ["ignore", log, log] });
const stop = Number(seconds) > 0 ? setTimeout(() => child.kill(), Number(seconds) * 1000) : undefined;
child.on("exit", (code) => { clearTimeout(stop); process.exit(code ?? 0); });
'@ | Set-Content -Encoding utf8 $launcher


$runs = @(
  (Watch 'render' 0 @('render', '--fps', '30', '--quality', 'draft', '--workers', '2', '--output', 'renders/probe.mp4')),
  (Watch 'check' 0 @('check')),
  (Watch 'check-warm' 0 @('check')),
  (Watch 'snapshot' 0 @('snapshot', '--frames', '2')),
  (Watch 'doctor' 0 @('doctor')),
  (Watch 'preview' 20 @('preview', '--port', '3571'))
)
$bad = $runs | Where-Object { $_.Windows -gt 0 }
if ($bad) { throw "windows opened by: $(($bad | ForEach-Object Name) -join ', ')" }
$failed = $runs | Where-Object { $_.Name -in @('render', 'snapshot') -and $_.Exit -ne 0 }
if ($failed) { throw "commands failed: $(($failed | ForEach-Object Name) -join ', ')" }
