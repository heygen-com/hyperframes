// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { link, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryBusyError, processStart, takeHistoryOwnership } from "./ownerLock";

// A disk that stops answering on an open of a start record, for `stall.ms`, through either kind of call; each span
// is when that open began and ended.
const stall = vi.hoisted(() => ({ ms: 0, spans: [] as Array<[number, number]> }));
const stalls = (path: unknown) => stall.ms > 0 && String(path).endsWith("owner.pid.start");

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const openSync = (path: Parameters<typeof actual.openSync>[0], ...rest: unknown[]) => {
    if (stalls(path)) {
      const began = performance.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stall.ms);
      stall.spans.push([began, performance.now()]);
    }
    return (actual.openSync as (...args: unknown[]) => number)(path, ...rest);
  };
  return { ...actual, openSync };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const open = async (path: Parameters<typeof actual.open>[0], ...rest: unknown[]) => {
    if (stalls(path)) {
      const began = performance.now();
      await new Promise((settle) => setTimeout(settle, stall.ms));
      stall.spans.push([began, performance.now()]);
    }
    return (actual.open as (...args: unknown[]) => ReturnType<typeof actual.open>)(path, ...rest);
  };
  return {
    ...actual,
    open,
    link: vi.fn(actual.link),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm),
    writeFile: vi.fn(actual.writeFile),
  };
});

const {
  link: realLink,
  rename: realRename,
  rm: realRm,
  writeFile: realWriteFile,
} = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const platform = process.platform;
const homes: string[] = [];
// Root reads a mode-000 file anyway, so the refused read below needs an ordinary user.
const canRefuseRead = process.platform !== "win32" && process.getuid?.() !== 0;

afterEach(() => {
  vi.mocked(link).mockImplementation(realLink);
  vi.mocked(rename).mockImplementation(realRename);
  vi.mocked(rm).mockImplementation(realRm);
  vi.mocked(writeFile).mockImplementation(realWriteFile);
  stall.ms = 0;
  stall.spans = [];
  Object.defineProperty(process, "platform", { value: platform });
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** A home whose owner.pid a live process holds, refuses reads, and vanishes after `ms`, as Windows does mid-delete. */
function deletingOwner(ms: number): string {
  const home = mkdtempSync(join(tmpdir(), "hf-owner-lock-"));
  homes.push(home);
  const lock = join(home, "owner.pid");
  writeFileSync(lock, String(process.ppid));
  chmodSync(lock, 0o000);
  setTimeout(() => rmSync(lock, { force: true }), ms).unref();
  return home;
}

describe.skipIf(!canRefuseRead)("takeHistoryOwnership", () => {
  it("on Windows, waits out an owner.pid it cannot read while another process deletes it", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const home = deletingOwner(200);
    const release = await takeHistoryOwnership(home, 5_000);
    expect(existsSync(join(home, "owner.pid"))).toBe(true);
    await release();
  });

  it("still fails at once on an unreadable lock outside Windows", async () => {
    await expect(takeHistoryOwnership(deletingOwner(200), 5_000)).rejects.toThrow(/EACCES/);
  });

  it("still gives up at the deadline while the lock stays unreadable", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(takeHistoryOwnership(deletingOwner(60_000), 300)).rejects.toThrow(/EACCES/);
  });

  it("still gives up at the deadline while a live owner holds the lock", async () => {
    const home = mkdtempSync(join(tmpdir(), "hf-owner-lock-"));
    homes.push(home);
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
  });
});

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hf-owner-lock-"));
  homes.push(home);
  return home;
}

describe("takeHistoryOwnership where every write is refused (the desktop app's sandboxed agents)", () => {
  const refuseWrites = () =>
    vi.mocked(writeFile).mockImplementation(async (path) => {
      throw Object.assign(new Error(`EPERM: operation not permitted, open '${String(path)}'`), {
        code: "EPERM",
        syscall: "open",
      });
    });

  // fails without the fix: EPERM writing the claim draft, though the lock was plainly held. Windows retries these
  // codes as a file locked for a moment, so it waits out the deadline as before.
  it.skipIf(platform === "win32")(
    "finds a live owner's lock busy at once, since it could never take it",
    async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), String(process.ppid));
      refuseWrites();
      // A wait for the owner would outlast the test's own timeout.
      await expect(takeHistoryOwnership(home, 60_000)).rejects.toThrow(HistoryBusyError);
    },
  );

  it("still fails with the refused write when no live owner holds the lock", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), "2147483646");
    refuseWrites();
    await expect(takeHistoryOwnership(home, 100)).rejects.toMatchObject({ code: "EPERM" });
  });
});

