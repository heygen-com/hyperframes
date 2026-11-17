import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  fchmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRenderLock, RenderLockBusy, type RenderLockOptions } from "./renderLock.js";
import { type RenderLockHolder } from "./renderLockClaim.js";
import { startToken } from "./renderLockOwners.js";
import { RenderLockStaleBreak } from "./renderLockClaim.js";
import type { Holder } from "./projectLock.js";
import { acquireRenderSlot } from "../commands/render/renderSlot.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, unlinkSync: vi.fn(fs.unlinkSync), fchmodSync: vi.fn(fs.fchmodSync) };
});
const { unlinkSync: realUnlinkSync, fchmodSync: realFchmodSync } =
  await vi.importActual<typeof import("node:fs")>("node:fs");

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-render-lock-"));
  path = join(dir, "locks", "render.lock");
});

const stillWaiting: Array<{ stop: AbortController; settled: Promise<unknown> }> = [];

/** An acquire that every test ends before its folder is removed, so no loop outlives the test. */
function startAcquire(options: Omit<RenderLockOptions, "signal">): Promise<() => void> {
  const stop = new AbortController();
  const acquiring = acquireRenderLock({ ...options, signal: stop.signal });
  stillWaiting.push({ stop, settled: acquiring.catch(() => undefined) });
  return acquiring;
}

