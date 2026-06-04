import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAvailableMemoryMb", () => {
  it("parses vm_stat on macOS to compute available memory", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "darwin",
      freemem: () => 100 * 1024 * 1024,
    }));
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
      execSync: (_cmd: string) =>
        [
          "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
          "Pages free:                             5000.",
          "Pages active:                         200000.",
          "Pages inactive:                       100000.",
          "Pages speculative:                      2000.",
          "Pages throttled:                           0.",
          "Pages wired down:                     150000.",
          "Pages purgeable:                        3000.",
        ].join("\n"),
    }));

    const { getAvailableMemoryMb } = await import("./system.js");
    const result = getAvailableMemoryMb();

    // (5000 + 100000 + 3000 + 2000) * 16384 = 110000 * 16384 = 1,802,240,000 bytes
    // 1,802,240,000 / (1024 * 1024) = ~1718 MB
    expect(result).toBe(Math.trunc((110000 * 16384) / (1024 * 1024)));
  });

  it("falls back to freemem on macOS when vm_stat fails", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "darwin",
      freemem: () => 4 * 1024 * 1024 * 1024,
    }));
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
      execSync: () => {
        throw new Error("vm_stat not found");
      },
    }));

    const { getAvailableMemoryMb } = await import("./system.js");
    expect(getAvailableMemoryMb()).toBe(4096);
  });

  it("reads MemAvailable from /proc/meminfo on Linux", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "linux",
      freemem: () => 100 * 1024 * 1024,
    }));
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
      readFileSync: (path: string, _enc: string) => {
        if (path === "/proc/meminfo") {
          return [
            "MemTotal:       16384000 kB",
            "MemFree:          512000 kB",
            "MemAvailable:    8192000 kB",
            "Buffers:          256000 kB",
          ].join("\n");
        }
        throw new Error(`unexpected path: ${path}`);
      },
    }));

    const { getAvailableMemoryMb } = await import("./system.js");
    // 8192000 kB / 1024 = 8000 MB
    expect(getAvailableMemoryMb()).toBe(8000);
  });

  it("falls back to freemem on Linux when /proc/meminfo is unreadable", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "linux",
      freemem: () => 2 * 1024 * 1024 * 1024,
    }));
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
      readFileSync: (path: string) => {
        if (path === "/proc/meminfo") throw new Error("ENOENT");
        throw new Error(`unexpected path: ${path}`);
      },
    }));

    const { getAvailableMemoryMb } = await import("./system.js");
    expect(getAvailableMemoryMb()).toBe(2048);
  });

  it("falls back to freemem on unsupported platforms", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "win32",
      freemem: () => 6 * 1024 * 1024 * 1024,
    }));

    const { getAvailableMemoryMb } = await import("./system.js");
    expect(getAvailableMemoryMb()).toBe(6144);
  });
});
