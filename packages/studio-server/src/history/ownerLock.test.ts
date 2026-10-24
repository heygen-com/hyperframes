// @vitest-environment node
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryBusyError, takeHistoryOwnership } from "./ownerLock";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, linkSync: vi.fn(actual.linkSync) };
});

const { linkSync: realLinkSync } = await vi.importActual<typeof import("node:fs")>("node:fs");

const platform = process.platform;
const homes: string[] = [];
// Root reads a mode-000 file anyway, so the refused read below needs an ordinary user.
const canRefuseRead = process.platform !== "win32" && process.getuid?.() !== 0;

afterEach(() => {
  vi.mocked(linkSync).mockImplementation(realLinkSync);
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
