import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_HANDOFF_FILE,
  DESKTOP_DOWNLOAD_URL,
  DOWNLOAD_HINT,
  HANDOFF_READY,
  agentSession,
  desktopHint,
  desktopInstalled,
  openCommandFor,
  openInDesktop,
} from "./desktopApp.js";

// The live path (ready) is what ships once the app takes handed-over folders; CI exercises it here.
const LIVE = { ready: true, platform: "darwin", env: {}, installed: () => true };
const FILM = resolve("films", "a");
const never = () => {
  throw new Error("must not run");
};

describe("openInDesktop", () => {
  it("opens and writes nothing while the app cannot take a project", () => {
    expect(HANDOFF_READY).toBe(false);
    expect(openInDesktop(FILM, { open: never })).toEqual({
      opened: false,
      reason: "handoff-unavailable",
      downloadUrl: DESKTOP_DOWNLOAD_URL,
    });
  });

  it("hands the folder to the released app when it is installed", () => {
    const asked: string[] = [];
    const result = openInDesktop(FILM, {
      ...LIVE,
      open: (id, dir) => (asked.push(`${id} ${dir}`), true),
    });
    expect(result).toEqual({ opened: true, bundleId: "dev.hyperframes.desktop", handedOver: null });
    expect(asked).toEqual([`dev.hyperframes.desktop ${FILM}`]);
  });

  it("falls back to Canary when only Canary is installed", () => {
    const result = openInDesktop(FILM, { ...LIVE, open: (id) => id.endsWith(".canary") });
    expect(result).toMatchObject({ opened: true, bundleId: "dev.hyperframes.desktop.canary" });
  });

  it("tells a missing app from one macOS could not open", () => {
    const missing = openInDesktop(FILM, { ...LIVE, open: () => false, installed: () => false });
    expect(missing).toMatchObject({ opened: false, reason: "not-installed" });
    const failed = openInDesktop(FILM, { ...LIVE, open: () => false, installed: () => true });
    expect(failed).toMatchObject({ opened: false, reason: "open-failed" });
  });

  it("never runs `open` off macOS", () => {
    const result = openInDesktop(FILM, { ...LIVE, platform: "win32", open: never });
    expect(result).toMatchObject({ opened: false, reason: "unsupported-platform" });
  });
});

describe("agent hand-off", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) chmodSync(dir, 0o755);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
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
    const session = "0a8eed95-0869-45bf-83ec-5d71fcc5236c";
    const result = openInDesktop(dir, {
      ...LIVE,
      open: () => true,
      env: { CLAUDE_CODE_SESSION_ID: session },
    });
    expect(result).toMatchObject({ opened: true, handedOver: { engine: "claude" } });
    expect(JSON.parse(readFileSync(handoff(), "utf8"))).toEqual({
      engine: "claude",
      sessionId: session,
    });
  });

  it("writes nothing when gated, when no app took the folder, or when no agent runs the command", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-handoff-"));
    const agent = { CODEX_THREAD_ID: "x-1" };
    openInDesktop(dir, { ready: false, platform: "darwin", open: never, env: agent });
    openInDesktop(dir, { ...LIVE, open: () => false, env: agent });
    openInDesktop(dir, { ...LIVE, open: () => true });
    expect(existsSync(handoff())).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "still opens a project it cannot write to, with nothing handed over",
    () => {
      dir = mkdtempSync(join(tmpdir(), "hf-handoff-"));
      chmodSync(dir, 0o555);
      const result = openInDesktop(dir, {
        ...LIVE,
        open: () => true,
        env: { CODEX_THREAD_ID: "x-1" },
      });
      expect(result).toMatchObject({ opened: true, handedOver: null });
    },
  );
});

describe("openCommandFor", () => {
  it("names the project relative to where the person is", () => {
    const work = resolve("work");
    expect(openCommandFor(join(work, "films", "a"), join(work, "films", "a"))).toBe(
      "hyperframes open .",
    );
    expect(openCommandFor(join(work, "films", "a"), work)).toBe(
      `hyperframes open ${join("films", "a")}`,
    );
    expect(openCommandFor(join(work, "my film"), work)).toBe('hyperframes open "my film"');
  });
});

describe("desktopInstalled", () => {
  const home = resolve("Users", "a");
  const nothing = { platform: "darwin", home, exists: () => false, spotlight: () => false };

  it("finds the app where the DMG and the installer put it, Canary included", () => {
    const canary = join("/Applications", "HyperFrames Canary.app");
    expect(desktopInstalled({ ...nothing, exists: (p: string) => p === canary })).toBe(true);
    const mine = join(home, "Applications", "HyperFrames.app");
    expect(desktopInstalled({ ...nothing, exists: (p: string) => p === mine })).toBe(true);
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
  it("points to the download while gated, and when the app is missing", () => {
    expect(desktopHint(process.cwd(), { env: {}, installed: true })).toBe(DOWNLOAD_HINT);
    expect(desktopHint(process.cwd(), { env: {}, ready: true, installed: false })).toBe(
      DOWNLOAD_HINT,
    );
  });

  it("points an installed app to `hyperframes open` once the app takes handed-over projects", () => {
    expect(desktopHint(process.cwd(), { env: {}, ready: true, installed: true })).toBe(
      "Edit it with Framey: hyperframes open .",
    );
  });

  it("says nothing inside the app, whose runs carry HYPERFRAMES_DESKTOP_PROJECT", () => {
    const inApp = { env: { HYPERFRAMES_DESKTOP_PROJECT: "/p" }, ready: true, installed: true };
    expect(desktopHint(process.cwd(), inApp)).toBeNull();
  });
});
