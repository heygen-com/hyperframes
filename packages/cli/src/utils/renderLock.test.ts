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

  describe.skipIf(process.platform === "win32")("a cache folder shared by accounts", () => {
    it("creates its locks folder writable for every account", async () => {
      const release = await acquireRenderLock({ project: "/work/a", wait: false, path, env: {} });
      expect(statSync(join(dir, "locks")).mode & 0o777).toBe(0o777);
      release();
    });

    it.skipIf(process.getuid?.() === 0)(
      "says how to fix a locks folder this account cannot write in",
      async () => {
        mkdirSync(join(dir, "locks"), { mode: 0o755 });
        chmodSync(join(dir, "locks"), 0o555);
        try {
          await expect(
            acquireRenderLock({ project: "/work/b", wait: false, path, env: {} }),
          ).rejects.toThrow(`chmod 777 ${join(dir, "locks")}`);
        } finally {
          chmodSync(join(dir, "locks"), 0o755);
        }
      },
    );
  });

  it("keeps the slot in this user's HyperFrames cache folder, which HYPERFRAMES_CACHE_DIR can share", async () => {
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
    ).rejects.toThrow("Command failed");

    const said = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(said).toContain("Another render is running for this user account");
    expect(said).toContain("HYPERFRAMES_CACHE_DIR to a shared folder");
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
