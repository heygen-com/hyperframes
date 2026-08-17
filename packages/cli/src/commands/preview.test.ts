import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import {
  default as previewCommand,
  foregroundPreviewReadyPayload,
  handlePreviewKillAll,
  handlePreviewList,
  previewLaunchMode,
  previewLaunchModeError,
  previewPortError,
  publicPreviewPid,
  previewViteArgs,
  reportPreviewShutdown,
  studioReadyUrl,
  studioDeepLink,
  studioLandingSearch,
  studioSummaryUrls,
  waitForStudioChildClose,
} from "./preview.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function projectWith(storyboard: string | null, frameFiles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-preview-landing-"));
  tempDirs.push(dir);
  if (storyboard !== null) writeFileSync(join(dir, "STORYBOARD.md"), storyboard);
  for (const file of frameFiles) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "<div></div>");
  }
  return dir;
}

const FRAME = (n: number, status: string) =>
  `## Frame ${n} — F${n}\n- status: ${status}\n- src: compositions/frames/0${n}.html\n\nBeat.\n`;

describe("studioLandingSearch", () => {
  it("returns no search without a storyboard", () => {
    expect(studioLandingSearch(projectWith(null))).toBe("");
  });

  it("lands on the board while sketches are under review (any built frame)", () => {
    const dir = projectWith(`${FRAME(1, "built")}${FRAME(2, "outline")}`, [
      "compositions/frames/01.html",
    ]);
    expect(studioLandingSearch(dir)).toBe("?view=storyboard");
  });

  it("lands on the board during pure planning (srcs declared, none exist)", () => {
    const dir = projectWith(`${FRAME(1, "outline")}${FRAME(2, "outline")}`);
    expect(studioLandingSearch(dir)).toBe("?view=storyboard");
  });

  it("lands on the timeline once frames exist without a built status", () => {
    const dir = projectWith(`${FRAME(1, "outline")}`, ["compositions/frames/01.html"]);
    expect(studioLandingSearch(dir)).toBe("");
  });

  it("lands on the timeline for fully animated boards", () => {
    const dir = projectWith(`${FRAME(1, "animated")}`, ["compositions/frames/01.html"]);
    expect(studioLandingSearch(dir)).toBe("");
  });
});

describe("Studio handoff URLs", () => {
  it("hands off the exact timeline project route", () => {
    const dir = projectWith(null);
    expect(studioDeepLink("http://127.0.0.1:3002", "demo", dir)).toBe(
      "http://127.0.0.1:3002/#project/demo",
    );
    expect(studioSummaryUrls("demo", "http://127.0.0.1:3002", dir)).toEqual({
      serverUrl: "http://127.0.0.1:3002",
      studioUrl: "http://127.0.0.1:3002/#project/demo",
    });
  });

  it("hands off the exact storyboard route while a project is still planning", () => {
    const dir = projectWith(FRAME(1, "outline"));
    expect(studioDeepLink("http://127.0.0.1:3002", "demo", dir)).toBe(
      "http://127.0.0.1:3002/?view=storyboard#project/demo",
    );
  });

  it("URL-encodes project names that have hash-route metacharacters", () => {
    const dir = projectWith(null);
    expect(studioDeepLink("http://127.0.0.1:3002", "Launch #1? 50%", dir)).toBe(
      "http://127.0.0.1:3002/#project/Launch%20%231%3F%2050%25",
    );
  });
});

describe("preview --kill-all", () => {
  const session = (port: number, projectDir: string) => ({
    pid: 4321,
    port,
    projectDir,
    logPath: `${projectDir}.log`,
  });

  it("keeps stopping after a record whose ownership cannot be proven", async () => {
    // Propagating the first failure left every later preview running AND
    // unreported — the one thing a stop pass must never do.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(clack.log, "warn").mockImplementation(() => {});

    await handlePreviewKillAll(3002, false, {
      listManaged: async () => [session(41402, "/tmp/unprovable"), session(41403, "/tmp/healthy")],
      stopManaged: async (projectDir: string) => {
        if (projectDir === "/tmp/unprovable") throw new Error("ownership failed");
        return true;
      },
      killScanned: async () => ({ killed: 0, unverified: [] }),
    });

    expect(log.mock.calls.flat().join("\n")).toContain("Killed 1 preview server");
    expect(warn.mock.calls.flat().join("\n")).toContain("/tmp/unprovable: ownership failed");
    log.mockRestore();
    warn.mockRestore();
  });

  it("reports nothing to kill when no preview is running", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handlePreviewKillAll(3002, false, {
      listManaged: async () => [],
      killScanned: async () => ({ killed: 0, unverified: [] }),
    });

    expect(log.mock.calls.flat().join("\n")).toContain("No active preview servers to kill");
    log.mockRestore();
  });
});