function withoutHardLinks(code = "ENOTSUP"): void {
  vi.mocked(link).mockImplementation(async () => {
    throw Object.assign(new Error("hard links are not supported"), { code });
  });
}

describe("takeHistoryOwnership on a drive without hard links", () => {
  // fails without the fix: EISDIR (Windows on a Google Drive folder) and EXDEV threw instead.
  it.each(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EACCES", "EISDIR", "EXDEV"])(
    "takes the lock when linking fails with %s",
    async (code) => {
      withoutHardLinks(code);
      const home = newHome();
      const release = await takeHistoryOwnership(home, 1_000);
      expect(link).toHaveBeenCalled();
      expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
      await release();
      expect(existsSync(join(home, "owner.pid"))).toBe(false);
    },
  );

  it("still refuses while a live owner holds the lock", async () => {
    withoutHardLinks();
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
    expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.ppid));
  });

  it("takes over a dead owner's lock", async () => {
    withoutHardLinks();
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), "2147483646");
    const release = await takeHistoryOwnership(home, 1_000);
    expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
    await release();
  });

  it("waits out a lock that is created but not yet written instead of evicting it", async () => {
    const home = newHome();
    const lock = join(home, "owner.pid");
    writeFileSync(lock, "");
    await expect(takeHistoryOwnership(home, 150)).rejects.toThrow(HistoryBusyError);
    expect(existsSync(lock)).toBe(true);
  });

  it("waits out an evict lock that is created but not yet written instead of removing it", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), "2147483646");
    writeFileSync(join(home, "owner.pid.evict"), "");
    await expect(takeHistoryOwnership(home, 150)).rejects.toThrow(HistoryBusyError);
    expect(existsSync(join(home, "owner.pid.evict"))).toBe(true);
  });

  it("clears an empty lock a crashed claimant left behind", async () => {
    const home = newHome();
    const lock = join(home, "owner.pid");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const release = await takeHistoryOwnership(home, 1_000);
    expect(readFileSync(lock, "utf-8")).toBe(String(process.pid));
    await release();
  });
});

const parentStart = await processStart(process.ppid);
const ownStart = await processStart(process.pid);
const initStart = await processStart(1);
const startable = process.platform !== "win32" && parentStart !== null;

describe.skipIf(!startable)("takeHistoryOwnership when a pid has been reused", () => {
  const stamp = (home: string, pid: number, start: string) =>
    writeFileSync(join(home, "owner.pid.start"), `${pid}\n${start}`);

  it("takes over a lock whose pid now runs a different process", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    stamp(home, process.ppid, "Thu Jan  1 00:00:00 1970");
    const release = await takeHistoryOwnership(home, 100);
    expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
    await release();
    expect(existsSync(join(home, "owner.pid.start"))).toBe(false);
  });

  it("holds while the live owner is the process that took the lock", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    stamp(home, process.ppid, parentStart!);
    await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
  });

  it.skipIf(initStart === null)(
    "holds a live owner this user may not signal when its start time matches",
    async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), "1");
      stamp(home, 1, initStart!);
      await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
    },
  );

  it.skipIf(initStart === null)(
    "takes over a lock whose pid is a process this user may not signal, once its start time differs",
    async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), "1");
      stamp(home, 1, "Thu Jan  1 00:00:00 1970");
      const release = await takeHistoryOwnership(home, 100);
      expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
      await release();
    },
  );

  // fails without the fix: the lock read the start record with openSync, so an open the disk never answered held the
  // caller's thread until it answered; now the thread keeps running while the open waits.
  it("keeps the thread running while an open of the owner's start record waits on the disk", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    stamp(home, process.ppid, parentStart!);
    const pings: number[] = [];
    const ping = setInterval(() => pings.push(performance.now()), 5);
    stall.ms = 300;
    try {
      await expect(takeHistoryOwnership(home, 0)).rejects.toThrow(HistoryBusyError);
    } finally {
      clearInterval(ping);
      stall.ms = 0;
    }
    const [began, ended] = stall.spans[0]!;
    expect(pings.filter((at) => at > began && at < ended).length).toBeGreaterThan(0);
  });

  it("takes over a lock without a recorded start that was written before the machine booted", async () => {
    const home = newHome();
    const lock = join(home, "owner.pid");
    writeFileSync(lock, String(process.ppid));
    const beforeBoot = new Date(Date.now() - (uptime() + 3_600) * 1000);
    utimesSync(lock, beforeBoot, beforeBoot);
    const release = await takeHistoryOwnership(home, 100);
    expect(readFileSync(lock, "utf-8")).toBe(String(process.pid));
    await release();
  });
});

