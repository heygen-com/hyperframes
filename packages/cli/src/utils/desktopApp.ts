import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

// HyperFrames Studio, the desktop app; macOS hands it a folder through `open -b`. Released app first, then Canary.
const DESKTOP_BUNDLE_IDS = ["dev.hyperframes.desktop", "dev.hyperframes.desktop.canary"] as const;
const DESKTOP_APP_NAMES = ["HyperFrames.app", "HyperFrames Canary.app"];
export const DESKTOP_DOWNLOAD_URL = "https://hyperframes.dev/studio/download";
export const DOWNLOAD_HINT = `Edit it by chatting with Framey in HyperFrames Studio → ${DESKTOP_DOWNLOAD_URL}`;

// ponytail: released apps ignore a handed-over folder until hyperframes-internal#2601 ships. Until then nothing
// opens or writes a hand-off, and every surface (CLI, preview route, Studio's button) offers the download.
export const HANDOFF_READY = false;

export interface AgentSession {
  engine: "claude" | "codex";
  sessionId: string;
}

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
  | {
      opened: false;
      reason: "handoff-unavailable" | "unsupported-platform" | "not-installed" | "open-failed";
      downloadUrl: string;
    };

const openWithBundle = (bundleId: string, dir: string): boolean =>
  spawnSync("open", ["-b", bundleId, dir], { stdio: "ignore" }).status === 0;

/** The app reads the hand-off at its first chat send, so a project it cannot be written to just opens without it. */
function leaveHandoff(dir: string, session: AgentSession | null): AgentSession | null {
  if (!session) return null;
  try {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, AGENT_HANDOFF_FILE), JSON.stringify(session));
    return session;
  } catch {
    return null;
  }
}

// ponytail: macOS only; the Windows app needs its own hand-off (argv on second-instance) before this grows a branch.
export function openInDesktop(
  dir: string,
  {
    ready = HANDOFF_READY,
    platform = process.platform,
    open = openWithBundle,
    installed = () => desktopInstalled({ platform }),
    env = process.env,
  }: {
    ready?: boolean;
    platform?: string;
    open?: (bundleId: string, dir: string) => boolean;
    installed?: () => boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): DesktopOpenResult {
  const notOpened = (
    reason: Extract<DesktopOpenResult, { opened: false }>["reason"],
  ): DesktopOpenResult => ({ opened: false, reason, downloadUrl: DESKTOP_DOWNLOAD_URL });
  if (!ready) return notOpened("handoff-unavailable");
  if (platform !== "darwin") return notOpened("unsupported-platform");
  const bundleId = DESKTOP_BUNDLE_IDS.find((id) => open(id, dir));
  if (!bundleId) return notOpened(installed() ? "open-failed" : "not-installed");
  return { opened: true, bundleId, handedOver: leaveHandoff(dir, agentSession(env)) };
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

/** Whether this Mac has the app, without launching it: where the DMG and the installer put it, else Spotlight. */
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

/** The line render and preview print about the app; null inside the app (its agent runs set the variable). */
export function desktopHint(
  dir: string,
  {
    env = process.env,
    ready = HANDOFF_READY,
    installed,
  }: { env?: NodeJS.ProcessEnv; ready?: boolean; installed?: boolean } = {},
): string | null {
  if (env.HYPERFRAMES_DESKTOP_PROJECT) return null;
  return ready && (installed ?? desktopInstalled())
    ? `Edit it with Framey: ${openCommandFor(dir)}`
    : DOWNLOAD_HINT;
}
