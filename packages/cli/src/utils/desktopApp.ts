import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

// HyperFrames Studio, the desktop app. macOS hands it a folder through `open -b`, which the app takes as a project to
// add to Home and show (hyperframes-internal packages/desktop/main/folderOpen.mjs). The released app first, then Canary.
const DESKTOP_BUNDLE_IDS = ["dev.hyperframes.desktop", "dev.hyperframes.desktop.canary"] as const;
export const DESKTOP_DOWNLOAD_URL = "https://hyperframes.dev/studio/download";

/** The agent conversation a command runs in: Claude Code and Codex name it to the shells they start. */
export interface AgentSession {
  engine: "claude" | "codex";
  sessionId: string;
}

// The app's first chat in the project picks this conversation up as context, once (hyperframes-internal
// packages/desktop/main/agentHandoffFile.mjs).
export const AGENT_HANDOFF_FILE = join(".hyperframes", "agent-handoff.json");

// ponytail: Claude Code first; a Codex started inside a Claude Code shell (or the reverse) carries both, unsorted.
export function agentSession(env: NodeJS.ProcessEnv = process.env): AgentSession | null {
  if (env.CLAUDE_CODE_SESSION_ID)
    return { engine: "claude", sessionId: env.CLAUDE_CODE_SESSION_ID };
  if (env.CODEX_THREAD_ID) return { engine: "codex", sessionId: env.CODEX_THREAD_ID };
  return null;
}

export type DesktopOpenResult =
  | { opened: true; bundleId: string; handedOver: AgentSession | null }
  | { opened: false; reason: "not-installed" | "unsupported-platform"; downloadUrl: string };

/** Runs `open -b <id> <dir>`; true when macOS found the app and handed it the folder. */
type OpenWithBundle = (bundleId: string, dir: string) => boolean;

const openWithBundle: OpenWithBundle = (bundleId, dir) =>
  spawnSync("open", ["-b", bundleId, dir], { stdio: "ignore" }).status === 0;

// ponytail: macOS only; the Windows app needs its own hand-off (argv on second-instance) before this grows a branch.
export function openInDesktop(
  dir: string,
  { platform = process.platform, open = openWithBundle, env = process.env } = {},
): DesktopOpenResult {
  if (platform !== "darwin")
    return { opened: false, reason: "unsupported-platform", downloadUrl: DESKTOP_DOWNLOAD_URL };
  const bundleId = DESKTOP_BUNDLE_IDS.find((id) => open(id, dir));
  if (!bundleId)
    return { opened: false, reason: "not-installed", downloadUrl: DESKTOP_DOWNLOAD_URL };
  // Read at the app's first chat send, well after this open, so it is written once the app has the folder.
  const handedOver = agentSession(env);
  if (handedOver) {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, AGENT_HANDOFF_FILE), JSON.stringify(handedOver));
  }
  return { opened: true, bundleId, handedOver };
}

/** The `hyperframes open` line to print for a project, relative to where the person is. */
export function openCommandFor(dir: string, cwd = process.cwd()): string {
  const shown = relative(cwd, dir) || ".";
  return `hyperframes open ${/\s/.test(shown) ? JSON.stringify(shown) : shown}`;
}

const DESKTOP_APP_NAMES = ["HyperFrames.app", "HyperFrames Canary.app"];

/** Spotlight's copies of an app with this bundle id; an updater's hidden leftover (`.X.app.installing-…`) is none. */
const spotlightFinds = (bundleId: string): boolean =>
  spawnSync("mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`], { encoding: "utf8" })
    .stdout?.split("\n")
    .some((path) => path.endsWith(".app") && !basename(path).startsWith(".")) ?? false;

/** Whether this Mac has the desktop app, without launching it: where the DMG and the installer put it, else
 * Spotlight, which can miss an app for minutes after an update. Off macOS, never. */
export function desktopInstalled({
  platform = process.platform,
  home = homedir(),
  exists = existsSync,
  spotlight = spotlightFinds,
}: {
  platform?: string;
  home?: string;
  exists?: (path: string) => boolean;
  spotlight?: (bundleId: string) => boolean;
} = {}): boolean {
  if (platform !== "darwin") return false;
  const folders = ["/Applications", join(home, "Applications")];
  if (folders.some((folder) => DESKTOP_APP_NAMES.some((name) => exists(join(folder, name)))))
    return true;
  return DESKTOP_BUNDLE_IDS.some(spotlight);
}

// ponytail: the desktop app opens a handed-over folder only from its next release (hyperframes-internal
// main/folderOpen.mjs); until then every hint points to the download, as Studio's button does. Flip with it.
export const HANDOFF_READY = false;

/** The one line render and preview print about the desktop app: open the project in it, or get it. Null inside
 * the app itself, whose agent runs carry HYPERFRAMES_DESKTOP_PROJECT. */
export function desktopHint(
  dir: string,
  { env = process.env, installed }: { env?: NodeJS.ProcessEnv; installed?: boolean } = {},
): string | null {
  if (env.HYPERFRAMES_DESKTOP_PROJECT) return null;
  return HANDOFF_READY && (installed ?? desktopInstalled())
    ? `Edit it with Framey: ${openCommandFor(dir)}`
    : `Edit it by chatting with Framey in HyperFrames Studio → ${DESKTOP_DOWNLOAD_URL}`;
}
