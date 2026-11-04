import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRenderLock, RenderLockBusy, type RenderLockHolder } from "./renderLock.js";
import type { Holder } from "./projectLock.js";
import { acquireRenderSlot } from "../commands/render/renderSlot.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-render-lock-"));
  path = join(dir, "locks", "render.lock");
});

afterEach(() => {
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
    const second = acquireRenderLock({
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

  it("takes over when the render that was taking over a dead slot died too", async () => {
    const dead = (project: string): RenderLockHolder => ({
      pid: deadPid(),
      command: "render",
      startedAt: 1,
      project,
    });
    await acquireRenderLock({ project: "/work/seed", wait: false, path, env: {} }).then((r) => r());
    writeFileSync(path, JSON.stringify(dead("/work/killed")));
    writeFileSync(`${path}.break`, JSON.stringify(dead("/work/breaker")));

    const release = await acquireRenderLock({ project: "/work/next", wait: false, path, env: {} });

    release();
    expect(existsSync(`${path}.break`)).toBe(false);
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
      closeSync(openSync(file, "wx"));
      await gate;
      writeFileSync(file, JSON.stringify(holder));
      return true;
    };

    it("is not taken from a live contender paused between opening and writing it", async () => {
      vi.useFakeTimers({ now: Date.now() });
      let resume: () => void = () => {};
      const writerA = acquireRenderLock({
        project: "/work/a",
        wait: false,
        path,
        env: {},
        claim: pausedAfterOpen(new Promise<void>((resolve) => (resume = resolve))),
      });
      let heldByB = false;
      const writerB = acquireRenderLock({ project: "/work/b", wait: true, path, env: {} }).then(
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
      void acquireRenderLock({
        project: "/work/a",
        wait: false,
        path,
        env: {},
        pid: deadPid(),
        claim: pausedAfterOpen(new Promise<void>(() => {})),
      });
      await vi.waitFor(() => expect(existsSync(path)).toBe(true));

      const release = await acquireRenderLock({ project: "/work/b", wait: false, path, env: {} });

      expect(readdirSync(join(dir, "locks")).filter((n) => n.includes(".owner-"))).toHaveLength(1);
      release();
      expect(readdirSync(join(dir, "locks"))).toEqual([]);
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

    it("reclaims a half-written takeover file next to a dead holder", async () => {
      const killed: RenderLockHolder = {
        pid: deadPid(),
        command: "render",
        startedAt: 1,
        project: "/work/killed",
      };
      mkdirSync(join(dir, "locks"), { recursive: true });
      writeFileSync(path, JSON.stringify(killed));
      writeFileSync(`${path}.break`, '{"pid":');

      const release = await acquireRenderLock({
        project: "/work/next",
        wait: false,
        path,
        env: {},
      });

      release();
      expect(existsSync(`${path}.break`)).toBe(false);
    });
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

    const slot = acquireRenderSlot(
      { project: { dir: "/work/crime" } as never, waitForRenderSlot: true },
      undefined,
      { path, env: {} },
    );
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
