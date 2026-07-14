import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ActiveServer } from "../server/portUtils.js";
import {
  buildBackgroundPreviewArgs,
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

describe("background preview lifecycle", () => {
  it("builds a detached child invocation without recursively preserving --background", () => {
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

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      pidAlive: () => false,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("uses the recorded custom port when status is called without repeating --port", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
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
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
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
});
