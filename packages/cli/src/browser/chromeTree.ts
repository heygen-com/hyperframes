import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PS_TIMEOUT_MS = 2_000;

export interface TreeMember {
  pid: number;
  command: string;
}

async function processTable(): Promise<Array<TreeMember & { ppid: number }>> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)("ps", ["-axo", "pid=,ppid=,command="], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: PS_TIMEOUT_MS,
    }));
  } catch (error) {
    // A stalled ps is killed at the timeout: nothing recorded, so the close stays bounded.
    if ((error as { killed?: boolean }).killed) return [];
    throw error;
  }
  return stdout.split("\n").flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return row ? [{ pid: Number(row[1]), ppid: Number(row[2]), command: row[3]! }] : [];
  });
}

/** Every process under `rootPid` now, so they can be ended after the root is gone and they are reparented to init. */
export async function chromeDescendants(rootPid: number): Promise<TreeMember[]> {
  const table = await processTable();
  const found: TreeMember[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const row of table) {
      if (row.ppid !== parent) continue;
      found.push({ pid: row.pid, command: row.command });
      queue.push(row.pid);
    }
  }
  return found;
}

/** Ends the members still running under the command they had, so a reused pid is left alone. */
export async function reapChromeTree(members: readonly TreeMember[]): Promise<void> {
  if (members.length === 0) return;
  const commands = new Map((await processTable()).map((row) => [row.pid, row.command]));
  for (const { pid, command } of members) {
    if (commands.get(pid) !== command) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
