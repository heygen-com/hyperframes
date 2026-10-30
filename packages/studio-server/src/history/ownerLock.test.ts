// @vitest-environment node
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryBusyError, processStart, takeHistoryOwnership } from "./ownerLock";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    linkSync: vi.fn(actual.linkSync),
    renameSync: vi.fn(actual.renameSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

const {
  linkSync: realLinkSync,
  renameSync: realRenameSync,
  writeFileSync: realWriteFileSync,
} = await vi.importActual<typeof import("node:fs")>("node:fs");

const platform = process.platform;
const homes: string[] = [];
// Root reads a mode-000 file anyway, so the refused read below needs an ordinary user.
const canRefuseRead = process.platform !== "win32" && process.getuid?.() !== 0;

afterEach(() => {
  vi.mocked(linkSync).mockImplementation(realLinkSync);
  vi.mocked(renameSync).mockImplementation(realRenameSync);
  vi.mocked(writeFileSync).mockImplementation(realWriteFileSync);
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
    release();
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

function withoutHardLinks(code = "ENOTSUP"): void {
  vi.mocked(linkSync).mockImplementation(() => {
    throw Object.assign(new Error("hard links are not supported"), { code });
  });
}

describe("takeHistoryOwnership on a drive without hard links", () => {
  it.each(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"])(
    "takes the lock when linking fails with %s",
    async (code) => {
      withoutHardLinks(code);
      const home = newHome();
      const release = await takeHistoryOwnership(home, 1_000);
      expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
      release();
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
    release();
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
    release();
  });
});

const startable = process.platform !== "win32" && processStart(process.ppid) !== null;

describe.skipIf(!startable)("takeHistoryOwnership when a pid has been reused", () => {
  const stamp = (home: string, pid: number, start: string) =>
    writeFileSync(join(home, "owner.pid.start"), `${pid}\n${start}`);

  it("takes over a lock whose pid now runs a different process", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    stamp(home, process.ppid, "Thu Jan  1 00:00:00 1970");
    const release = await takeHistoryOwnership(home, 100);
    expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
    release();
    expect(existsSync(join(home, "owner.pid.start"))).toBe(false);
  });

  it("holds while the live owner is the process that took the lock", async () => {
    const home = newHome();
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    stamp(home, process.ppid, processStart(process.ppid)!);
    await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
  });

  it.skipIf(processStart(1) === null)(
    "holds a live owner this user may not signal when its start time matches",
    async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), "1");
      stamp(home, 1, processStart(1)!);
      await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
    },
  );

  it.skipIf(processStart(1) === null)(
    "takes over a lock whose pid is a process this user may not signal, once its start time differs",
    async () => {
      const home = newHome();
      writeFileSync(join(home, "owner.pid"), "1");
      stamp(home, 1, "Thu Jan  1 00:00:00 1970");
      const release = await takeHistoryOwnership(home, 100);
      expect(readFileSync(join(home, "owner.pid"), "utf-8")).toBe(String(process.pid));
      release();
    },
  );

  it("takes over a lock without a recorded start that was written before the machine booted", async () => {
    const home = newHome();
    const lock = join(home, "owner.pid");
    writeFileSync(lock, String(process.ppid));
    const beforeBoot = new Date(Date.now() - (uptime() + 3_600) * 1000);
    utimesSync(lock, beforeBoot, beforeBoot);
    const release = await takeHistoryOwnership(home, 100);
    expect(readFileSync(lock, "utf-8")).toBe(String(process.pid));
    release();
  });
});

describe("takeHistoryOwnership publishing its url on Windows", () => {
  const busy = () =>
    Object.assign(new Error("EBUSY: resource busy or locked, rename"), { code: "EBUSY" });

  it("rides out a rename the indexer holds once", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw busy();
    });
    const home = newHome();
    const release = await takeHistoryOwnership(home, 1_000, "http://127.0.0.1:1234");
    expect(JSON.parse(readFileSync(join(home, "owner-url.json"), "utf-8"))).toEqual({
      pid: process.pid,
      url: "http://127.0.0.1:1234",
    });
    release();
    expect(existsSync(join(home, "owner.pid"))).toBe(false);
  });

  it("releases owner.pid when the url can never be published", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.mocked(renameSync).mockImplementation(() => {
      throw busy();
    });
    const home = newHome();
    await expect(takeHistoryOwnership(home, 1_000, "http://127.0.0.1:1234")).rejects.toThrow(
      /EBUSY/,
    );
    expect(readdirSync(home)).toEqual([]);
    vi.mocked(renameSync).mockImplementation(realRenameSync);
    const release = await takeHistoryOwnership(home, 100);
    release();
  });
});

// Windows records no start time, so there is no record to fail to write there.
describe.skipIf(process.platform === "win32")(
  "takeHistoryOwnership when the start record cannot be written",
  () => {
    it("gives the lock back instead of keeping a file nobody would release", async () => {
      vi.mocked(writeFileSync).mockImplementation((...args) => {
        if (String(args[0]).endsWith(".start")) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return realWriteFileSync(...args);
      });
      const home = newHome();
      await expect(takeHistoryOwnership(home, 1_000)).rejects.toThrow(/ENOSPC/);
      expect(readdirSync(home)).toEqual([]);
      vi.mocked(writeFileSync).mockImplementation(realWriteFileSync);
      const release = await takeHistoryOwnership(home, 100);
      release();
    });
  },
);
