import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

interface SpawnedProcess {
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (status: number | null) => void): unknown;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess;

export interface ProcessTreeTerminationOptions {
  child?: Pick<ChildProcess, "kill">;
  processGroup?: boolean;
  signal?: NodeJS.Signals;
  spawnProcess?: SpawnProcess;
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code !== "ESRCH";
  }
}

function processGroupIsAlive(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      return readdirSync("/proc").some((entry) => {
        if (!/^\d+$/.test(entry)) return false;
        try {
          const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
          const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(/\s+/);
          return fields[2] === String(pid) && fields[0] !== "Z" && fields[0] !== "X";
        } catch {
          return false;
        }
      });
    } catch {}
  }
  return processIsAlive(-pid);
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForProcessGroupExit(pid: number): Promise<void> {
  while (processGroupIsAlive(pid)) await waitForDelay(20);
}

export function windowsProcessTreeKillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

export function terminateWindowsProcessTree(
  pid: number,
  spawnProcess: SpawnProcess = (command, args, options) => spawn(command, [...args], options),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const killer = spawnProcess("taskkill", windowsProcessTreeKillArgs(pid), {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("close", (status) => {
      if (status === 0) resolve();
      else reject(new Error(`taskkill exited with status ${status ?? "unknown"}`));
    });
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {}
}

function getDescendants(pid: number): number[] {
  let children: number[];
  try {
    const raw = execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    children = raw
      .split(/\r?\n/)
      .map(Number)
      .filter((childPid) => Number.isInteger(childPid) && childPid > 0);
  } catch {
    return [];
  }
  return children.flatMap((childPid) => [childPid, ...getDescendants(childPid)]);
}

function signalProcesses(pids: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

async function terminatePidTree(pid: number, signal: NodeJS.Signals): Promise<NodeJS.Signals> {
  const pids = [...getDescendants(pid).reverse(), pid];
  signalProcesses(pids, signal);
  if (signal === "SIGKILL") return "SIGKILL";
  await waitForDelay(500);
  const survivors = pids.filter(processIsAlive);
  signalProcesses(survivors, "SIGKILL");
  return survivors.length > 0 ? "SIGKILL" : "SIGTERM";
}

async function terminateProcessGroup(pid: number, signal: NodeJS.Signals): Promise<NodeJS.Signals> {
  signalProcessGroup(pid, signal);
  if (signal === "SIGKILL") {
    await waitForProcessGroupExit(pid);
    return "SIGKILL";
  }
  await Promise.race([waitForProcessGroupExit(pid), waitForDelay(250)]);
  if (!processGroupIsAlive(pid)) return "SIGTERM";
  signalProcessGroup(pid, "SIGKILL");
  await waitForProcessGroupExit(pid);
  return "SIGKILL";
}

export async function terminateProcessTree(
  pid: number,
  options: ProcessTreeTerminationOptions = {},
): Promise<NodeJS.Signals> {
  if (process.platform === "win32") {
    try {
      await terminateWindowsProcessTree(pid, options.spawnProcess);
    } catch (error) {
      try {
        options.child?.kill("SIGKILL");
      } catch {}
      if (options.child) throw error;
    }
    return "SIGKILL";
  }

  const signal = options.signal ?? "SIGTERM";
  return options.processGroup ? terminateProcessGroup(pid, signal) : terminatePidTree(pid, signal);
}