afterEach(async () => {
  for (const { stop } of stillWaiting) stop.abort(new Error("test over"));
  await Promise.all(stillWaiting.splice(0).map(({ settled }) => settled));
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

describe("acquireRenderLock", () => {
  it("refuses a second render under --no-wait, naming the render that holds the slot", async () => {
    const release = await acquireRenderLock({ project: "/work/brand", wait: false, path, env: {} });

    const second = acquireRenderLock({ project: "/work/crime", wait: false, path, env: {} });

    await expect(second).rejects.toBeInstanceOf(RenderLockBusy);
    await expect(second).rejects.toThrow(`pid ${process.pid}, project /work/brand`);
    release();
    expect(existsSync(path)).toBe(false);
  });

  it("waits while another render holds the slot and starts once it is released", async () => {
    vi.useFakeTimers();
    const release = await acquireRenderLock({ project: "/work/brand", wait: false, path, env: {} });
    const waits: Array<RenderLockHolder | null> = [];
    let started = false;
    const second = startAcquire({
      project: "/work/crime",
      wait: true,
      path,
      env: {},
      onWait: (holder) => waits.push(holder),
    }).then((releaseSecond) => {
      started = true;
      return releaseSecond;
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toBe(false);
    expect(waits.map((holder) => holder?.project)).toEqual(["/work/brand"]);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toBe(true);
    (await second)();
  });

  it("takes over a slot whose render process is gone", async () => {
    const stale: RenderLockHolder = {
      pid: deadPid(),
      command: "render",
      startedAt: 1,
      project: "/work/killed",
    };
    await acquireRenderLock({ project: "/work/seed", wait: false, path, env: {} }).then((r) => r());
    writeFileSync(path, JSON.stringify(stale));

    const release = await acquireRenderLock({ project: "/work/next", wait: false, path, env: {} });

    release();
  });

  describe("a takeover file (.break)", () => {
    const record = (pid: number, project: string): RenderLockHolder => ({
      pid,
      command: "render",
      startedAt: 1,
      project,
      identity: startToken(pid),
    });
    const seed = (breaker: string) => {
      mkdirSync(join(dir, "locks"), { recursive: true });
      writeFileSync(path, JSON.stringify(record(deadPid(), "/work/killed")));
      writeFileSync(`${path}.break`, breaker);
    };

    it.each([
      ["readable", () => JSON.stringify(record(deadPid(), "/work/breaker"))],
      ["half-written", () => '{"pid":'],
    ])(
      "left %s by a render that died is never deleted on an earlier reading; the render says what to delete",
      async (_kind, content) => {
        const left = content();
        seed(left);
        for (const wait of [false, true]) {
          await expect(
            startAcquire({ project: "/work/next", wait, path, env: {} }),
          ).rejects.toBeInstanceOf(RenderLockStaleBreak);
        }
        expect(readFileSync(`${path}.break`, "utf8")).toBe(left);
      },
    );

    it("that a live render is still writing is left to it, and that render's takeover holds alone", async () => {
      vi.useFakeTimers({ now: Date.now() });
      mkdirSync(join(dir, "locks"), { recursive: true });
      writeFileSync(path, JSON.stringify(record(deadPid(), "/work/killed")));
      let resume: () => void = () => {};
      let heldBy: string[] = [];
      const first = startAcquire({
        project: "/work/one",
        wait: false,
        path,
        env: {},
        beforeReplace: () => new Promise<void>((resolve) => (resume = resolve)),
      }).then((release) => ((heldBy = [...heldBy, "one"]), release));
      await vi.waitFor(() => expect(existsSync(`${path}.break`)).toBe(true));
      const breakWhileReplacing = readFileSync(`${path}.break`, "utf8");

      await expect(
        startAcquire({ project: "/work/two", wait: false, path, env: {} }),
      ).rejects.toBeInstanceOf(RenderLockBusy);
      const second = startAcquire({ project: "/work/two", wait: true, path, env: {} }).then(
        (release) => ((heldBy = [...heldBy, "two"]), release),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(readFileSync(`${path}.break`, "utf8")).toBe(breakWhileReplacing);
      expect(heldBy).toEqual([]);

      resume();
      const releaseFirst = await first;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(heldBy).toEqual(["one"]);
      releaseFirst();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(heldBy).toEqual(["one", "two"]);
      (await second)();
    });
  });

  it.skipIf(process.platform === "win32")(
    "takes over a lock whose pid now belongs to a different process",
    async () => {
      mkdirSync(join(dir, "locks"), { recursive: true });
      const reused: RenderLockHolder = {
        pid: process.pid,
        command: "render",
        startedAt: 1,
        project: "/work/oom-killed",
        identity: "linux:1",
      };
      writeFileSync(path, JSON.stringify(reused));

      const release = await acquireRenderLock({
        project: "/work/next",
        wait: false,
        path,
        env: {},
      });

      expect(JSON.parse(readFileSync(path, "utf8")).project).toBe("/work/next");
      release();
    },
  );

  describe.skipIf(process.platform === "win32")("the lock folder", () => {
    it("is private to this account when it is the account's own", async () => {
      const release = await acquireRenderLock({ project: "/work/a", wait: false, path, env: {} });
      expect(statSync(join(dir, "locks")).mode & 0o7777).toBe(0o700);
      release();
    });

    it("named by HYPERFRAMES_RENDER_LOCK_DIR is writable by every account but sticky, and outside the cache", async () => {
      vi.stubEnv("HYPERFRAMES_CACHE_DIR", join(dir, "cache"));
      const shared = join(dir, "shared-locks");
      const env = { HYPERFRAMES_RENDER_LOCK_DIR: shared };
      try {
        const release = await acquireRenderLock({ project: "/work/a", wait: false, env });
        expect(statSync(shared).mode & 0o7777).toBe(0o1777);
        expect(existsSync(join(shared, "render.lock"))).toBe(true);
        expect(existsSync(join(dir, "cache"))).toBe(false);
        release();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("is made private again when an older release left it writable by every account", async () => {
      mkdirSync(join(dir, "locks"));
      chmodSync(join(dir, "locks"), 0o777);
      const release = await acquireRenderLock({ project: "/work/a", wait: false, path, env: {} });
      expect(statSync(join(dir, "locks")).mode & 0o7777).toBe(0o700);
      release();
    });

    it("named by HYPERFRAMES_RENDER_LOCK_DIR gets the sticky bit when it already exists without it", async () => {
      const shared = join(dir, "shared-locks");
      mkdirSync(shared);
      chmodSync(shared, 0o777);
      const env = { HYPERFRAMES_RENDER_LOCK_DIR: shared };
      const release = await acquireRenderLock({ project: "/work/a", wait: false, env });
      expect(statSync(shared).mode & 0o7777).toBe(0o1777);
      release();
    });

    it("named by HYPERFRAMES_RENDER_LOCK_DIR is refused when it is a link, and the folder it names is left as it was", async () => {
      const victim = join(dir, "private");
      mkdirSync(victim, { mode: 0o700 });
      const shared = join(dir, "planted");
      symlinkSync(victim, shared);
      const env = { HYPERFRAMES_RENDER_LOCK_DIR: shared };

      await expect(acquireRenderLock({ project: "/work/a", wait: false, env })).rejects.toThrow(
        `${shared} is not a folder that this account or root owns`,
      );
      expect(statSync(victim).mode & 0o7777).toBe(0o700);
      expect(readdirSync(victim)).toEqual([]);
    });

    it("named by HYPERFRAMES_RENDER_LOCK_DIR is refused when another account owns it", async () => {
      const shared = join(dir, "theirs");
      mkdirSync(shared);
      chmodSync(shared, 0o777);
      vi.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
      const env = { HYPERFRAMES_RENDER_LOCK_DIR: shared };

      await expect(acquireRenderLock({ project: "/work/a", wait: false, env })).rejects.toThrow(
        `${shared} is not a folder that this account or root owns`,
      );
      expect(statSync(shared).mode & 0o7777).toBe(0o777);
      expect(readdirSync(shared)).toEqual([]);
    });

    it("is refused when another account owns this account's own lock folder", async () => {
      mkdirSync(join(dir, "locks"));
      vi.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);

      await expect(
        acquireRenderLock({ project: "/work/a", wait: false, path, env: {} }),
      ).rejects.toThrow(`${join(dir, "locks")} is not a folder this account owns`);
    });

    it("says so when another account's stale lock cannot be removed from a sticky shared folder", async () => {
      const stale: RenderLockHolder = {
        pid: deadPid(),
        command: "render",
        startedAt: 1,
        project: "/work/other-account",
      };
      mkdirSync(join(dir, "locks"), { recursive: true });
      writeFileSync(path, JSON.stringify(stale));
      const sticky = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      vi.mocked(unlinkSync).mockImplementation((file) => {
        if (file === path) throw sticky;
        realUnlinkSync(file);
      });

      try {
        for (const wait of [false, true]) {
          await expect(
            startAcquire({ project: "/work/next", wait, path, env: {} }),
          ).rejects.toThrow(`A render of another account stopped and left ${path}`);
        }
      } finally {
        vi.mocked(unlinkSync).mockImplementation(realUnlinkSync);
      }
      expect(JSON.parse(readFileSync(path, "utf8")).project).toBe("/work/other-account");
    });

    it.skipIf(process.getuid?.() === 0)(
      "says how to fix a sticky shared lock folder this account cannot write in",
      async () => {
        const shared = join(dir, "read-only");
        mkdirSync(shared);
        chmodSync(shared, 0o1555);
        vi.mocked(fchmodSync).mockImplementation(() => {});
        try {
          await expect(
            acquireRenderLock({
              project: "/work/b",
              wait: false,
              env: { HYPERFRAMES_RENDER_LOCK_DIR: shared },
            }),
          ).rejects.toThrow("point HYPERFRAMES_RENDER_LOCK_DIR in each of them at one folder");
        } finally {
          vi.mocked(fchmodSync).mockImplementation(realFchmodSync);
          chmodSync(shared, 0o755);
        }
      },
    );
  });

  it("keeps the slot in this user's HyperFrames cache folder by default", async () => {
    vi.stubEnv("HYPERFRAMES_CACHE_DIR", join(dir, "shared"));
    try {
      const release = await acquireRenderLock({ project: "/work/brand", wait: false, env: {} });
      expect(existsSync(join(dir, "shared", "locks", "render.lock"))).toBe(true);
      release();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("a lock file that cannot be read yet", () => {
    /** A contender that opens the lock exclusively, then stalls before writing its holder. */
    const pausedAfterOpen = (gate: Promise<void>) => async (file: string, holder: Holder) => {
      const fd = openSync(file, "wx");
      await gate;
      writeFileSync(fd, JSON.stringify(holder));
      closeSync(fd);
      return true;
    };

    it("is not taken from a live contender paused between opening and writing it", async () => {
      vi.useFakeTimers({ now: Date.now() });
      let resume: () => void = () => {};
      const writerA = startAcquire({
        project: "/work/a",
        wait: false,
        path,
        env: {},
        claim: pausedAfterOpen(new Promise<void>((resolve) => (resume = resolve))),
      });
      let heldByB = false;
      const writerB = startAcquire({ project: "/work/b", wait: true, path, env: {} }).then(
        (release) => {
          heldByB = true;
          return release;
        },
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(heldByB).toBe(false);
      await expect(
        acquireRenderLock({ project: "/work/c", wait: false, path, env: {} }),
      ).rejects.toBeInstanceOf(RenderLockBusy);

      resume();
      const releaseA = await writerA;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(heldByB).toBe(false);
      releaseA();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(heldByB).toBe(true);
      (await writerB)();
    });

    it("is reclaimed when the contender that opened it died before writing", async () => {
      let crash: (reason: Error) => void = () => {};
      const died = new Promise<void>((_, reject) => (crash = reject));
      const writerA = startAcquire({
        project: "/work/a",
        wait: false,
        path,
        env: {},
        pid: deadPid(),
        // A dead process holds no handle, so the opened file is closed, as the OS would close it.
        claim: async (file) => {
          closeSync(openSync(file, "wx"));
          await died;
          return true;
        },
      });
      await vi.waitFor(() => expect(existsSync(path)).toBe(true));

      const release = await acquireRenderLock({ project: "/work/b", wait: false, path, env: {} });

      expect(readdirSync(join(dir, "locks")).filter((n) => n.includes(".owner-"))).toHaveLength(1);
      release();
      expect(readdirSync(join(dir, "locks"))).toEqual([]);
      crash(new Error("A is gone"));
      await expect(writerA).rejects.toThrow("A is gone");
    });

    it("is reclaimed when no contender is left at all", async () => {
      mkdirSync(join(dir, "locks"), { recursive: true });
      writeFileSync(path, '{"pid":');

      const release = await acquireRenderLock({
        project: "/work/next",
        wait: false,
        path,
        env: {},
      });

      release();
      expect(existsSync(path)).toBe(false);
    });
  });

  it("stops waiting, and stops marking itself a contender, when its signal aborts", async () => {
    vi.useFakeTimers();
    const release = await acquireRenderLock({ project: "/work/brand", wait: false, path, env: {} });
    const stop = new AbortController();
    const waiting = acquireRenderLock({
      project: "/work/crime",
      wait: true,
      path,
      env: {},
      signal: stop.signal,
    });
    await vi.advanceTimersByTimeAsync(3_000);

    stop.abort(new Error("cancelled"));
    await expect(waiting).rejects.toThrow("cancelled");
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readdirSync(join(dir, "locks"))).toEqual([]);
  });

  it("reads a file another handle holds (Windows EPERM/EBUSY) as held, not as a failure", async () => {
    const busy = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });

    await expect(
      acquireRenderLock({
        project: "/work/crime",
        wait: false,
        path,
        env: {},
        claim: () => {
          throw busy;
        },
      }),
    ).rejects.toBeInstanceOf(RenderLockBusy);
    expect(readdirSync(join(dir, "locks")).filter((n) => n.includes(".owner-"))).toEqual([]);
  });

  it("never starts PowerShell for a start-time lookup on Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    try {
      expect(startToken(process.pid)).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("lets renders run side by side with HYPERFRAMES_RENDER_LOCK=off", async () => {
    const env = { HYPERFRAMES_RENDER_LOCK: "off" };
    await acquireRenderLock({ project: "/work/brand", wait: false, path, env });

    await expect(
      acquireRenderLock({ project: "/work/crime", wait: false, path, env }),
    ).resolves.toBeTypeOf("function");
  });
});

describe("acquireRenderSlot", () => {
  it("fails the command under --no-wait and tells the person which render holds the slot", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const release = await acquireRenderLock({ project: "/work/brand", wait: false, path, env: {} });

    await expect(
      acquireRenderSlot(
        { project: { dir: "/work/crime" } as never, waitForRenderSlot: false },
        undefined,
        { path, env: {} },
      ),
    ).rejects.toMatchObject({ message: "Command failed", code: "render_locked" });

    const said = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(said).toContain("Another render is running for this user account");
    expect(said).toContain("Set HYPERFRAMES_RENDER_LOCK_DIR to one folder in every account");
    expect(said).not.toContain("HYPERFRAMES_CACHE_DIR");
    expect(said).toContain(`pid ${process.pid}, project /work/brand`);
    release();
  });

  it("says who it is waiting for while it waits", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const release = await acquireRenderLock({ project: "/work/brand", wait: false, path, env: {} });

    const stop = new AbortController();
    const slot = acquireRenderSlot(
      { project: { dir: "/work/crime" } as never, waitForRenderSlot: true },
      stop.signal,
      { path, env: {} },
    );
    stillWaiting.push({ stop, settled: slot.catch(() => undefined) });
    await vi.advanceTimersByTimeAsync(3_000);

    const said = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(said).toContain(
      `Waiting for another render to finish (pid ${process.pid}, project /work/brand`,
    );
    expect(said).toContain("one at a time per user account");
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    (await slot)();
  });
});
