import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:os", async (load) => {
  const os = await load<typeof import("node:os")>();
  return { ...os, uptime: () => 5_000 };
});

// A Mac: no /proc, so the owner stamp's boot is an estimate and the machine is named by its platform UUID.
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
const tools = vi.hoisted(() => ({ ran: [] as string[] }));
vi.mock("node:child_process", async (load) => {
  const cp = await load<typeof import("node:child_process")>();
  const ioreg =
    '+-o J316sAP  <class IOPlatformExpertDevice>\n    "IOPlatformUUID" = "11111111-2222-3333-4444-555555555555"\n';
  return {
    ...cp,
    execFileSync: ((file: string, ...rest: never[]) => {
      tools.ran.push(file);
      if (file === "/usr/sbin/ioreg") return ioreg;
      if (/reg\.exe$/i.test(file)) return "    MachineGuid    REG_SZ    aaaa-bbbb\r\n";
      return cp.execFileSync(file, ...rest);
    }) as typeof cp.execFileSync,
  };
});

const { createOwnedRenderDir, listAbandonedRenderDirs } = await import("./renderDirOwner.js");

const platform = process.platform;
const MINUTE = 60_000;
// Boot estimate = now - uptime; uptime ticks in whole seconds, so the estimate moves with the clock.
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

function deadRenderDir(stamp: Record<string, unknown> = {}): string {
  const dir = createOwnedRenderDir(join(parent, "hf-render-"));
  const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf-8"));
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ ...owner, pid: dead, ...stamp }));
  return dir;
}

// fails without the fix: the minute estimate stamped 1000 and read 1001 back, so the dead render's dir stayed.
it("reclaims a dead render's dir when the boot estimate rounds the other way at the next look", () => {
  at(1000.49998);
  const dir = deadRenderDir();
  at(1000.50002);
  expect(listAbandonedRenderDirs(parent)).toEqual([dir]);
});

it("reclaims a dead render's dir across the uptime's whole-second tick", () => {
  at(1000.2);
  const dir = deadRenderDir();
  vi.setSystemTime(Date.now() + 999);
  expect(listAbandonedRenderDirs(parent)).toEqual([dir]);
});

// fails without the fix (the previous head): another Mac of the same name on a shared folder, booted a minute away,
// counted as this one, so its live render's dir was listed as abandoned.
it.each([
  ["a boot a minute apart", () => at(1001.2), {}],
  [
    "another machine with the same name and boot",
    () => {},
    { machine: "99999999-8888-7777-6666-555555555555" },
  ],
  ["an older stamp that names no machine", () => {}, { machine: undefined, boot: "1000" }],
])("keeps a dead owner's dir from %s", (_, later, stamp) => {
  at(1000.2);
  deadRenderDir(stamp);
  later();
  expect(listAbandonedRenderDirs(parent)).toEqual([]);
});

// fails without the fix: the tools ran by bare name, which Windows can resolve from the project folder, and a
// root on the current drive (\\Windows) passed as a system path.
it.each([
  ["darwin", undefined, ["/usr/sbin/ioreg"]],
  ["win32", "C:\\Windows", ["C:\\Windows\\System32\\reg.exe"]],
  ["win32", "Windows", []],
  ["win32", "\\Windows", []],
])("asks %s's own tool by its absolute path (system root %s)", async (os, systemRoot, expected) => {
  Object.defineProperty(process, "platform", { value: os });
  vi.stubEnv("SystemRoot", systemRoot);
  tools.ran.length = 0;
  vi.resetModules();
  const fresh = await import("./renderDirOwner.js");
  fresh.createOwnedRenderDir(join(parent, `hf-render-${os}-`));
  vi.unstubAllEnvs();
  expect(tools.ran).toEqual(expected);
});
