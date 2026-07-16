import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  _resetCgroupLimitCacheForTests,
  isLowMemorySystem,
  LOW_MEMORY_TOTAL_MB_THRESHOLD,
  parseCgroupLimitMb,
} from "./systemMemory.js";

const BYTES_PER_MIB = 1024 * 1024;
const CGROUP_V2_MEMORY_MAX_PATH = "/sys/fs/cgroup/memory.max";
const CGROUP_V1_MEMORY_LIMIT_PATH = "/sys/fs/cgroup/memory/memory.limit_in_bytes";

type SystemMemoryModule = typeof import("./systemMemory.js");

type MockSystemMemoryOptions = {
  files?: Record<string, string>;
  hostTotalMb?: number;
  platform?: NodeJS.Platform;
  readErrors?: Record<string, NodeJS.ErrnoException>;
  onRead?: (path: string) => void;
  throwOnFileRead?: boolean;
};

function stubPlatform(platform: NodeJS.Platform): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });

  return () => {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor);
    }
  };
}

async function withSystemMemoryMocks(
  options: MockSystemMemoryOptions,
  run: (systemMemory: SystemMemoryModule) => void | Promise<void>,
): Promise<void> {
  const {
    files = {},
    hostTotalMb = 32768,
    platform = "linux",
    readErrors = {},
    onRead,
    throwOnFileRead = false,
  } = options;
  const restorePlatform = stubPlatform(platform);

  vi.resetModules();
  vi.doMock("os", () => ({
    totalmem: () => hostTotalMb * BYTES_PER_MIB,
  }));
  vi.doMock("fs", () => ({
    readFileSync: (path: string) => {
      onRead?.(path);

      if (throwOnFileRead) {
        throw new Error(`/sys read should not happen: ${path}`);
      }

      if (path in readErrors) {
        throw readErrors[path];
      }

      if (path in files) {
        return files[path];
      }

      throw Object.assign(new Error("missing cgroup file"), { code: "ENOENT" });
    },
  }));

  try {
    const systemMemory = await import("./systemMemory.js");
    systemMemory._resetCgroupLimitCacheForTests();
    await run(systemMemory);
  } finally {
    vi.doUnmock("fs");
    vi.doUnmock("os");
    vi.resetModules();
    restorePlatform();
  }
}

beforeEach(() => {
  _resetCgroupLimitCacheForTests();
});

afterEach(() => {
  _resetCgroupLimitCacheForTests();
  vi.restoreAllMocks();
});

describe("isLowMemorySystem", () => {
  it("treats sub-threshold RAM as low-memory", () => {
    expect(isLowMemorySystem(4096)).toBe(true);
    expect(isLowMemorySystem(6000)).toBe(true);
    expect(isLowMemorySystem(7600)).toBe(true);
  });

  it("includes machines reporting exactly the threshold (8 GB boundary)", () => {
    // Real "8 GB" hosts report at/just under 8192 MiB after firmware/iGPU
    // reservations — the inclusive bound is the whole point (issue #1219).
    expect(isLowMemorySystem(LOW_MEMORY_TOTAL_MB_THRESHOLD)).toBe(true);
    expect(isLowMemorySystem(8192)).toBe(true);
  });

  it("treats above-threshold RAM as normal", () => {
    expect(isLowMemorySystem(8193)).toBe(false);
    expect(isLowMemorySystem(16384)).toBe(false);
    expect(isLowMemorySystem(65536)).toBe(false);
  });

  it("treats a 4 GiB cgroup v2 limit on a 32 GiB host as low-memory", async () => {
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V2_MEMORY_MAX_PATH]: `${4096 * BYTES_PER_MIB}`,
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(4096);
        expect(isLowMemorySystem()).toBe(true);
      },
    );
  });
});

describe("parseCgroupLimitMb", () => {
  it("parses cgroup v2 numeric limits", () => {
    expect(parseCgroupLimitMb(`${4096 * BYTES_PER_MIB}`, null)).toBe(4096);
  });

  it('ignores cgroup v2 "max" limits', () => {
    expect(parseCgroupLimitMb("max", null)).toBeNull();
  });

  it("parses cgroup v1 numeric limits and ignores no-limit sentinels", () => {
    expect(parseCgroupLimitMb(null, `${6144 * BYTES_PER_MIB}`)).toBe(6144);
    expect(parseCgroupLimitMb(null, "9223372036854771712")).toBeNull();
  });

  it("ignores absent and malformed limits", () => {
    expect(parseCgroupLimitMb(null, null)).toBeNull();

    for (const content of ["", "garbage", "-1", "0"]) {
      expect(parseCgroupLimitMb(content, null)).toBeNull();
      expect(parseCgroupLimitMb(null, content)).toBeNull();
    }
  });

  it("uses cgroup v2 when both v2 and v1 contents are present", () => {
    expect(parseCgroupLimitMb(`${4096 * BYTES_PER_MIB}`, `${2048 * BYTES_PER_MIB}`)).toBe(4096);
  });
});

