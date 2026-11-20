# Throwaway probe: samples what the runner is doing every 3 s until the job ends.
param([string]$Out)
$cpu0 = @{}
"time,total_cpu,free_mb,disk_queue,defender_rt,msmpeng_cpu_s,python_ms,pwsh_ms,top" | Out-File $Out -Encoding utf8
while ($true) {
  $t = Get-Date -Format "HH:mm:ss"
  $total = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  $free = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
  $queue = (Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'").CurrentDiskQueueLength
  $rt = try { (Get-MpComputerStatus).RealTimeProtectionEnabled } catch { "err" }
  $mp = (Get-Process MsMpEng -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
  $py = try { [int](Measure-Command { python3 -c pass 2>$null }).TotalMilliseconds } catch { -1 }
  $ps = [int](Measure-Command { powershell.exe -NoProfile -Command 1 | Out-Null }).TotalMilliseconds
  $top = Get-Process | ForEach-Object {
    $key = "$($_.Id)"; $now = $_.CPU; $d = if ($cpu0.ContainsKey($key) -and $now) { $now - $cpu0[$key] } else { 0 }
    if ($now) { $cpu0[$key] = $now }
    [pscustomobject]@{ N = $_.ProcessName; D = $d }
  } | Sort-Object D -Descending | Select-Object -First 5 | ForEach-Object { "$($_.N)=$([math]::Round($_.D,1))" }
  "$t,$total,$free,$queue,$rt,$([math]::Round($mp,1)),$py,$ps,$($top -join ' ')" | Out-File $Out -Encoding utf8 -Append
  Start-Sleep -Seconds 3
}
