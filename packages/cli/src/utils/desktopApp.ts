import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, win32 } from "node:path";
import { isHyperframesProject } from "@hyperframes/core";
import { addCatchUpNote, markSeen, readSeen, seenPath } from "./appHistory.js";
import { createProjectConfig } from "./projectConfig.js";
import { writeRecord } from "./projectRecords.js";

// The HyperFrames desktop app (not "Studio"): `open -b` on macOS, its executable elsewhere. Other builds of it can
// be named in HYPERFRAMES_DESKTOP_BUNDLE_IDS and HYPERFRAMES_DESKTOP_APP_NAMES (comma-separated), looked for after it.
const list = (name: string): string[] =>
  (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const bundleIds = (): string[] => [
  "dev.hyperframes.desktop",
  ...list("HYPERFRAMES_DESKTOP_BUNDLE_IDS"),
];
const appNames = (): string[] => ["HyperFrames", ...list("HYPERFRAMES_DESKTOP_APP_NAMES")];
const DEFAULT_APP = "the HyperFrames desktop app";
const STUDIO_PAGE = "https://hyperframes.studio/studio";
const DOWNLOADS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: `${STUDIO_PAGE}/download`,
  linux: `${STUDIO_PAGE}/download?os=linux`,
  win32: `${STUDIO_PAGE}/download?os=windows`,
};

export type DownloadSource = "cli" | "browser-editor";

const tagged = (url: string, src: DownloadSource) =>
  `${url}${url.includes("?") ? "&" : "?"}src=${src}`;

/** This machine's build of the app, tagged with where the link is shown; null where there is none. */
export const desktopDownloadUrl = (
  platform = process.platform,
  src: DownloadSource = "cli",
): string | null => {
  const url = DOWNLOADS[platform];
  return url ? tagged(url, src) : null;
};

export const downloadHint = (url: string): string =>
  `Keep editing by chatting with Framey in the HyperFrames desktop app → ${url}`;

// Every build of the app takes a handed-over folder: macOS as open-file, Windows and Linux on their command line.
export const HANDOFF_READY = true;

export interface AgentSession {
  engine: "claude" | "codex" | "grok";
  sessionId: string;
}

export const AGENT_HANDOFF_FILE = join(".hyperframes", "agent-handoff.json");
/** The Studio page's telemetry `tab_id`, left for the app to report its first open and export against. */
const DESKTOP_CTA_RECORD = "desktop-cta.json";

// ponytail: Claude Code, then Codex, then Grok; an agent started inside another's shell carries both, unsorted.
export function agentSession(env: NodeJS.ProcessEnv = process.env): AgentSession | null {
  if (env.CLAUDE_CODE_SESSION_ID)
    return { engine: "claude", sessionId: env.CLAUDE_CODE_SESSION_ID };
  if (env.CODEX_THREAD_ID) return { engine: "codex", sessionId: env.CODEX_THREAD_ID };
  if (env.GROK_SESSION_ID) return { engine: "grok", sessionId: env.GROK_SESSION_ID };
  return null;
}

export type DesktopOpenResult =
  | { opened: true; app: string; handedOver: AgentSession | null }
  | {
      opened: false;
      reason: "handoff-unavailable" | "unsupported-platform" | "not-installed" | "open-failed";
      downloadUrl: string;
    };

const openWithBundle = (bundleId: string, dir: string): boolean =>
  spawnSync("open", ["-b", bundleId, dir], { stdio: "ignore" }).status === 0;

