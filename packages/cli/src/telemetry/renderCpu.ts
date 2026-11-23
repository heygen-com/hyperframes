import { cpus, loadavg, platform } from "node:os";
import { shouldTrack } from "./client.js";

// System-wide, not process CPU: a render's work runs in Chrome and FFmpeg
// child processes, so the CLI's own process.cpuUsage() would miss most of it.

/** How busy the machine's CPUs were during one render; shared by render_complete/render_error. */
export interface RenderCpuTelemetryPayload {
  /** Busy share of all cores, render start to end, 0-100. */
  cpuBusyAvgPct?: number;
  /** Busiest sample window's busy share of all cores, 0-100. */
  cpuBusyPeakPct?: number;
  /** Cores at or above BUSY_CORE_PCT in the busiest sample window. */
  cpuCoresBusyPeak?: number;
  /** One-minute load average; absent on Windows, where Node always reports 0. */
  loadAvgStart?: number;
  loadAvgEnd?: number;
}

export interface RenderCpuSampler {
  /** Clears the sampling interval; idempotent, later calls return the first result. */
  stop(): RenderCpuTelemetryPayload;
}

export const SAMPLE_INTERVAL_MS = 2000;
const BUSY_CORE_PCT = 80;

type CoreTimes = { busy: number; total: number }[];

function readCoreTimes(): CoreTimes {
  return cpus().map(({ times }) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { busy: total - times.idle, total };
  });
}

function busyBetween(from: CoreTimes, to: CoreTimes): { pct: number; coresBusy: number } | null {
  let busy = 0;
  let total = 0;
  let coresBusy = 0;
  to.forEach((core, i) => {
    const before = from[i];
    if (!before) return;
    const dBusy = core.busy - before.busy;
    const dTotal = core.total - before.total;
    if (dTotal <= 0) return;
    busy += dBusy;
    total += dTotal;
    if ((dBusy / dTotal) * 100 >= BUSY_CORE_PCT) coresBusy++;
  });
  return total > 0 ? { pct: Math.round((busy / total) * 100), coresBusy } : null;
}

function readLoadAvg(): number | undefined {
  if (platform() === "win32") return undefined;
  return Math.round((loadavg()[0] ?? 0) * 100) / 100;
}

const DISABLED: RenderCpuSampler = { stop: () => ({}) };

/** Start at render start; samples nothing when telemetry is off or the requester opted out. */
export function startRenderCpuSampler(requesterOptedIn = true): RenderCpuSampler {
  if (!requesterOptedIn || !shouldTrack()) return DISABLED;
  const start = readCoreTimes();
  const loadAvgStart = readLoadAvg();
  let last = start;
  let peak: { pct: number; coresBusy: number } | null = null;
  const sample = () => {
    const now = readCoreTimes();
    const window = busyBetween(last, now);
    if (window && (!peak || window.pct > peak.pct)) peak = window;
    last = now;
  };
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  timer.unref?.();
  let result: RenderCpuTelemetryPayload | undefined;
  return {
    stop() {
      if (result) return result;
      clearInterval(timer);
      sample();
      const avg = busyBetween(start, last);
      result = {
        cpuBusyAvgPct: avg?.pct,
        cpuBusyPeakPct: peak?.pct,
        cpuCoresBusyPeak: peak?.coresBusy,
        loadAvgStart,
        loadAvgEnd: readLoadAvg(),
      };
      return result;
    },
  };
}
