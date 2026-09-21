import { describe, expect, it } from "vitest";
import {
  parseProcStatusRss,
  parsePsRss,
  parseTasklistCsv,
  sampleProcessRss,
} from "./processRss.js";

describe("parsePsRss", () => {
  it("parses pid and rss kilobytes into megabytes", () => {
    const out = "  4242 1048576\n 4243   2048\n";
    expect(parsePsRss(out)).toEqual([
      { pid: 4242, rssMb: 1024 },
      { pid: 4243, rssMb: 2 },
    ]);
  });

  it("skips blank and malformed lines", () => {
    expect(parsePsRss("\n  PID RSS\nabc def\n 7 10240\n")).toEqual([{ pid: 7, rssMb: 10 }]);
  });
});

describe("parseTasklistCsv", () => {
  it("parses the memory column with thousands separators", () => {
    const out = '"chrome.exe","4242","Console","1","1,048,576 K"\r\n';
    expect(parseTasklistCsv(4242, out)).toEqual([{ pid: 4242, rssMb: 1024 }]);
  });

  it("returns [] for the 'no tasks' message", () => {
    expect(
      parseTasklistCsv(4242, "INFO: No tasks are running which match the specified criteria."),
    ).toEqual([]);
  });

  it("returns [] when the memory column is not a positive number", () => {
    expect(parseTasklistCsv(7, '"chrome.exe","7","Console","1","N/A"\r\n')).toEqual([]);
  });
});

describe("parseProcStatusRss", () => {
  it("parses the VmRSS line of /proc/<pid>/status", () => {
    const status =
      "Name:\tchrome\nState:\tS (sleeping)\nVmPeak:\t 9999999 kB\nVmRSS:\t 1048576 kB\nThreads:\t12\n";
    expect(parseProcStatusRss(4242, status)).toEqual([{ pid: 4242, rssMb: 1024 }]);
  });

  it("returns [] when VmRSS is absent (zombie) or zero", () => {
    expect(parseProcStatusRss(1, "Name:\tchrome\nState:\tZ (zombie)\nThreads:\t1\n")).toEqual([]);
    expect(parseProcStatusRss(1, "VmRSS:\t       0 kB\n")).toEqual([]);
  });
});

describe("sampleProcessRss", () => {
  it("reads /proc/<pid>/status per pid on linux and never shells out", async () => {
    let execCalled = false;
    const exec = async () => {
      execCalled = true;
      return { stdout: "" };
    };
    const reads: string[] = [];
    const readStatus = async (path: string) => {
      reads.push(path);
      return `Name:\tchrome\nVmRSS:\t ${path.endsWith("/1/status") ? 1024 : 2048} kB\n`;
    };
    const result = await sampleProcessRss([1, 2], exec, "linux", readStatus);
    expect(reads).toEqual(["/proc/1/status", "/proc/2/status"]);
    expect(execCalled).toBe(false);
    expect(result).toEqual([
      { pid: 1, rssMb: 1 },
      { pid: 2, rssMb: 2 },
    ]);
  });

  it("omits only the pid whose /proc read fails on linux", async () => {
    const exec = async () => ({ stdout: "" });
    const readStatus = async (path: string) => {
      if (path === "/proc/1/status") throw new Error("ENOENT");
      return "VmRSS:\t 2048 kB\n";
    };
    expect(await sampleProcessRss([1, 2], exec, "linux", readStatus)).toEqual([
      { pid: 2, rssMb: 2 },
    ]);
  });

  it("never rejects on linux when every /proc read fails", async () => {
    const exec = async () => ({ stdout: "" });
    const readStatus = async () => {
      throw new Error("ENOENT");
    };
    expect(await sampleProcessRss([1, 2], exec, "linux", readStatus)).toEqual([]);
  });

  it("uses one ps call for all pids on posix", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const exec = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      return { stdout: " 1 1024\n 2 2048\n" };
    };
    const result = await sampleProcessRss([1, 2], exec, "darwin");
    expect(calls).toEqual([{ file: "ps", args: ["-o", "pid=,rss=", "-p", "1,2"] }]);
    expect(result).toEqual([
      { pid: 1, rssMb: 1 },
      { pid: 2, rssMb: 2 },
    ]);
  });

  it("uses one tasklist call per pid on win32", async () => {
    const calls: string[][] = [];
    const exec = async (_file: string, args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: '"chrome.exe","9","Console","1","2,048 K"\r\n' };
    };
    const result = await sampleProcessRss([9], exec, "win32");
    expect(calls).toEqual([["/FO", "CSV", "/NH", "/FI", "PID eq 9"]]);
    expect(result).toEqual([{ pid: 9, rssMb: 2 }]);
  });

  it("drops invalid pids and duplicates before calling ps", async () => {
    const calls: Array<readonly string[]> = [];
    const exec = async (_file: string, args: readonly string[]) => {
      calls.push(args);
      return { stdout: " 3 1024\n 4 2048\n" };
    };
    // NaN / 0 / -1 / 2.5 must never reach `ps -p`: one bad pid fails the
    // whole call and every other pid's sample is lost with it.
    await sampleProcessRss([3, 3, NaN, 0, -1, 2.5, 4], exec, "darwin");
    expect(calls).toEqual([["-o", "pid=,rss=", "-p", "3,4"]]);
  });

  it("returns [] on empty input without calling exec", async () => {
    let called = false;
    const exec = async () => {
      called = true;
      return { stdout: "" };
    };
    expect(await sampleProcessRss([], exec, "linux")).toEqual([]);
    expect(called).toBe(false);
  });

  it("never rejects when exec fails", async () => {
    const exec = async () => {
      throw new Error("ENOENT");
    };
    // darwin, not linux: linux no longer reaches exec at all.
    expect(await sampleProcessRss([1], exec, "darwin")).toEqual([]);
    expect(await sampleProcessRss([1], exec, "win32")).toEqual([]);
  });
});
