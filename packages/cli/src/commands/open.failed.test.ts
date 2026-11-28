import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import type { DesktopOpenResult } from "../utils/desktopApp.js";

const mockResult = vi.hoisted<{ current: DesktopOpenResult }>(() => ({
  current: {
    opened: false,
    reason: "open-failed",
    downloadUrl: "https://hyperframes.studio/studio/download?src=cli",
  },
}));

vi.mock("../utils/desktopApp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/desktopApp.js")>()),
  desktopInstalled: () => true,
  openInDesktop: () => mockResult.current,
}));

vi.mock("./previewLifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./previewLifecycle.js")>()),
  readBackgroundPreviewStatus: async () => null,
}));

const { default: open } = await import("./open.js");

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-open-failed-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "index.html"), "<html></html>");
  return dir;
}

describe("hyperframes open when the app is installed but fails to start", () => {
  it("tells the person it is installed and prints the open command, not a download link", async () => {
    const dir = makeProject();
    mockResult.current = {
      opened: false,
      reason: "open-failed",
      downloadUrl: "https://hyperframes.studio/studio/download?src=cli",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(open, { rawArgs: [dir] });
      const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(out).toContain("HyperFrames is installed but didn't open from here.");
      expect(out).toContain("Open it from your own terminal: ");
      expect(out).toContain("hyperframes open ");
      expect(out).not.toContain("Download it:");
      expect(out).not.toContain("hyperframes.studio/studio/download");
    } finally {
      log.mockRestore();
      expect(consumeCommandResult().exitCode).toBe(1);
    }
  });

  it("omits downloadUrl and includes openCommand in --json on open-failed", async () => {
    const dir = makeProject();
    mockResult.current = {
      opened: false,
      reason: "open-failed",
      downloadUrl: "https://hyperframes.studio/studio/download?src=cli",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(open, { rawArgs: [dir, "--json"] });
      const payload = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as Record<
        string,
        unknown
      >;
      expect(payload.opened).toBe(false);
      expect(payload.reason).toBe("open-failed");
      expect(payload).not.toHaveProperty("downloadUrl");
      expect(payload.openCommand).toEqual(expect.stringMatching(/^hyperframes open /));
    } finally {
      log.mockRestore();
      expect(consumeCommandResult().exitCode).toBe(1);
    }
  });

  it("keeps the download link when the app is not installed", async () => {
    const dir = makeProject();
    mockResult.current = {
      opened: false,
      reason: "not-installed",
      downloadUrl: "https://hyperframes.studio/studio/download?src=cli",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(open, { rawArgs: [dir, "--json"] });
      const payload = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as Record<
        string,
        unknown
      >;
      expect(payload.reason).toBe("not-installed");
      expect(payload.downloadUrl).toBe("https://hyperframes.studio/studio/download?src=cli");
      expect(payload).not.toHaveProperty("openCommand");
    } finally {
      log.mockRestore();
      expect(consumeCommandResult().exitCode).toBe(1);
    }
  });
});
