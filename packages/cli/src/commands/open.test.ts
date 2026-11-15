import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ActiveServer } from "../server/portUtils.js";
import { endPreviewBeforeOpening } from "./open.js";
import {
  previewSessionPath,
  readBackgroundPreviewStatus,
  stopBackgroundPreview,
  writePreviewSession,
} from "./previewLifecycle.js";

const projectDir = resolve("/tmp/hyperframes-open-project");
const background = { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" };
const never = () => {
  throw new Error("must not run");
};

describe("endPreviewBeforeOpening", () => {
  it("does nothing when no preview of the project runs", async () => {
    const result = await endPreviewBeforeOpening(projectDir, {
      status: async () => null,
      stop: never,
      appInstalled: never,
    });

    expect(result).toEqual({ state: "none" });
  });

  it("stops the background preview so the app can take the history lock", async () => {
    const stop = vi.fn(async () => true);

    const result = await endPreviewBeforeOpening(projectDir, {
      status: async () => background,
      stop,
      appInstalled: () => true,
    });

    expect(result).toEqual({ state: "stopped", port: 3210 });
    expect(stop).toHaveBeenCalledWith(projectDir, 3210);
  });

  it("leaves a preview it did not start in the background to its owner, naming the stop command", async () => {
    const result = await endPreviewBeforeOpening(projectDir, {
      status: async () => ({ pid: 999, port: 3002, projectDir }),
      stop: never,
      appInstalled: () => true,
    });

    expect(result).toMatchObject({ state: "left-running", port: 3002 });
    expect(result).toHaveProperty(
      "stopCommand",
      expect.stringMatching(/^hyperframes preview .+ --stop --port 3002$/),
    );
  });

  it("keeps the preview when the app isn't installed, since nothing will open", async () => {
    const result = await endPreviewBeforeOpening(projectDir, {
      status: async () => background,
      stop: never,
      appInstalled: () => false,
    });

    expect(result).toMatchObject({ state: "left-running", port: 3210 });
  });

  it("reports a stop that fails instead of throwing, with the command to retry", async () => {
    const result = await endPreviewBeforeOpening(projectDir, {
      status: async () => background,
      stop: async () => {
        throw new Error("background preview did not stop");
      },
      appInstalled: () => true,
    });

    expect(result).toMatchObject({
      state: "left-running",
      port: 3210,
      error: "background preview did not stop",
    });
  });

  function liveLifecycle(saveSession: boolean) {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-open-preview-"));
    onTestFinished(() => rmSync(stateHome, { recursive: true, force: true }));
    if (saveSession)
      writePreviewSession({ ...background, wrapperIdentity: "wrapper-birth" }, stateHome);
    let running = true;
    const server: ActiveServer = {
      port: background.port,
      projectName: "hyperframes-open-project",
      projectDir,
      version: "test",
      pid: String(background.pid),
      pidSource: "os",
    };
    const lifecycle = {
      stateHome,
      scan: async () => (running ? [server] : []),
      probe: async (port: number) => (running && port === server.port ? server : null),
      kill: vi.fn(() => {
        running = false;
      }),
      sleep: async () => {},
      identity: () => "wrapper-birth",
    };
    return {
      lifecycle,
      deps: {
        status: (dir: string, port: number) => readBackgroundPreviewStatus(dir, port, lifecycle),
        stop: (dir: string, port: number) => stopBackgroundPreview(dir, port, lifecycle),
        appInstalled: () => true,
      },
    };
  }

  it("stops a saved background preview end to end and retires its session record", async () => {
    const { lifecycle, deps } = liveLifecycle(true);

    const result = await endPreviewBeforeOpening(projectDir, deps);

    expect(result).toEqual({ state: "stopped", port: background.port });
    expect(lifecycle.kill).toHaveBeenCalledWith(background.pid);
    expect(existsSync(previewSessionPath(projectDir, lifecycle.stateHome))).toBe(false);
    expect(await readBackgroundPreviewStatus(projectDir, 3002, lifecycle)).toBeNull();
  });

  it("never kills a matching server that has no saved background session", async () => {
    const { lifecycle, deps } = liveLifecycle(false);

    const result = await endPreviewBeforeOpening(projectDir, deps);

    expect(result).toMatchObject({ state: "left-running", port: background.port });
    expect(lifecycle.kill).not.toHaveBeenCalled();
  });
});
