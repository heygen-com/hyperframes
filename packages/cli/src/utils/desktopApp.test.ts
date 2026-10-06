import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, win32 } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSeen } from "./appHistory.js";
import {
  AGENT_HANDOFF_FILE,
  HANDOFF_READY,
  agentSession,
  desktopHint,
  desktopInstalled,
  openCommandFor,
  openInDesktop,
} from "./desktopApp.js";

// The live path (ready) is what ships once the app takes handed-over folders; CI exercises it here.
const LIVE = { ready: true, platform: "darwin" as const, env: {}, installed: () => true };
const MAC_DOWNLOAD = "https://hyperframes.dev/studio/download";
const MAC_HINT = `Keep editing by chatting with Framey in the HyperFrames desktop app → ${MAC_DOWNLOAD}`;
const FILM = resolve("films", "a");
const never = () => {
  throw new Error("must not run");
};

describe("openInDesktop", () => {
  it("opens and writes nothing while the app cannot take a project", () => {
    // Only the Mac app reads a handed-over folder in a released build so far.
    expect(HANDOFF_READY).toBe(process.platform === "darwin");
    expect(openInDesktop(FILM, { ready: false, platform: "darwin", open: never })).toEqual({
      opened: false,
      reason: "handoff-unavailable",
      downloadUrl: MAC_DOWNLOAD,
    });
  });

  it("hands the folder to the released app when it is installed", () => {
    const asked: string[] = [];
    const result = openInDesktop(FILM, {
      ...LIVE,
      open: (id, dir) => (asked.push(`${id} ${dir}`), true),
    });
    expect(result).toEqual({ opened: true, app: "the HyperFrames desktop app", handedOver: null });
    expect(asked).toEqual([`dev.hyperframes.desktop ${FILM}`]);
  });

  it("falls back to Canary when only Canary is installed", () => {
    const result = openInDesktop(FILM, { ...LIVE, open: (id) => id.endsWith(".canary") });
    expect(result).toMatchObject({ opened: true, app: "HyperFrames Canary" });
  });

  it("tells a missing app from one macOS could not open", () => {
    const missing = openInDesktop(FILM, { ...LIVE, open: () => false, installed: () => false });
    expect(missing).toMatchObject({ opened: false, reason: "not-installed" });
    const failed = openInDesktop(FILM, { ...LIVE, open: () => false, installed: () => true });
    expect(failed).toMatchObject({ opened: false, reason: "open-failed" });
  });

  it("opens nothing where the app has no build, and offers the app's page", () => {
    expect(
      openInDesktop(FILM, { ...LIVE, platform: "freebsd", open: never, launch: never }),
    ).toEqual({
      opened: false,
      reason: "unsupported-platform",
      downloadUrl: "https://hyperframes.dev/studio",
    });
  });
});

describe("openInDesktop on Windows", () => {
  const local = win32.join("C:", "Users", "a", "AppData", "Local");
  const exe = (name: string) => win32.join(local, "Programs", name, `${name}.exe`);
  const WIN = { ...LIVE, platform: "win32" as const, env: { LOCALAPPDATA: local }, open: never };

  it("starts the installed app with the folder, released build first", () => {
    const started: string[] = [];
    const launch = (executable: string, dir: string) => (
      started.push(`${executable} ${dir}`), true
    );
    const result = openInDesktop(FILM, { ...WIN, exists: () => true, launch });
    expect(result).toEqual({ opened: true, app: "the HyperFrames desktop app", handedOver: null });
    expect(started).toEqual([`${exe("HyperFrames")} ${FILM}`]);
  });

  it("falls back to Canary when only Canary is installed", () => {
    const canary = exe("HyperFrames Canary");
    const result = openInDesktop(FILM, { ...WIN, exists: (p) => p === canary, launch: () => true });
    expect(result).toMatchObject({ opened: true, app: "HyperFrames Canary" });
  });

  it("tells a missing app from one that would not start, and offers the app's page", () => {
    const missing = openInDesktop(FILM, { ...WIN, exists: () => false, launch: never });
    expect(missing).toEqual({
      opened: false,
      reason: "not-installed",
      downloadUrl: "https://hyperframes.dev/studio",
    });
    const failed = openInDesktop(FILM, { ...WIN, exists: () => true, launch: () => false });
    expect(failed).toMatchObject({ opened: false, reason: "open-failed" });
  });
});

