import { afterEach, describe, it, expect, vi } from "vitest";
import { parseCgroupCpuLimit } from "./systemCpu.js";

const CGROUP_V2_CPU_MAX_PATH = "/sys/fs/cgroup/cpu.max";
const CGROUP_V1_CPU_QUOTA_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us";
const CGROUP_V1_CPU_PERIOD_PATH = "/sys/fs/cgroup/cpu/cpu.cfs_period_us";

type SystemCpuModule = typeof import("./systemCpu.js");

type MockSystemCpuOptions = {
  files?: Record<string, string>;
  hostCpus?: number;
  platform?: NodeJS.Platform;
  readErrors?: Record<string, NodeJS.ErrnoException>;
  onRead?: (path: string) => void;
};

async function withSystemCpuMocks(
  options: MockSystemCpuOptions,
  run: (systemCpu: SystemCpuModule) => void | Promise<void>,
): Promise<void> {
  const { files = {}, hostCpus = 32, platform = "linux", readErrors = {}, onRead } = options;
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });

  vi.resetModules();
  vi.doMock("os", () => ({ availableParallelism: () => hostCpus }));
  vi.doMock("fs", () => ({
    readFileSync: (path: string) => {
      onRead?.(path);
      if (path in readErrors) throw readErrors[path];
      if (path in files) return files[path];
      throw Object.assign(new Error("missing cgroup file"), { code: "ENOENT" });
    },
  }));

  try {
    const systemCpu = await import("./systemCpu.js");
    systemCpu._resetCgroupCpuLimitCacheForTests();
    await run(systemCpu);
  } finally {
    vi.doUnmock("fs");
    vi.doUnmock("os");
    vi.resetModules();
    if (descriptor) Object.defineProperty(process, "platform", descriptor);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCgroupCpuLimit", () => {
  it("parses cgroup v2 quota and period into cores", () => {
    expect(parseCgroupCpuLimit("600000 100000\n", null, null)).toBe(6);
    expect(parseCgroupCpuLimit("150000 100000", null, null)).toBe(1.5);
  });

  it('treats cgroup v2 "max" as unlimited', () => {
    expect(parseCgroupCpuLimit("max 100000", null, null)).toBeNull();
  });

  it("parses cgroup v1 quota/period and treats -1 as unlimited", () => {
    expect(parseCgroupCpuLimit(null, "350000\n", "100000\n")).toBe(3.5);
    expect(parseCgroupCpuLimit(null, "-1", "100000")).toBeNull();
  });

  it("ignores absent and malformed limits", () => {
    expect(parseCgroupCpuLimit(null, null, null)).toBeNull();
    expect(parseCgroupCpuLimit(null, "200000", null)).toBeNull();
    for (const content of ["", "garbage", "0 100000", "600000 0"]) {
      expect(parseCgroupCpuLimit(content, null, null)).toBeNull();
    }
  });
});

describe("getUsableCpuCount", () => {
  it("caps the host count at a cgroup v2 quota (6-core pod on a 32-vCPU node)", async () => {
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "600000 100000" } },
      ({ getUsableCpuCount }) => {
        expect(getUsableCpuCount()).toBe(6);
      },
    );
  });

  it("honours a cgroup v1 quota when v2 is absent", async () => {
    await withSystemCpuMocks(
      {
        files: { [CGROUP_V1_CPU_QUOTA_PATH]: "200000", [CGROUP_V1_CPU_PERIOD_PATH]: "100000" },
      },
      ({ getUsableCpuCount }) => {
        expect(getUsableCpuCount()).toBe(2);
      },
    );
  });

  it("floors fractional quotas and never returns less than one core", async () => {
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "350000 100000" } },
      ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(3),
    );
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "50000 100000" } },
      ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(1),
    );
  });

  it("uses the host count when unlimited, absent, or larger than the host", async () => {
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "max 100000" } },
      ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(32),
    );
    await withSystemCpuMocks({}, ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(32));
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "6400000 100000" }, hostCpus: 8 },
      ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(8),
    );
  });

  it("reads the cgroup once and logs the limit on stderr only", async () => {
    const reads: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withSystemCpuMocks(
      { files: { [CGROUP_V2_CPU_MAX_PATH]: "600000 100000" }, onRead: (p) => reads.push(p) },
      ({ getUsableCpuCount }) => {
        expect(getUsableCpuCount()).toBe(6);
        expect(getUsableCpuCount()).toBe(6);
        expect(reads).toEqual([CGROUP_V2_CPU_MAX_PATH]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("[SystemCpu] cgroup CPU limit detected: 6 cores");
        expect(log).not.toHaveBeenCalled();
      },
    );
  });

  it("warns once and uses the host count when a cgroup file is unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withSystemCpuMocks(
      {
        readErrors: {
          [CGROUP_V2_CPU_MAX_PATH]: Object.assign(new Error("permission denied"), {
            code: "EACCES",
          }),
        },
      },
      ({ getUsableCpuCount }) => {
        expect(getUsableCpuCount()).toBe(32);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("EACCES");
      },
    );
  });

  it("does not read cgroup files on non-Linux platforms", async () => {
    await withSystemCpuMocks(
      {
        platform: "darwin",
        files: { [CGROUP_V2_CPU_MAX_PATH]: "100000 100000" },
        onRead: (p) => {
          throw new Error(`/sys read should not happen: ${p}`);
        },
      },
      ({ getUsableCpuCount }) => expect(getUsableCpuCount()).toBe(32),
    );
  });
});
