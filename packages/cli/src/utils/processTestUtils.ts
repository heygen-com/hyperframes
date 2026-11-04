import { execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export function testProcessIsAlive(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(") ") + 2)[0];
      return state !== "Z" && state !== "X";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForTestCondition(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface TableEntry {
  parent: number;
  name: string;
  started?: bigint;
}

function processTable(): Map<number, TableEntry> {
  const table = new Map<number, TableEntry>();
  if (process.platform === "linux") {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        table.set(Number(name), {
          parent: Number(stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[1]),
          name: stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")")),
        });
      } catch {}
    }
    return table;
  }
  const listing =
    process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.Ticks) $($_.Name)" }',
          ],
          { encoding: "utf8" },
        )
      : execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" });
  return parseProcessListing(listing, process.platform === "win32");
}

export function parseProcessListing(listing: string, withStart: boolean): Map<number, TableEntry> {
  const table = new Map<number, TableEntry>();
  for (const line of listing.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const started = withStart ? BigInt(fields.splice(2, 1)[0] ?? 0) : undefined;
    const [pid, parent, ...name] = fields;
    if (Number(pid) > 0) {
      table.set(Number(pid), { parent: Number(parent), name: name.join(" "), started });
    }
  }
  return table;
}

export function ownedDescendants(table: Map<number, TableEntry>, parentPid: number): number[] {
  const owned = new Set([parentPid]);
  for (const pid of owned) {
    const parentStart = table.get(pid)?.started;
    for (const [child, entry] of table) {
      const adopted =
        parentStart !== undefined && entry.started !== undefined && entry.started < parentStart;
      if (entry.parent === pid && !adopted) owned.add(child);
    }
  }
  owned.delete(parentPid);
  return [...owned];
}

export function testProcessDescendants(parentPid: number, named?: RegExp): number[] {
  const table = processTable();
  return ownedDescendants(table, parentPid).filter(
    (pid) => !named || named.test(table.get(pid)?.name ?? ""),
  );
}

export async function stopTestProcesses(
  root: ChildProcess,
  ownedPids: readonly number[],
): Promise<void> {
  const rootExited = () => root.exitCode !== null || root.signalCode !== null;
  if (!rootExited()) {
    root.kill("SIGTERM");
    await waitForTestCondition(rootExited, 5_000).catch(() => undefined);
  }
  try {
    for (const pid of ownedPids) {
      if (testProcessIsAlive(pid)) process.kill(pid, "SIGKILL");
    }
    await waitForTestCondition(() => ownedPids.every((pid) => !testProcessIsAlive(pid)), 5_000);
  } finally {
    if (!rootExited()) {
      root.kill("SIGKILL");
      await waitForTestCondition(rootExited, 5_000);
    }
  }
}