describe("openInDesktop on Linux", () => {
  const home = resolve("home", "a");
  const appImage = resolve("opt", "HyperFrames-x86_64.AppImage");
  const launcher = (name: string) => join(home, ".config", name, "launcher.json");
  const LINUX = { ...LIVE, platform: "linux" as const, home, open: never, exists: () => true };

  it("starts the AppImage the app last recorded in its launcher.json", () => {
    const files = { [launcher("HyperFrames Canary")]: JSON.stringify({ appImage }) };
    const started: string[] = [];
    const result = openInDesktop(FILM, {
      ...LINUX,
      read: (p) => files[p] ?? null,
      launch: (executable, dir) => (started.push(`${executable} ${dir}`), true),
    });
    expect(result).toMatchObject({ opened: true, app: "HyperFrames Canary" });
    expect(started).toEqual([`${appImage} ${FILM}`]);
  });

  it("reads launcher.json under XDG_CONFIG_HOME when it is set", () => {
    const config = resolve("xdg");
    const read = (p: string) =>
      p === join(config, "HyperFrames", "launcher.json") ? JSON.stringify({ appImage }) : null;
    const env = { XDG_CONFIG_HOME: config };
    expect(openInDesktop(FILM, { ...LINUX, env, read, launch: () => true })).toMatchObject({
      opened: true,
      app: "the HyperFrames desktop app",
    });
  });

  it("ignores a relative, moved, or unreadable AppImage path", () => {
    const relativeFile = { [launcher("HyperFrames")]: JSON.stringify({ appImage: "HF.AppImage" }) };
    const relativePath = { ...LINUX, read: (p: string) => relativeFile[p] ?? null, launch: never };
    expect(openInDesktop(FILM, relativePath)).toMatchObject({ reason: "not-installed" });
    const moved = { [launcher("HyperFrames")]: JSON.stringify({ appImage }) };
    const gone = { ...LINUX, read: (p: string) => moved[p] ?? null, exists: () => false };
    expect(openInDesktop(FILM, { ...gone, launch: never })).toMatchObject({
      reason: "not-installed",
      downloadUrl: `${MAC_DOWNLOAD}?os=linux`,
    });
    expect(openInDesktop(FILM, { ...LINUX, read: () => "{", launch: never })).toMatchObject({
      reason: "not-installed",
    });
  });
});

describe("agent hand-off", () => {
  // The seen record lives in the person's home: these tests get their own.
  beforeEach(() => {
    const home = mkdtempSync(join(tmpdir(), "hf-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

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
    expect(agentSession({ GROK_SESSION_ID: "g-1" })).toEqual({ engine: "grok", sessionId: "g-1" });
    expect(agentSession({})).toBeNull();
  });

  it("leaves the app the conversation once it has the folder", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-handoff-"));
    writeFileSync(join(dir, "CLAUDE.md"), "# HyperFrames Composition Project\n");
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
    // `catch-up` shows only what the app does from here on.
    const first = readSeen(dir).at;
    expect(first).toBeGreaterThan(Date.now() - 60_000);
    // Handing it over again keeps the turns recorded since the first hand-off for catch-up.
    openInDesktop(dir, { ...LIVE, open: () => true, env: { CLAUDE_CODE_SESSION_ID: session } });
    expect(readSeen(dir).at).toBe(first);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("npx hyperframes catch-up");
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
  const nothing = {
    platform: "darwin" as const,
    home,
    exists: () => false,
    spotlight: () => false,
  };

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

  it("finds the Windows app where its installer puts it, and nothing where there is no build", () => {
    const local = win32.join("C:", "Users", "a", "AppData", "Local");
    const canary = win32.join(local, "Programs", "HyperFrames Canary", "HyperFrames Canary.exe");
    const windows = { ...nothing, platform: "win32" as const, env: { LOCALAPPDATA: local } };
    expect(desktopInstalled({ ...windows, exists: (p: string) => p === canary })).toBe(true);
    expect(desktopInstalled(windows)).toBe(false);
    expect(desktopInstalled({ ...nothing, platform: "freebsd", exists: () => true })).toBe(false);
  });

  it("finds no Linux app that never recorded its AppImage", () => {
    const linux = { ...nothing, platform: "linux" as const, exists: () => true, read: () => null };
    expect(desktopInstalled(linux)).toBe(false);
  });
});

describe("desktopHint", () => {
  const mac = { env: {}, platform: "darwin" as const };

  it("points to the download while gated, and when the app is missing", () => {
    expect(desktopHint(process.cwd(), { ...mac, ready: false, installed: true })).toBe(MAC_HINT);
    expect(desktopHint(process.cwd(), { ...mac, ready: true, installed: false })).toBe(MAC_HINT);
  });

  it("offers the Linux build on Linux, and nothing on Windows without the app", () => {
    expect(desktopHint(process.cwd(), { env: {}, platform: "linux", installed: false })).toBe(
      `Keep editing by chatting with Framey in the HyperFrames desktop app → ${MAC_DOWNLOAD}?os=linux`,
    );
    expect(desktopHint(process.cwd(), { env: {}, platform: "win32", installed: false })).toBeNull();
    expect(desktopHint(process.cwd(), { env: {}, platform: "win32", ready: true })).toBeNull();
  });

  it("points an installed Windows app to `hyperframes open`", () => {
    const windows = { env: {}, platform: "win32" as const, ready: true, installed: true };
    expect(desktopHint(process.cwd(), windows)).toBe(
      "Keep editing by chatting with Framey in the desktop app: hyperframes open .",
    );
  });

  it("points an installed app to `hyperframes open` once the app takes handed-over projects", () => {
    expect(desktopHint(process.cwd(), { ...mac, ready: true, installed: true })).toBe(
      "Keep editing by chatting with Framey in the desktop app: hyperframes open .",
    );
  });

  it("says nothing inside the app, whose runs carry HYPERFRAMES_DESKTOP_PROJECT", () => {
    const inApp = {
      ...mac,
      env: { HYPERFRAMES_DESKTOP_PROJECT: "/p" },
      ready: true,
      installed: true,
    };
    expect(desktopHint(process.cwd(), inApp)).toBeNull();
  });
});
