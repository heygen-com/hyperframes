import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as clack from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import {
  default as previewCommand,
  handlePreviewKillAll,
  handlePreviewList,
  studioLandingSearch,
} from "./preview.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

describe("preview --list", () => {
  it("prefers the managed record over the same server's own self-report", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handlePreviewList(3002, false, {
      listManaged: async () => [
        { pid: 99, port: 3002, projectDir: resolve("/tmp/demo"), logPath: "/tmp/demo.log" },
      ],
      scan: async () => [
        {
          port: 3002,
          projectName: "demo",
          projectDir: resolve("/tmp/demo"),
          version: "test",
          pid: "99",
        },
      ],
    });

    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("1 server running");
    expect(printed).toContain("PID 99");
    log.mockRestore();
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
});
