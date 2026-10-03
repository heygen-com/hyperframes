import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_HANDOFF_FILE,
  DESKTOP_DOWNLOAD_URL,
  HANDOFF_READY,
  agentSession,
  desktopHint,
  desktopInstalled,
  openCommandFor,
  openInDesktop,
} from "./desktopApp.js";

const NO_AGENT = {};

describe("openInDesktop", () => {
  it("hands the folder to the released app when it is installed", () => {
    const asked: string[] = [];
    const result = openInDesktop("/films/a", {
      platform: "darwin",
      open: (id, dir) => (asked.push(`${id} ${dir}`), true),
      env: NO_AGENT,
    });
    expect(result).toEqual({ opened: true, bundleId: "dev.hyperframes.desktop", handedOver: null });
    expect(asked).toEqual(["dev.hyperframes.desktop /films/a"]);
  });

  it("falls back to Canary when only Canary is installed", () => {
    const result = openInDesktop("/films/a", {
      platform: "darwin",
      open: (id) => id.endsWith(".canary"),
      env: NO_AGENT,
    });
    expect(result).toMatchObject({ opened: true, bundleId: "dev.hyperframes.desktop.canary" });
  });

  it("points to the download when no app is installed", () => {
    const result = openInDesktop("/films/a", { platform: "darwin", open: () => false });
    expect(result).toEqual({
      opened: false,
      reason: "not-installed",
      downloadUrl: DESKTOP_DOWNLOAD_URL,
    });
  });

  it("never runs `open` off macOS", () => {
    const result = openInDesktop("C:\\films\\a", {
      platform: "win32",
      open: () => {
        throw new Error("must not run");
      },
    });
    expect(result).toMatchObject({ opened: false, reason: "unsupported-platform" });
  });
});

describe("agent hand-off", () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const handoff = () => join(dir!, AGENT_HANDOFF_FILE);

  it("names the conversation the command runs in, Claude Code first", () => {
    expect(agentSession({ CLAUDE_CODE_SESSION_ID: "c-1", CODEX_THREAD_ID: "x-1" })).toEqual({
      engine: "claude",
      sessionId: "c-1",
    });
    expect(agentSession({ CODEX_THREAD_ID: "x-1" })).toEqual({ engine: "codex", sessionId: "x-1" });
    expect(agentSession({})).toBeNull();
  });

  it("leaves the app the conversation once it has the folder", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-handoff-"));
    const result = openInDesktop(dir, {
      platform: "darwin",
      open: () => true,
      env: { CLAUDE_CODE_SESSION_ID: "0a8eed95-0869-45bf-83ec-5d71fcc5236c" },
    });
    expect(result).toMatchObject({ opened: true, handedOver: { engine: "claude" } });
    expect(JSON.parse(readFileSync(handoff(), "utf8"))).toEqual({
      engine: "claude",
      sessionId: "0a8eed95-0869-45bf-83ec-5d71fcc5236c",
    });
  });

  it("writes nothing when no app took the folder, or no agent runs the command", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-handoff-"));
    openInDesktop(dir, { platform: "darwin", open: () => false, env: { CODEX_THREAD_ID: "x-1" } });
    openInDesktop(dir, { platform: "darwin", open: () => true, env: {} });
    expect(existsSync(handoff())).toBe(false);
  });
});

describe("openCommandFor", () => {
  it("names the project relative to where the person is", () => {
    expect(openCommandFor("/work/films/a", "/work/films/a")).toBe("hyperframes open .");
    expect(openCommandFor("/work/films/a", "/work")).toBe("hyperframes open films/a");
    expect(openCommandFor("/work/my film", "/work")).toBe('hyperframes open "my film"');
  });
});

describe("desktopInstalled", () => {
  const nothing = {
    platform: "darwin",
    home: "/Users/a",
    exists: () => false,
    spotlight: () => false,
  };

  it("finds the app where the DMG and the installer put it, Canary included", () => {
    expect(
      desktopInstalled({
        ...nothing,
        exists: (p: string) => p === "/Applications/HyperFrames Canary.app",
      }),
    ).toBe(true);
    expect(
      desktopInstalled({
        ...nothing,
        exists: (p: string) => p === "/Users/a/Applications/HyperFrames.app",
      }),
    ).toBe(true);
  });

  it("asks Spotlight for one installed anywhere else", () => {
    expect(
      desktopInstalled({ ...nothing, spotlight: (id: string) => id === "dev.hyperframes.desktop" }),
    ).toBe(true);
    expect(desktopInstalled(nothing)).toBe(false);
  });

  it("is never there off macOS", () => {
    expect(desktopInstalled({ ...nothing, platform: "linux", exists: () => true })).toBe(false);
  });
});

describe("desktopHint", () => {
  const OUTSIDE = {};
  const download = `Edit it by chatting with Framey in HyperFrames Studio → ${DESKTOP_DOWNLOAD_URL}`;

  it("points to the download when the app is missing", () => {
    expect(desktopHint(process.cwd(), { env: OUTSIDE, installed: false })).toBe(download);
  });

  it("points an installed app to `hyperframes open` once the app opens handed-over projects", () => {
    expect(desktopHint(process.cwd(), { env: OUTSIDE, installed: true })).toBe(
      HANDOFF_READY ? "Edit it with Framey: hyperframes open ." : download,
    );
  });

  it("says nothing inside the app, whose runs carry HYPERFRAMES_DESKTOP_PROJECT", () => {
    expect(
      desktopHint(process.cwd(), { env: { HYPERFRAMES_DESKTOP_PROJECT: "/p" }, installed: true }),
    ).toBeNull();
  });
});
