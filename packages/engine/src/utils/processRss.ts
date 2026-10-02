import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export interface ProcessRssSample {
  pid: number;
  rssMb: number;
}

export type ExecFileLike = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;
export type ReadFileLike = (path: string) => Promise<string>;

const KB_PER_MB = 1024;

const defaultReadFile: ReadFileLike = (path) => readFile(path, "utf8");

function defaultExec(): ExecFileLike {
  // promisify lazily so vitest module mocks of child_process still take effect
  // (same reason psnr.ts does this).
  const execFileP = promisify(execFile);
  return async (file, args) => {
    const { stdout } = await execFileP(file, [...args], { windowsHide: true, timeout: 5_000 });
    return { stdout: String(stdout) };
  };
}

/** `ps -o pid=,rss=` output: one "<pid> <rss-kb>" pair per line. */
export function parsePsRss(stdout: string): ProcessRssSample[] {
  const samples: ProcessRssSample[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const rssKb = Number(match[2]);
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
    samples.push({ pid, rssMb: Math.round(rssKb / KB_PER_MB) });
  }
  return samples;
}

/** `tasklist /FO CSV /NH /FI "PID eq N"`: `"image","pid","session","sess#","12,345 K"`. */
export function parseTasklistCsv(pid: number, stdout: string): ProcessRssSample[] {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('"'));
  if (!line) return [];
  const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ""));
  const memCell = cells[4];
  if (typeof memCell !== "string") return [];
  const kb = Number(memCell.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(kb) || kb <= 0) return [];
  return [{ pid, rssMb: Math.round(kb / KB_PER_MB) }];
}

/** `/proc/<pid>/status` line `VmRSS:\t  12345 kB`; absent for a zombie. */
export function parseProcStatusRss(pid: number, status: string): ProcessRssSample[] {
  const match = /^VmRSS:\s*(\d+)\s*kB/m.exec(status);
  if (!match) return [];
  const kb = Number(match[1]);
  if (!Number.isFinite(kb) || kb <= 0) return [];
  return [{ pid, rssMb: Math.round(kb / KB_PER_MB) }];
}

/**
 * Resident set size per pid, in MiB. Zero dependencies: `/proc/<pid>/status`
 * on Linux (the render images are `node:*-slim` and ship no `ps`; same
 * precedent as the CLI's orphanCleanup / processTree), `ps` on other POSIX
 * (one call for all pids), `tasklist` on Windows (one call per pid). Never
 * rejects; a pid that exited between discovery and sampling is simply absent.
 */
export async function sampleProcessRss(
  pids: readonly number[],
  exec: ExecFileLike = defaultExec(),
  platform: NodeJS.Platform = process.platform,
  readStatus: ReadFileLike = defaultReadFile,
): Promise<ProcessRssSample[]> {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (unique.length === 0) return [];
  if (platform === "linux") {
    // Per-pid catch: one exited pid must not erase the others' samples.
    const perPid = await Promise.all(
      unique.map(async (pid) => {
        try {
          return parseProcStatusRss(pid, await readStatus(`/proc/${pid}/status`));
        } catch {
          return [];
        }
      }),
    );
    return perPid.flat();
  }
  try {
    if (platform === "win32") {
      const results: ProcessRssSample[] = [];
      for (const pid of unique) {
        const { stdout } = await exec("tasklist", ["/FO", "CSV", "/NH", "/FI", `PID eq ${pid}`]);
        results.push(...parseTasklistCsv(pid, stdout));
      }
      return results;
    }
    const { stdout } = await exec("ps", ["-o", "pid=,rss=", "-p", unique.join(",")]);
    return parsePsRss(stdout);
  } catch {
    return [];
  }
}