describe("previewLaunchMode", () => {
  it.each([
    [
      {
        background: false,
        foreground: false,
        interactive: false,
        devMode: false,
        localStudio: false,
      },
      "background",
    ],
    [
      {
        background: false,
        foreground: false,
        interactive: true,
        devMode: false,
        localStudio: false,
      },
      "embedded",
    ],
    [
      {
        background: false,
        foreground: true,
        interactive: false,
        devMode: true,
        localStudio: false,
      },
      "dev",
    ],
    [
      {
        background: false,
        foreground: true,
        interactive: false,
        devMode: false,
        localStudio: true,
      },
      "local",
    ],
    [
      {
        background: true,
        foreground: false,
        interactive: true,
        devMode: true,
        localStudio: true,
      },
      "background",
    ],
  ] as const)("resolves %o to %s", (options, expected) => {
    expect(previewLaunchMode(options)).toBe(expected);
  });

  it("rejects conflicting lifecycle overrides and actions", () => {
    expect(
      previewLaunchModeError({
        background: true,
        foreground: true,
        status: false,
        stop: false,
        list: false,
        killAll: false,
      }),
    ).toBe("--background and --foreground cannot be used together");
    expect(
      previewLaunchModeError({
        background: false,
        foreground: false,
        status: true,
        stop: true,
        list: false,
        killAll: false,
      }),
    ).toBe("Only one of --status, --stop, --list, or --kill-all can be used at a time");
    expect(
      previewLaunchModeError({
        background: true,
        foreground: false,
        status: false,
        stop: false,
        list: false,
        killAll: false,
      }),
    ).toBeNull();
    expect(
      previewLaunchModeError({
        background: true,
        foreground: false,
        status: true,
        stop: false,
        list: false,
        killAll: false,
      }),
    ).toBe("Preview launch overrides cannot be combined with lifecycle actions");
    expect(
      previewLaunchModeError({
        background: false,
        foreground: true,
        status: false,
        stop: false,
        list: false,
        killAll: true,
      }),
    ).toBe("Preview launch overrides cannot be combined with lifecycle actions");
    expect(
      previewLaunchModeError({
        background: false,
        foreground: false,
        forceNew: true,
        status: true,
        stop: false,
        list: false,
        killAll: false,
      }),
    ).toBe("Preview launch overrides cannot be combined with lifecycle actions");
  });

  it.each([
    [undefined, null],
    ["3002", null],
    ["1", null],
    ["65535", null],
    ["banana", "--port must be an integer between 1 and 65535"],
    ["3002oops", "--port must be an integer between 1 and 65535"],
    ["0", "--port must be an integer between 1 and 65535"],
    ["65536", "--port must be an integer between 1 and 65535"],
  ])("validates preview port %j", (value, expected) => {
    expect(previewPortError(value)).toBe(expected);
  });

  it("prefers the live server PID over its launcher PID", () => {
    expect(publicPreviewPid("9876", 4321)).toBe(9876);
    expect(publicPreviewPid(null, 4321)).toBe(4321);
  });

  it("pins detached Vite to the port the lifecycle scanner waits on", () => {
    expect(previewViteArgs(3032)).toEqual(["--host", "127.0.0.1", "--port", "3032"]);
  });

  it.each([
    ["  Local:   http://localhost:43127/", "http://localhost:43127"],
    ["  Local:   http://127.0.0.1:43127/", "http://127.0.0.1:43127"],
    [
      "\u001b[32m  Local:\u001b[0m   \u001b[36mhttp://127.0.0.1:43127/\u001b[0m",
      "http://127.0.0.1:43127",
    ],
  ])("extracts the ready URL from Vite output %j", (output, expected) => {
    expect(studioReadyUrl(output)).toBe(expected);
  });
});