describe("takeHistoryOwnership publishing its url on Windows", () => {
  const busy = () =>
    Object.assign(new Error("EBUSY: resource busy or locked, rename"), { code: "EBUSY" });

  it("rides out a rename the indexer holds once", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.mocked(rename).mockImplementationOnce(async () => {
      throw busy();
    });
    const home = newHome();
    const release = await takeHistoryOwnership(home, 1_000, "http://127.0.0.1:1234");
    expect(JSON.parse(readFileSync(join(home, "owner-url.json"), "utf-8"))).toEqual({
      pid: process.pid,
      url: "http://127.0.0.1:1234",
    });
    await release();
    expect(existsSync(join(home, "owner.pid"))).toBe(false);
  });

  it("releases owner.pid when the url can never be published", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.mocked(rename).mockImplementation(async () => {
      throw busy();
    });
    const home = newHome();
    await expect(takeHistoryOwnership(home, 1_000, "http://127.0.0.1:1234")).rejects.toThrow(
      /EBUSY/,
    );
    expect(readdirSync(home)).toEqual([]);
    vi.mocked(rename).mockImplementation(realRename);
    const release = await takeHistoryOwnership(home, 100);
    await release();
  });
});

// Windows records no start time, so there is no record to fail to write there.
describe.skipIf(process.platform === "win32")(
  "takeHistoryOwnership when the start record cannot be written",
  () => {
    it("gives the lock back instead of keeping a file nobody would release", async () => {
      vi.mocked(writeFile).mockImplementation(async (...args) => {
        if (/\.start(\.hf[0-9a-f]{6}\.tmp)?$/.test(String(args[0]))) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return realWriteFile(...args);
      });
      const home = newHome();
      await expect(takeHistoryOwnership(home, 1_000)).rejects.toThrow(/ENOSPC/);
      expect(readdirSync(home)).toEqual([]);
      vi.mocked(writeFile).mockImplementation(realWriteFile);
      const release = await takeHistoryOwnership(home, 100);
      await release();
    });
  },
);

// Windows records no start time, and making links there needs extra rights.
describe.skipIf(process.platform === "win32" || ownStart === null)(
  "takeHistoryOwnership with a linked entry at a start record's name",
  () => {
    const records = ["owner.pid.start", "owner.pid.evict.start"];

    /** A lock home and a sentinel file outside it; a dead owner too, so the evict lock writes its record. */
    function planted(record: string) {
      const home = newHome();
      const outside = newHome();
      const sentinel = join(outside, "sentinel");
      writeFileSync(sentinel, "unchanged");
      if (record === "owner.pid.evict.start") writeFileSync(join(home, "owner.pid"), "2147483646");
      return { home, outside, sentinel, entry: join(home, record) };
    }

    async function takeAndRelease(home: string): Promise<void> {
      const release = await takeHistoryOwnership(home, 1_000);
      expect(lstatSync(join(home, "owner.pid.start")).isFile()).toBe(true);
      await release();
      expect(readdirSync(home)).toEqual([]);
    }

    it.each(records)("replaces a symlink at %s instead of writing through it", async (record) => {
      const { home, sentinel, entry } = planted(record);
      symlinkSync(sentinel, entry);
      await takeAndRelease(home);
      expect(readFileSync(sentinel, "utf-8")).toBe("unchanged");
    });

    it.each(records)("creates nothing where a dangling symlink at %s points", async (record) => {
      const { home, outside, entry } = planted(record);
      const target = join(outside, "created");
      symlinkSync(target, entry);
      await takeAndRelease(home);
      expect(existsSync(target)).toBe(false);
    });

    it.each(records)("leaves a file hard-linked at %s as it was", async (record) => {
      const { home, sentinel, entry } = planted(record);
      linkSync(sentinel, entry);
      await takeAndRelease(home);
      expect(readFileSync(sentinel, "utf-8")).toBe("unchanged");
    });

    it("reads a FIFO at the start record as no record instead of waiting for a writer", async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), String(process.ppid));
      const fifo = join(home, "owner.pid.start");
      execFileSync("mkfifo", [fifo]);
      const writer = spawn("sh", ["-c", 'sleep 3; while :; do printf x > "$0"; done', fifo], {
        stdio: "ignore",
      });
      try {
        const began = Date.now();
        await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
        expect(Date.now() - began).toBeLessThan(2_000);
      } finally {
        writer.kill("SIGKILL");
      }
    });
  },
);