/** Single-instance app: a running copy is forwarded the folder. Only a refused spawn counts as failed. */
function launchApp(executable: string, dir: string): boolean {
  try {
    const child = spawn(executable, [dir], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

function launcherAppImage(text: string | null): string | null {
  try {
    const launcher: unknown = JSON.parse(text ?? "null");
    return typeof launcher === "object" &&
      launcher !== null &&
      "appImage" in launcher &&
      typeof launcher.appImage === "string"
      ? launcher.appImage
      : null;
  } catch {
    return null;
  }
}

interface AppLookup {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (path: string) => boolean;
  read?: (path: string) => string | null;
}

/** Released then Canary: the Windows install path, or the AppImage Linux records in launcher.json; null on macOS. */
function desktopApps({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
  read = readText,
}: AppLookup = {}): { executable: string; name: string }[] | null {
  if (platform !== "win32" && platform !== "linux") return null;
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  const where = (name: string): string | null => {
    if (platform === "win32")
      return env.LOCALAPPDATA
        ? win32.join(env.LOCALAPPDATA, "Programs", name, `${name}.exe`)
        : null;
    const appImage = launcherAppImage(read(join(config, name, "launcher.json")));
    return appImage && isAbsolute(appImage) ? appImage : null;
  };
  return appNames().flatMap((name, i) => {
    const executable = where(name);
    return executable && exists(executable)
      ? [{ executable, name: i === 0 ? DEFAULT_APP : name }]
      : [];
  });
}

/** The app reads the hand-off at its first chat send, so a project it cannot be written to just opens without it. */
function leaveHandoff(dir: string, session: AgentSession | null): AgentSession | null {
  if (!session || !writeRecord(dir, "agent-handoff.json", JSON.stringify(session))) return null;
  const now = Date.now();
  if (!readSeen(dir).at && !markSeen(dir, { at: now, checked: now }))
    console.warn(
      `◇  Couldn't note the hand-off in ${seenPath(dir)}, so \`catch-up\` won't see it.`,
    );
  addCatchUpNote(dir);
  return session;
}

function markBareIndexAsProject(dir: string): void {
  try {
    if (existsSync(join(dir, "index.html")) && !isHyperframesProject(readdirSync(dir)))
      createProjectConfig(dir);
  } catch (error) {
    console.warn(
      `◇  Couldn't add hyperframes.json to ${dir}, so the app may not open it: ${error}`,
    );
  }
}

// ponytail: success on Windows and Linux means the spawn started, not that the app took the folder; wait for the
// app's own acknowledgement if a broken install ever needs reporting.
export function openInDesktop(
  dir: string,
  {
    ready = HANDOFF_READY,
    platform = process.platform,
    open = openWithBundle,
    launch = launchApp,
    installed = () => desktopInstalled({ platform }),
    env = process.env,
    cta,
    src = "cli",
    ...where
  }: AppLookup & {
    cta?: string;
    src?: DownloadSource;
    ready?: boolean;
    open?: (bundleId: string, dir: string) => boolean;
    launch?: (executable: string, dir: string) => boolean;
    installed?: () => boolean;
  } = {},
): DesktopOpenResult {
  const notOpened = (
    reason: Extract<DesktopOpenResult, { opened: false }>["reason"],
  ): DesktopOpenResult => ({
    opened: false,
    reason,
    downloadUrl: desktopDownloadUrl(platform, src) ?? STUDIO_PAGE,
  });
  const opened = (app: string): DesktopOpenResult => {
    if (cta) writeRecord(dir, DESKTOP_CTA_RECORD, JSON.stringify({ cta, at: Date.now() }));
    return {
      opened: true,
      app,
      handedOver: leaveHandoff(dir, agentSession(env)),
    };
  };
  if (!ready) return notOpened("handoff-unavailable");
  markBareIndexAsProject(dir);
  if (platform === "darwin") {
    const bundleId = bundleIds().find((id) => open(id, dir));
    if (!bundleId) return notOpened(installed() ? "open-failed" : "not-installed");
    return opened(bundleId === bundleIds()[0] ? DEFAULT_APP : bundleId);
  }
  const apps = desktopApps({ platform, env, ...where });
  if (!apps) return notOpened("unsupported-platform");
  if (!apps.length) return notOpened("not-installed");
  const app = apps.find(({ executable }) => launch(executable, dir));
  return app ? opened(app.name) : notOpened("open-failed");
}

/** The `hyperframes open` line for a project, relative to where the person is. */
export function openCommandFor(dir: string, cwd = process.cwd()): string {
  const shown = relative(cwd, dir) || ".";
  return `hyperframes open ${/\s/.test(shown) ? JSON.stringify(shown) : shown}`;
}

/** Spotlight's copies of an app with this bundle id; an updater's hidden leftover (`.X.app.installing-…`) is none. */
const spotlightFinds = (bundleId: string): boolean =>
  spawnSync("mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`], { encoding: "utf8" })
    .stdout?.split("\n")
    .some((path) => path.endsWith(".app") && !basename(path).startsWith(".")) ?? false;

/** Whether this machine has the app, without launching it (on a Mac: install folders, then Spotlight). */
export function desktopInstalled({
  spotlight = spotlightFinds,
  ...where
}: AppLookup & { spotlight?: (bundleId: string) => boolean } = {}): boolean {
  const { platform = process.platform, home = homedir(), exists = existsSync } = where;
  if (platform !== "darwin") return (desktopApps(where)?.length ?? 0) > 0;
  const folders = ["/Applications", join(home, "Applications")];
  if (folders.some((folder) => appNames().some((name) => exists(join(folder, `${name}.app`)))))
    return true;
  return bundleIds().some(spotlight);
}

export function insideHostApp(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.HYPERFRAMES_DESKTOP_PROJECT);
}

/** The app line render and preview print; null inside the app, or with nothing here to open or download. */
export function desktopHint(
  dir: string,
  {
    env = process.env,
    ready = HANDOFF_READY,
    installed,
    platform = process.platform,
  }: {
    env?: NodeJS.ProcessEnv;
    ready?: boolean;
    installed?: boolean;
    platform?: NodeJS.Platform;
  } = {},
): string | null {
  if (insideHostApp(env)) return null;
  if (ready && (installed ?? desktopInstalled({ platform, env })))
    return `Keep editing by chatting with Framey in the desktop app: ${openCommandFor(dir)}`;
  const url = desktopDownloadUrl(platform);
  return url ? downloadHint(url) : null;
}
