import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ uptime: false, pidns: false }));

// An agent's macOS seatbelt refuses uptime: "uv_uptime returned EPERM (operation not permitted)".
vi.mock("node:os", async (actual) => {
  const os = await actual<typeof import("node:os")>();
  return {
    ...os,
    uptime: () => {
      if (probes.uptime) return os.uptime();
      throw Object.assign(new Error("A system error occurred: uv_uptime returned EPERM"), {
        code: "ERR_SYSTEM_ERROR",
      });
    },
  };
});

// Without /proc, as on macOS, so Linux CI takes the uptime path too.
vi.mock("node:fs", async (actual) => {
  const fs = await actual<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: ((path: string, ...rest: unknown[]) => {
      if (path === "/proc/sys/kernel/random/boot_id")
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
    readlinkSync: ((path: string, ...rest: unknown[]) => {
      if (path === "/proc/self/ns/pid" && !probes.pidns)
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return (fs.readlinkSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readlinkSync,
  };
});

const { createOwnedRenderDir, createRenderWorkDir } = await import("./renderDirOwner.js");

const JOB = "0f8c2b1e-5d3a-4c7b-9e21-6a4f0d8b3c19";
const platform = process.platform;

describe("a render work dir where the system refuses uptime", () => {
  let parent: string;
  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
  const plant = (name: string, owner: object): string => {
    mkdirSync(join(parent, name));
    writeFileSync(join(parent, name, "owner.json"), JSON.stringify(owner));
    return name;
  };
  const ownStamp = () => {
    const own = createOwnedRenderDir(join(parent, "self-"));
    const stamp = JSON.parse(readFileSync(join(own, "owner.json"), "utf-8"));
    rmSync(own, { recursive: true });
    return stamp;
  };

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "hf-render-dir-sandbox-"));
    probes.uptime = false;
    probes.pidns = false;
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    rmSync(parent, { recursive: true, force: true });
  });

  it("is still created and stamped with its owner", () => {
    const dir = createRenderWorkDir(join(parent, "work-"), parent);
    const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf-8"));
    expect(owner.pid).toBe(process.pid);
  });

  it("keeps another same-hostname machine's dir when neither boot nor pid namespace can be read", () => {
    // Machine A's live render on a shared output dir; its pid does not exist here on machine B.
    const other = plant(`work-${JOB}-Aa0000`, { pid: deadPid(), host: hostname() });

    const created = basename(createRenderWorkDir(join(parent, `work-${JOB}-`), parent));

    expect(readdirSync(parent).sort()).toEqual([other, created].sort());
  });

  it("on Linux, keeps it when only the pid namespace cannot be read", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    probes.uptime = true;
    const other = plant(`work-${JOB}-Bb0000`, { ...ownStamp(), pid: deadPid() });

    const created = basename(createRenderWorkDir(join(parent, `work-${JOB}-`), parent));

    expect(readdirSync(parent).sort()).toEqual([other, created].sort());
  });

  it("on macOS, where there is no pid namespace, still reclaims a dead render's dir by boot time", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    probes.uptime = true;
    plant(`work-${JOB}-Cc0000`, { ...ownStamp(), pid: deadPid() });

    const created = basename(createRenderWorkDir(join(parent, `work-${JOB}-`), parent));

    expect(readdirSync(parent)).toEqual([created]);
  });
});