describe("preview lifecycle JSON failures", () => {
  it.each([
    [
      "list",
      () =>
        handlePreviewList(3002, true, {
          scan: async () => {
            throw new Error("list probe failed");
          },
          listManaged: async () => [],
        }),
      "preview-list-failed",
    ],
    [
      "kill-all",
      () =>
        handlePreviewKillAll(3002, true, {
          listManaged: async () => [],
          killScanned: async () => {
            throw new Error("scan failed");
          },
        }),
      "preview-kill-all-failed",
    ],
  ] as const)("wraps %s failures in one JSON document", async (operation, run, code) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await run();

    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: 1,
      operation,
      ok: false,
      error: { code },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps stopping after a record whose ownership cannot be proven", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const session = (port: number, projectDir: string) => ({
      pid: 4321,
      port,
      projectDir,
      logPath: `${projectDir}.log`,
    });

    await handlePreviewKillAll(3002, true, {
      listManaged: async () => [session(41402, "/tmp/unprovable"), session(41403, "/tmp/healthy")],
      stopManaged: async (projectDir) => {
        if (projectDir === "/tmp/unprovable") throw new Error("ownership failed");
        return true;
      },
      killScanned: async () => ({ killed: 0, unverified: [] }),
    });

    const [line] = log.mock.calls[0] as [string];
    // The second record must still be stopped AND the first must be reported:
    // propagating the first failure left every later preview running, unlisted.
    expect(JSON.parse(line)).toMatchObject({
      operation: "kill-all",
      ok: true,
      result: { state: "killed-all", stopped: 1, failed: ["/tmp/unprovable: ownership failed"] },
    });
  });

  it("wraps managed-start validation failures in one JSON document", async () => {
    const dir = projectWith(null);
    writeFileSync(join(dir, "index.html"), "<html></html>");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCommand(previewCommand, {
      rawArgs: [dir, "--background", "--json", "--user-data-dir", join(dir, "profile")],
    });

    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: 1,
      operation: "start",
      ok: false,
      error: { code: "preview-validation-failed" },
    });
  });

  it("wraps stop failures in one JSON document", async () => {
    const missing = join(tmpdir(), `hf-preview-missing-${process.pid}-${Date.now()}`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCommand(previewCommand, {
      rawArgs: [missing, "--stop", "--json"],
    });

    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: 1,
      operation: "stop",
      ok: false,
      error: { code: "preview-stop-failed" },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("wraps missing-project start failures without human stderr", async () => {
    const missing = join(tmpdir(), `hf-preview-missing-start-${process.pid}-${Date.now()}`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCommand(previewCommand, { rawArgs: [missing, "--background", "--json"] });

    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0] as [string];
    expect(JSON.parse(line)).toMatchObject({
      operation: "start",
      ok: false,
      error: { code: "preview-start-failed" },
    });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("foreground preview JSON", () => {
  it("emits the same ready session contract before remaining attached", () => {
    const dir = projectWith(null);
    expect(foregroundPreviewReadyPayload("Launch #1", "http://localhost:4567", dir, 4321)).toEqual({
      schemaVersion: 1,
      operation: "start",
      ok: true,
      result: {
        state: "started",
        mode: "foreground",
        projectName: "Launch #1",
        projectDir: dir,
        host: "127.0.0.1",
        port: 4567,
        pid: 4321,
        serverUrl: "http://127.0.0.1:4567",
        studioUrl: "http://127.0.0.1:4567/#project/Launch%20%231",
        ready: true,
      },
    });
  });

  it("keeps embedded shutdown silent after the readiness envelope", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    reportPreviewShutdown(true);

    expect(log).not.toHaveBeenCalled();
  });
});

describe("waitForStudioChildClose", () => {
  it("resolves when the child closed before the listener was attached", async () => {
    const signalTarget = { once: vi.fn(), off: vi.fn() };
    const child = {
      exitCode: 1,
      signalCode: null,
      once: vi.fn(),
    } as unknown as Parameters<typeof waitForStudioChildClose>[0];

    await expect(waitForStudioChildClose(child, signalTarget)).resolves.toBeUndefined();
    expect(child.once).not.toHaveBeenCalled();
    expect(signalTarget.once).toHaveBeenCalledTimes(2);
    expect(signalTarget.off).toHaveBeenCalledTimes(2);
  });

  it("reaps on process exit even when stdio never emits close", async () => {
    let exit: (() => void) | undefined;
    const signalTarget = { once: vi.fn(), off: vi.fn() };
    const child = {
      exitCode: null,
      signalCode: null,
      once: vi.fn((event: string, listener: () => void) => {
        if (event === "exit") exit = listener;
      }),
    } as unknown as Parameters<typeof waitForStudioChildClose>[0];

    let resolved = false;
    const waiting = waitForStudioChildClose(child, signalTarget).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(child.once).toHaveBeenCalledWith("exit", expect.any(Function));

    exit?.();
    await waiting;
    expect(resolved).toBe(true);
    expect(signalTarget.off).toHaveBeenCalledTimes(2);
  });
});
