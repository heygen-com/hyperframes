import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ActiveServer } from "../server/portUtils.js";
import {
  BACKGROUND_IDLE_TIMEOUT_DEFAULT_MINUTES,
  buildBackgroundPreviewArgs,
  lifecycleShutdownReason,
  previewSessionPath,
  processAlive,
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

  it("builds a detached child invocation without recursively preserving --background", () => {
    expect(
      buildBackgroundPreviewArgs([
        "/opt/hyperframes/cli.js",
        "preview",
        projectDir,
        "--background",
        "--open",
      ]),
    ).toEqual([
      "/opt/hyperframes/cli.js",
      "preview",
      projectDir,
      "--no-open",
      "--idle-timeout",
      String(BACKGROUND_IDLE_TIMEOUT_DEFAULT_MINUTES),
    ]);
  });

  it("keeps an explicit --idle-timeout instead of stacking the default", () => {
    const explicit = buildBackgroundPreviewArgs([
      "/opt/hyperframes/cli.js",
      "preview",
      projectDir,
      "--background",
      "--idle-timeout",
      "0",
    ]);
    expect(explicit).toEqual([
      "/opt/hyperframes/cli.js",
      "preview",
      projectDir,
      "--idle-timeout",
      "0",
      "--no-open",
    ]);

    const equalsForm = buildBackgroundPreviewArgs(["preview", projectDir, "--idle-timeout=15"]);
    expect(equalsForm.filter((arg) => arg.includes("idle-timeout"))).toEqual(["--idle-timeout=15"]);
  });

  it("forwards --owner-pid to the detached child untouched", () => {
    expect(
      buildBackgroundPreviewArgs(["preview", projectDir, "--background", "--owner-pid", "812"]),
    ).toContain("--owner-pid");
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

  it("returns after a detached child becomes reachable and records its session", async () => {
    let scans = 0;
    const scan = vi.fn(async () => (++scans < 2 ? [] : [server]));
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ pid: 4321, unref }));
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

  it("uses the recorded custom port when status is called without repeating --port", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    savePreviewSession(stateHome);
    const scan = vi.fn(async () => [server]);

    const status = await readBackgroundPreviewStatus(projectDir, 3002, { scan, stateHome });

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

  it("uses the saved child PID when a matching live server cannot report one", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let running = true;
    const scan = vi.fn(async () => (running ? [{ ...server, pid: null }] : []));
    const kill = vi.fn(() => {
      running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      kill,
      sleep: async () => {},
      stateHome,
    });

    expect(result).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321);
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
});

describe("lifecycleShutdownReason", () => {
  const HOUR = 60 * 60 * 1000;

  it("keeps serving while active and owned", () => {
    expect(
      lifecycleShutdownReason({
        ownerPid: 42,
        ownerAlive: () => true,
        idleMs: 5 * 60 * 1000,
        idleLimitMs: HOUR,
      }),
    ).toBeNull();
  });

  it("shuts down when the owner is gone", () => {
    expect(
      lifecycleShutdownReason({
        ownerPid: 42,
        ownerAlive: () => false,
        idleMs: 0,
        idleLimitMs: HOUR,
      }),
    ).toContain("owner process 42");
  });

  it("shuts down past the idle limit, but never with the limit disabled", () => {
    const base = { ownerPid: null, ownerAlive: () => true };
    expect(lifecycleShutdownReason({ ...base, idleMs: HOUR, idleLimitMs: HOUR })).toContain("idle");
    expect(lifecycleShutdownReason({ ...base, idleMs: 10 * HOUR, idleLimitMs: 0 })).toBeNull();
  });
});

describe("processAlive", () => {
  it("sees this process, rejects sentinels and absent pids", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(0)).toBe(false);
    expect(processAlive(1)).toBe(false);
    expect(processAlive(-5)).toBe(false);
    expect(processAlive(2 ** 30)).toBe(false);
  });
});
