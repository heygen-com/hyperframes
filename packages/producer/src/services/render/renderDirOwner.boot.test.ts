import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const machine = vi.hoisted(() => ({ uptimeSeconds: 5_000 }));

vi.mock("node:os", async (load) => {
  const os = await load<typeof import("node:os")>();
  return { ...os, uptime: () => machine.uptimeSeconds };
});

// A machine without /proc (macOS, Windows), where the owner stamp's boot is an estimate to the minute.
vi.mock("node:fs", async (load) => {
  const fs = await load<typeof import("node:fs")>();
  const noProc = (path: unknown) => {
    if (String(path).startsWith("/proc/"))
      throw Object.assign(new Error("no /proc"), { code: "ENOENT" });
  };
  return {
    ...fs,
    readFileSync: ((path: string, ...rest: never[]) => {
      noProc(path);
      return fs.readFileSync(path, ...rest);
    }) as typeof fs.readFileSync,
    readlinkSync: ((path: string, ...rest: never[]) => {
      noProc(path);
      return fs.readlinkSync(path, ...rest);
    }) as typeof fs.readlinkSync,
  };
});

const { createOwnedRenderDir, listAbandonedRenderDirs } = await import("./renderDirOwner.js");

const platform = process.platform;
const MINUTE = 60_000;
// Boot estimate = now - uptime, in minutes; uptime ticks in whole seconds, so it moves with the clock.
const at = (bootMinutes: number) => vi.setSystemTime(bootMinutes * MINUTE + 5_000 * 1000);
let parent: string;

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.useFakeTimers({ toFake: ["Date"] });
  parent = mkdtempSync(join(tmpdir(), "hf-render-owner-boot-"));
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.useRealTimers();
  rmSync(parent, { recursive: true, force: true });
});

function deadRenderDir(): string {
  const dir = createOwnedRenderDir(join(parent, "hf-render-"));
  const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf-8"));
  owner.pid = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(join(dir, "owner.json"), JSON.stringify(owner));
  return dir;
}

// fails without the fix: the estimate stamped 1000 and read back 1001, so the dead render's dir was kept forever.
it("reclaims a dead render's dir when the boot estimate rounds the other way at the next look", () => {
  at(1000.49998);
  const dir = deadRenderDir();
  at(1000.50002);
  expect(listAbandonedRenderDirs(parent)).toEqual([dir]);
});

it("keeps a dead owner's dir from another boot, minutes apart", () => {
  at(1000.2);
  deadRenderDir();
  at(1003.2);
  expect(listAbandonedRenderDirs(parent)).toEqual([]);
});