describe("getSystemTotalMb", () => {
  it("caches cgroup probes until the test reset hook clears the cache", async () => {
    const readCalls: string[] = [];
    const files = {
      [CGROUP_V2_MEMORY_MAX_PATH]: `${4096 * BYTES_PER_MIB}`,
    };

    await withSystemMemoryMocks(
      {
        files,
        onRead: (path) => readCalls.push(path),
      },
      ({ _resetCgroupLimitCacheForTests, getSystemTotalMb }) => {
        expect(getSystemTotalMb()).toBe(4096);
        expect(getSystemTotalMb()).toBe(4096);
        expect(readCalls).toEqual([CGROUP_V2_MEMORY_MAX_PATH]);

        files[CGROUP_V2_MEMORY_MAX_PATH] = `${2048 * BYTES_PER_MIB}`;
        _resetCgroupLimitCacheForTests();

        expect(getSystemTotalMb()).toBe(2048);
        expect(readCalls).toEqual([CGROUP_V2_MEMORY_MAX_PATH, CGROUP_V2_MEMORY_MAX_PATH]);
      },
    );
  });

  it('uses the host total when cgroup v2 reports "max"', async () => {
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V2_MEMORY_MAX_PATH]: "max",
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(32768);
        expect(isLowMemorySystem()).toBe(false);
      },
    );
  });

  it("honors cgroup v1 numeric limits when cgroup v2 is absent", async () => {
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V1_MEMORY_LIMIT_PATH]: `${6144 * BYTES_PER_MIB}`,
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(6144);
        expect(isLowMemorySystem()).toBe(true);
      },
    );
  });

  it("uses the host total when cgroup v1 reports a no-limit sentinel", async () => {
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V1_MEMORY_LIMIT_PATH]: "9223372036854771712",
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(32768);
        expect(isLowMemorySystem()).toBe(false);
      },
    );
  });

  it("uses the host total when cgroup files are absent", async () => {
    await withSystemMemoryMocks({}, ({ getSystemTotalMb, isLowMemorySystem }) => {
      expect(getSystemTotalMb()).toBe(32768);
      expect(isLowMemorySystem()).toBe(false);
    });
  });

  it("warns once and uses the host total when a cgroup file is unreadable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withSystemMemoryMocks(
      {
        readErrors: {
          [CGROUP_V2_MEMORY_MAX_PATH]: Object.assign(new Error("permission denied"), {
            code: "EACCES",
          }),
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(32768);
        expect(getSystemTotalMb()).toBe(32768);
        expect(isLowMemorySystem()).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain(
          "[SystemMemory] Unable to read cgroup memory limit",
        );
        expect(warn.mock.calls[0]?.[0]).toContain("EACCES");
      },
    );
  });

  it("logs the cgroup-limit notice to stderr, not stdout (keeps --json output clean)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V2_MEMORY_MAX_PATH]: `${4096 * BYTES_PER_MIB}`,
        },
      },
      ({ getSystemTotalMb }) => {
        expect(getSystemTotalMb()).toBe(4096);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("[SystemMemory] cgroup memory limit detected");
        // stdout must stay clean so `check --json` output is machine-parseable.
        expect(info).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
      },
    );
  });

  it("stays silent when cgroup files are absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withSystemMemoryMocks({}, ({ getSystemTotalMb }) => {
      expect(getSystemTotalMb()).toBe(32768);
      expect(getSystemTotalMb()).toBe(32768);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it.each(["", "garbage", "-1", "0"])(
    "uses the host total for malformed cgroup v2 content %j",
    async (content) => {
      await withSystemMemoryMocks(
        {
          files: {
            [CGROUP_V2_MEMORY_MAX_PATH]: content,
          },
        },
        ({ getSystemTotalMb, isLowMemorySystem }) => {
          expect(getSystemTotalMb()).toBe(32768);
          expect(isLowMemorySystem()).toBe(false);
        },
      );
    },
  );

  it.each(["", "garbage", "-1", "0"])(
    "uses the host total for malformed cgroup v1 content %j",
    async (content) => {
      await withSystemMemoryMocks(
        {
          files: {
            [CGROUP_V1_MEMORY_LIMIT_PATH]: content,
          },
        },
        ({ getSystemTotalMb, isLowMemorySystem }) => {
          expect(getSystemTotalMb()).toBe(32768);
          expect(isLowMemorySystem()).toBe(false);
        },
      );
    },
  );

  it("uses the host total when a cgroup limit is larger than host RAM", async () => {
    await withSystemMemoryMocks(
      {
        files: {
          [CGROUP_V2_MEMORY_MAX_PATH]: `${65536 * BYTES_PER_MIB}`,
        },
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(32768);
        expect(isLowMemorySystem()).toBe(false);
      },
    );
  });

  it("does not read cgroup files on non-Linux platforms", async () => {
    await withSystemMemoryMocks(
      {
        platform: "darwin",
        throwOnFileRead: true,
      },
      ({ getSystemTotalMb, isLowMemorySystem }) => {
        expect(getSystemTotalMb()).toBe(32768);
        expect(isLowMemorySystem()).toBe(false);
      },
    );
  });
});