describe.skipIf(!canRefuseRead || ownStart === null)(
  "takeHistoryOwnership with a read-only entry at the start record's name",
  () => {
    it.each(["symlink", "file"])("takes the lock past a read-only %s", async (kind) => {
      const home = newHome();
      const sentinel = join(newHome(), "sentinel");
      writeFileSync(sentinel, "unchanged");
      chmodSync(sentinel, 0o444);
      const entry = join(home, "owner.pid.start");
      if (kind === "symlink") symlinkSync(sentinel, entry);
      else {
        writeFileSync(entry, "unchanged");
        chmodSync(entry, 0o444);
      }
      const release = await takeHistoryOwnership(home, 1_000);
      expect(lstatSync(entry).isFile()).toBe(true);
      await release();
      expect(readFileSync(sentinel, "utf-8")).toBe("unchanged");
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "takeHistoryOwnership with a symlink at owner.pid",
  () => {
    it("clears the link as a lock without a pid and leaves its target as it was", async () => {
      const home = newHome();
      const sentinel = join(newHome(), "sentinel");
      writeFileSync(sentinel, String(process.ppid));
      symlinkSync(sentinel, join(home, "owner.pid"));
      const release = await takeHistoryOwnership(home, 1_000);
      expect(lstatSync(join(home, "owner.pid")).isFile()).toBe(true);
      expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
      await release();
      expect(readFileSync(sentinel, "utf-8")).toBe(String(process.ppid));
    });
  },
);

describe.skipIf(!startable)("takeHistoryOwnership handing a lock on within one process", () => {
  // fails without the fix: the release removed owner.pid before its start record, so a claim taken in the gap
  // wrote its own record and the late removal deleted it.
  it("keeps the next owner's start record when a release's removal of the old one is slow", async () => {
    const home = newHome();
    const record = join(home, "owner.pid.start");
    const first = await takeHistoryOwnership(home, 1_000);
    let slowed = false;
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (!slowed && String(path) === record) {
        slowed = true;
        await new Promise((settle) => setTimeout(settle, 150));
      }
      return realRm(path, options);
    });
    const releasing = first();
    const next = await takeHistoryOwnership(home, 2_000);
    await releasing;
    expect(slowed).toBe(true);
    expect(readFileSync(record, "utf-8").split("\n")[0]).toBe(String(process.pid));
    await next();
  });

  // fails without the fix: the failed release was kept, so every later call answered with the same failure and
  // owner.pid stayed behind naming this live process.
  it("lets a release that failed be tried again", async () => {
    const home = newHome();
    const lock = join(home, "owner.pid");
    const release = await takeHistoryOwnership(home, 1_000);
    vi.mocked(rm).mockImplementationOnce(async () => {
      throw Object.assign(new Error("EBUSY: resource busy or locked, unlink"), { code: "EBUSY" });
    });
    await expect(release()).rejects.toThrow(/EBUSY/);
    expect(existsSync(lock)).toBe(true);
    await release();
    expect(existsSync(lock)).toBe(false);
  });
});
