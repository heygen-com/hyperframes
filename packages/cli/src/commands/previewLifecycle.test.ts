import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ActiveServer } from "../server/portUtils.js";
import {
  buildBackgroundPreviewArgs,
  listBackgroundPreviewStatuses,
  previewSessionPath,
  readBackgroundPreviewStatus,
  startBackgroundPreview,
  stopBackgroundPreview,
  writePreviewSession,
} from "./previewLifecycle.js";

const projectDir = resolve("/tmp/hyperframes-preview-lifecycle-project");
const server: ActiveServer = {
  port: 3210,
  projectName: "preview-lifecycle-project",
  projectDir,
  version: "test",
  pid: "4321",
};

function savePreviewSession(stateHome: string): void {
  writePreviewSession(
    { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
    stateHome,
  );
}

async function expectStaleSessionRemoved(stateHome: string): Promise<void> {
  const status = await readBackgroundPreviewStatus(projectDir, 3002, {
    scan: async () => [],
    stateHome,
  });

  expect(status).toBeNull();
  expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
}

describe("background preview lifecycle", () => {
  it("keeps case-distinct project paths separate on case-sensitive platforms", () => {
    if (process.platform === "win32") return;
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));

    expect(previewSessionPath("/tmp/Project", stateHome)).not.toBe(
      previewSessionPath("/tmp/project", stateHome),
    );
  });

  it("does not let the detached child inherit launcher-only flags", () => {
    expect(
      buildBackgroundPreviewArgs([
        "/opt/hyperframes/cli.js",
        "preview",
        projectDir,
        "--background",
        "--open",
      ]),
    ).toEqual(["/opt/hyperframes/cli.js", "preview", projectDir, "--no-open"]);
  });

  it("reuses an already-running server for the same project", async () => {
    const spawn = vi.fn();
    const scan = vi.fn(async () => [server]);

    const result = await startBackgroundPreview(projectDir, 3002, {
      argv: ["/opt/hyperframes/cli.js", "preview", projectDir, "--background"],
      execPath: "/usr/bin/node",
      scan,
      spawn,
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
    });

    expect(result).toMatchObject({ type: "reused", port: 3210 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses a saved managed preview on a custom port without repeating --port", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, port: 41402, projectDir, logPath: "/tmp/custom.log" },
      stateHome,
    );
    const customServer = { ...server, port: 41402, browserGpuMode: "software" as const };
    const scan = vi.fn(async (startPort?: number) => (startPort === 41402 ? [customServer] : []));
    const spawn = vi.fn();

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan,
      spawn,
      stateHome,
    });

    expect(result).toMatchObject({ type: "reused", port: 41402, pid: 4321 });
    expect(scan).toHaveBeenCalledWith(41402);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("discovers managed previews outside the default port scan and removes stale records", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const otherProjectDir = resolve("/tmp/hyperframes-preview-managed-custom-port");
    const staleProjectDir = resolve("/tmp/hyperframes-preview-managed-stale");
    writePreviewSession(
      {
        pid: 8765,
        port: 41402,
        projectDir: otherProjectDir,
        logPath: "/tmp/custom.log",
      },
      stateHome,
    );
    writePreviewSession(
      {
        pid: 9999,
        port: 45000,
        projectDir: staleProjectDir,
        logPath: "/tmp/stale.log",
      },
      stateHome,
    );

    const statuses = await listBackgroundPreviewStatuses({
      stateHome,
      scan: async (startPort) =>
        startPort === 41402
          ? [
              {
                port: 41402,
                projectName: "managed-custom-port",
                projectDir: otherProjectDir,
                version: "test",
                pid: "8765",
              },
            ]
          : [],
    });

    expect(statuses).toEqual([
      {
        pid: 8765,
        port: 41402,
        projectDir: otherProjectDir,
        logPath: "/tmp/custom.log",
      },
    ]);
    expect(existsSync(previewSessionPath(staleProjectDir, stateHome))).toBe(false);
  });

  it("force-new waits for a different server instead of reusing the existing one", async () => {
    const replacement = { ...server, port: 3211, pid: "5432" };
    let scans = 0;
    const scan = vi.fn(async () => (++scans < 3 ? [server] : [server, replacement]));
    const spawn = vi.fn(() => ({ pid: 5432, unref: vi.fn() }));

    const result = await startBackgroundPreview(projectDir, 3002, {
      forceNew: true,
      scan,
      spawn,
      sleep: async () => {},
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
    });

    expect(result).toMatchObject({ type: "started", port: 3211, pid: 5432 });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it.each([
    ["force-new", true],
    ["a GPU-policy change", false],
  ])(
    "%s replaces a previously managed server instead of orphaning it",
    async (_label, forceNew) => {
      const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
      const oldServer = { ...server, port: 41490, browserGpuMode: "hardware" as const };
      writePreviewSession(
        { pid: 4321, port: 41490, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      const replacement = {
        ...server,
        port: 41491,
        pid: "5432",
        browserGpuMode: "software" as const,
      };
      let oldRunning = true;
      let replacementRunning = false;
      const scan = vi.fn(async () =>
        oldRunning ? [oldServer] : replacementRunning ? [replacement] : [],
      );
      const kill = vi.fn((pid: number) => {
        if (pid === 4321) oldRunning = false;
      });
      const spawn = vi.fn(() => {
        replacementRunning = true;
        return { pid: 5432, unref: vi.fn() };
      });

      const result = await startBackgroundPreview(projectDir, 41491, {
        browserGpuMode: "software",
        forceNew,
        kill,
        scan,
        sleep: async () => {},
        spawn,
        stateHome,
      });

      expect(scan).toHaveBeenNthCalledWith(1, 41490);
      expect(kill).toHaveBeenCalledWith(4321);
      expect(result).toMatchObject({ type: "started", port: 41491, pid: 5432 });
      expect(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")).toContain(
        '"port": 41491',
      );
    },
  );

  it("replaces the owned preview instead of reusing an unmanaged policy-matching sibling", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 41490, browserGpuMode: "hardware" as const };
    const sibling = {
      ...server,
      port: 41491,
      pid: "8765",
      browserGpuMode: "software" as const,
    };
    const replacement = {
      ...server,
      port: 41492,
      pid: "5432",
      browserGpuMode: "software" as const,
    };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let ownedRunning = true;
    let replacementRunning = false;
    const scan = vi.fn(async () => [
      ...(ownedRunning ? [owned] : []),
      sibling,
      ...(replacementRunning ? [replacement] : []),
    ]);
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) ownedRunning = false;
    });
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, replacement.port, {
      browserGpuMode: "software",
      kill,
      scan,
      sleep: async () => {},
      spawn,
      stateHome,
    });

    expect(kill).toHaveBeenCalledWith(4321);
    expect(spawn).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ type: "started", port: replacement.port, pid: 5432 });
  });

  it("launches the replacement when the owned server died on its own", async () => {
    // The owned preview crashes (or is Ctrl-C'd) between the outer scan and the
    // one inside the stop. "Nothing left to stop" is the goal state for a
    // replacement; treating it as fatal refused to start any preview at all
    // until the session record was deleted by hand.
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 41490 };
    const replacement = { ...server, port: 41491, pid: "5432" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let scans = 0;
    let replacementRunning = false;
    const scan = vi.fn(async () => {
      scans += 1;
      // Alive for the first look, gone by the time the stop path scans.
      const ownedNow = scans === 1 ? [owned] : [];
      return [...ownedNow, ...(replacementRunning ? [replacement] : [])];
    });
    const kill = vi.fn();
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, replacement.port, {
      forceNew: true,
      kill,
      scan,
      sleep: async () => {},
      spawn,
      stateHome,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ type: "started", port: replacement.port, pid: 5432 });
  });

  it("starts a replacement when the existing server uses a different GPU policy", async () => {
    const hardwareServer = { ...server, browserGpuMode: "hardware" as const };
    const softwareServer = {
      ...server,
      port: 3211,
      pid: "5432",
      browserGpuMode: "software" as const,
    };
    let replacementRunning = false;
    const scan = vi.fn(async () => [
      hardwareServer,
      ...(replacementRunning ? [softwareServer] : []),
    ]);
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, 3002, {
      browserGpuMode: "software",
      scan,
      spawn,
      sleep: async () => {},
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
    });

    expect(result).toMatchObject({ type: "started", port: 3211, pid: 5432 });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("returns after a detached child becomes reachable and records its session", async () => {
    let spawned = false;
    const scan = vi.fn(async () => (spawned ? [server] : []));
    const unref = vi.fn();
    const spawn = vi.fn(() => {
      spawned = true;
      return { pid: 4321, unref };
    });
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));

    const result = await startBackgroundPreview(projectDir, 3002, {
      argv: ["/opt/hyperframes/cli.js", "preview", projectDir, "--background"],
      execPath: "/usr/bin/node",
      scan,
      spawn,
      sleep: async () => {},
      stateHome,
    });

    expect(result).toMatchObject({ type: "started", port: 3210, pid: 4321 });
    expect(unref).toHaveBeenCalledOnce();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("reports the live server PID while retaining the wrapper PID for cleanup", async () => {
    const liveServer = { ...server, pid: "9876" };
    let spawned = false;
    const scan = vi.fn(async () => (spawned ? [liveServer] : []));
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan,
      spawn: () => {
        spawned = true;
        return { pid: 4321, unref: vi.fn() };
      },
      stateHome,
    });

    expect(result).toMatchObject({ type: "started", pid: 9876 });
    expect(
      JSON.parse(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")),
    ).toMatchObject({ pid: 4321 });
  });

  it("reaps a detached child that never becomes reachable without recording ownership", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const kill = vi.fn();

    await expect(
      startBackgroundPreview(projectDir, 3002, {
        scan: async () => [],
        spawn: () => ({ pid: 4321, unref: vi.fn() }),
        sleep: async () => {},
        kill,
        stateHome,
      }),
    ).rejects.toThrow(/did not become ready/i);

    expect(kill).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("removes a stale session when no matching server or process survives", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 999_999, port: 3210, projectDir, logPath: "/tmp/missing.log" },
      stateHome,
    );

    await expectStaleSessionRemoved(stateHome);
  });

  it("removes stale session metadata when its PID is alive but no server proves ownership", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    savePreviewSession(stateHome);

    await expectStaleSessionRemoved(stateHome);
  });

  it("keeps a live preview's record when a single probe misses it", async () => {
    // A server whose event loop is briefly blocked (a Puppeteer thumbnail
    // capture will do it) answers nothing for a second or two. Retiring the
    // record on that destroys the wrapperIdentity that is the only PID-reuse
    // guard `--stop` has, and it never comes back.
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity: () => "posix:birth",
      isSignalable: () => true,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("keeps a live preview's record when the identity lookup gives no answer", async () => {
    // `processIdentity` catches every failure into `null`, and on Windows and
    // macOS that failure is a subprocess timeout on a LIVE process — under the
    // same load that made the HTTP probe miss. Treating no-answer as
    // "recycled" destroyed the only PID-reuse guard `--stop` has.
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity: () => null,
      isSignalable: () => true,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("retires the record when the PID cannot be signalled at all", async () => {
    // Gone is gone: no birth token needed, and no subprocess spawned for it.
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );
    const identity = vi.fn(() => "posix:birth");

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity,
      isSignalable: () => false,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
    expect(identity).not.toHaveBeenCalled();
  });

  it("retires the record once the wrapper PID has been recycled", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity: () => "posix:someone-else",
      isSignalable: () => true,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("never leaves a partial session record for a concurrent reader", () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    savePreviewSession(stateHome);
    const path = previewSessionPath(projectDir, stateHome);

    writePreviewSession({ pid: 55, port: 3211, projectDir, logPath: "/tmp/two.log" }, stateHome);

    // Written through a temp file and renamed, so a reader mid-write sees the
    // whole previous record rather than truncated JSON it would then delete.
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: 55, port: 3211 });
    expect(
      readdirSync(join(stateHome, "hyperframes", "previews")).filter((n) => n.endsWith(".tmp")),
    ).toHaveLength(0);
  });

  it("uses the recorded custom port when status is called without repeating --port", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    savePreviewSession(stateHome);
    const scan = vi.fn(async () => [server]);

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan,
      stateHome,
    });

    expect(status?.port).toBe(3210);
    expect(scan).toHaveBeenCalledWith(3210);
  });

  it("stops only the matching project server and waits until it is unreachable", async () => {
    let running = true;
    const scan = vi.fn(async () => (running ? [server] : []));
    const kill = vi.fn(() => {
      running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      kill,
      sleep: async () => {},
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
    });

    expect(result).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("does not kill an unmatched saved PID that may have been reused", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    savePreviewSession(stateHome);
    const kill = vi.fn();

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan: async () => [],
      kill,
      stateHome,
    });

    expect(result).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("refuses to stop when the live server cannot prove its own PID", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const scan = vi.fn(async () => [{ ...server, pid: null }]);
    const kill = vi.fn();

    await expect(
      stopBackgroundPreview(projectDir, 3002, {
        scan,
        kill,
        sleep: async () => {},
        stateHome,
      }),
    ).rejects.toThrow(/ownership/i);

    expect(kill).not.toHaveBeenCalled();
  });

  it("reaps the saved wrapper when the live server is proven to be its descendant", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      {
        pid: 4321,
        wrapperIdentity: "wrapper-birth",
        port: 3210,
        projectDir,
        logPath: "/tmp/preview.log",
      },
      stateHome,
    );
    let running = true;
    const scan = vi.fn(async () => (running ? [{ ...server, pid: "9876" }] : []));
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      kill,
      isDescendant: (childPid, ancestorPid) => childPid === 9876 && ancestorPid === 4321,
      identity: (pid) => (pid === 4321 ? "wrapper-birth" : null),
      sleep: async () => {},
      stateHome,
    });

    expect(result).toBe(true);
    expect(kill.mock.calls).toEqual([[4321]]);
  });

  it("kills only the live server when the saved wrapper birth identity has changed", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      {
        pid: 4321,
        wrapperIdentity: "original-wrapper-birth",
        port: 3210,
        projectDir,
        logPath: "/tmp/preview.log",
      },
      stateHome,
    );
    let running = true;
    const scan = vi.fn(async () => (running ? [{ ...server, pid: "9876" }] : []));
    const kill = vi.fn((pid: number) => {
      if (pid === 9876) running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      kill,
      isDescendant: () => true,
      identity: () => "reused-pid-birth",
      sleep: async () => {},
      stateHome,
    });

    expect(result).toBe(true);
    expect(kill.mock.calls).toEqual([[9876]]);
  });

  it("fails loudly when the server remains reachable after stop", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );

    await expect(
      stopBackgroundPreview(projectDir, 3002, {
        scan: async () => [server],
        kill: vi.fn(),
        sleep: async () => {},
        stateHome,
      }),
    ).rejects.toThrow(/did not stop/i);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("verifies the owned port stopped even when another server serves the same project", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 41490 };
    const sibling = { ...server, port: 41491, pid: "8765" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let ownedRunning = true;
    const scan = vi.fn(async () => [...(ownedRunning ? [owned] : []), sibling]);
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) ownedRunning = false;
    });

    const stopped = await stopBackgroundPreview(projectDir, owned.port, {
      kill,
      scan,
      sleep: async () => {},
      stateHome,
    });

    expect(stopped).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });
});
