/**
 * Detect how the running `hyperframes` binary was installed so auto-update can
 * re-use the same installer. Getting this wrong means either silently failing
 * to update or clobbering a Homebrew install with npm, so the classifier is
 * deliberately conservative — when unsure we return `skip` and leave the user
 * in charge.
 */

import { existsSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { isSafeVersion } from "./safeVersion.js";

export type InstallerKind = "npm" | "bun" | "pnpm" | "brew" | "skip";

export interface InstallerInfo {
  kind: InstallerKind;
  /** Full command to install the given version, or null when `kind === "skip"`. */
  installCommand: (version: string) => string | null;
  /** Human-readable reason for debug logging / doctor output. */
  reason: string;
}

/**
 * `process.argv[1]` points at the CLI entry script but on global installs the
 * entry is usually a shim in a `bin/` dir that symlinks to the real install
 * under `lib/node_modules/`. Resolve through the symlink so the classifier
 * sees the canonical install prefix.
 */
function resolveEntry(): string | null {
  const entry = process.argv[1];
  if (!entry) return null;
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** True when running from a monorepo workspace link (pnpm/bun/yarn `dev:link`). */
function isWorkspaceLink(realEntry: string): boolean {
  const normalized = normalizePath(realEntry);
  // Resolved path lands inside the repo, typically .../packages/cli/...
  // A real global install never contains `/packages/` because npm publish
  // collapses the package into a flat tarball.
  return normalized.includes("/packages/cli/");
}

/**
 * True when invoked via `npx hyperframes` / `bunx hyperframes`. These don't
 * persist an install, so auto-update is a no-op — the user gets the latest
 * version on the next invocation anyway.
 */
function isEphemeralExec(realEntry: string): boolean {
  const normalized = normalizePath(realEntry);
  // npm's npx caches into `<prefix>/_npx/<hash>/`; bun uses `bunx-<uid>-…`.
  return (
    normalized.includes("/_npx/") ||
    normalized.includes("/.npm/_npx/") ||
    posix.basename(posix.dirname(normalized)).startsWith("bunx-") ||
    // bunx installs the package under its temp dir: `/tmp/bunx-<uid>-<spec>/node_modules/…`.
    /\/bunx-[^/]+\/node_modules\//.test(normalized)
  );
}

/**
 * True when the binary was linked into Homebrew's install tree. Homebrew
 * symlinks `/opt/homebrew/bin/hyperframes` into `…/Cellar/hyperframes/<v>/…`
 * (or `/usr/local/Cellar/` on Intel). Either path wins the match.
 */
function isHomebrewInstall(realEntry: string): boolean {
  return normalizePath(realEntry).includes("/Cellar/hyperframes/");
}

/**
 * Classify the install by walking the resolved entry path against each
 * package manager's well-known global prefix signature.
 */
export function detectInstaller(): InstallerInfo {
  const realEntry = resolveEntry();
  if (!realEntry) {
    return {
      kind: "skip",
      installCommand: () => null,
      reason: "Could not resolve process entry path",
    };
  }

  const normalizedEntry = normalizePath(realEntry);

  if (isWorkspaceLink(realEntry)) {
    return {
      kind: "skip",
      installCommand: () => null,
      reason: "Running from a workspace link (monorepo dev)",
    };
  }

  if (isEphemeralExec(realEntry)) {
    return {
      kind: "skip",
      installCommand: () => null,
      reason: "Running via ephemeral exec (npx / bunx)",
    };
  }

  if (isHomebrewInstall(realEntry)) {
    return {
      kind: "brew",
      // Updating a brew formula isn't a straight `install`; the formula needs
      // to have been published. Defer to `brew upgrade` which is a no-op if
      // the tap hasn't caught up.
      installCommand: () => "brew upgrade hyperframes",
      reason: `Homebrew install detected at ${realEntry}`,
    };
  }

  // bun's global install prefix is `~/.bun/install/global/node_modules/` and
  // the bin shim lives at `~/.bun/bin/`. Both paths contain `.bun`.
  if (normalizedEntry.includes("/.bun/")) {
    return {
      kind: "bun",
      installCommand: (version) => `bun add -g hyperframes@${version}`,
      reason: `bun global install detected at ${realEntry}`,
    };
  }

  // pnpm's global prefix is typically `~/Library/pnpm/global/5/node_modules/`
  // on macOS or `~/.local/share/pnpm/global/…` on Linux. `pnpm` wins when the
  // path contains `/pnpm/global/` regardless of platform.
  if (normalizedEntry.includes("/pnpm/global/")) {
    return {
      kind: "pnpm",
      installCommand: (version) => `pnpm add -g hyperframes@${version}`,
      reason: `pnpm global install detected at ${realEntry}`,
    };
  }

  // npm's default global prefix is `<prefix>/lib/node_modules/hyperframes/…`
  // where `<prefix>` is `/usr/local` (macOS Intel), `/opt/homebrew` (Apple
  // Silicon, non-brew-formula npm), or a user-configured directory.
  if (
    normalizedEntry.includes("/lib/node_modules/hyperframes/") ||
    normalizedEntry.includes("/npm/node_modules/hyperframes/")
  ) {
    return {
      kind: "npm",
      installCommand: (version) => `npm install -g hyperframes@${version}`,
      reason: `npm global install detected at ${realEntry}`,
    };
  }

  return {
    kind: "skip",
    installCommand: () => null,
    reason: `Unknown install layout at ${realEntry}`,
  };
}

/** Argv-shaped install command for a no-shell `execFile`. */
export interface InstallInvocation {
  bin: string;
  args: string[];
}

/**
 * The argv form of {@link InstallerInfo.installCommand}, kept next to the
 * detector so the command we *run* (execFile, no shell) and the command we
 * *display* (installCommand string) can never drift. Returns `null` for `skip`
 * kinds (ephemeral npx/bunx, workspace links, project-local, unknown layouts):
 * the caller must print a manual instruction rather than run a guessed command
 * (running the wrong manager is worse than running nothing).
 */
export function installInvocation(kind: InstallerKind, version: string): InstallInvocation | null {
  switch (kind) {
    case "npm":
      return { bin: "npm", args: ["install", "-g", `hyperframes@${version}`] };
    case "bun":
      return { bin: "bun", args: ["add", "-g", `hyperframes@${version}`] };
    case "pnpm":
      return { bin: "pnpm", args: ["add", "-g", `hyperframes@${version}`] };
    case "brew":
      // brew has no per-version install; `brew upgrade` moves to the tap's
      // current formula (a no-op if the tap hasn't caught up).
      return { bin: "brew", args: ["upgrade", "hyperframes"] };
    case "skip":
      return null;
  }
}

/**
 * Where the running binary came from, as `doctor` and `update` report it. Unlike
 * {@link detectInstaller}, which only answers "can a background install own this?",
 * this names every layout, including the ones auto-update leaves alone.
 */
export type InstallChannel =
  | "npm"
  | "pnpm"
  | "bun"
  | "brew"
  | "npx"
  | "project"
  | "workspace"
  | "plugin"
  | "unknown";

export interface RunningInstall {
  channel: InstallChannel;
  /** The resolved entry script that is running, or null when it cannot be resolved. */
  path: string | null;
}

const CHANNEL_LABELS: Record<InstallChannel, string> = {
  npm: "npm global install",
  pnpm: "pnpm global install",
  bun: "bun global install",
  brew: "Homebrew install",
  npx: "npx / bunx (temporary cache)",
  project: "project-local install (node_modules)",
  workspace: "workspace link (monorepo dev)",
  plugin: "agent plugin (version pinned by the plugin)",
  unknown: "unrecognized install layout",
};

/** Human label for a channel, e.g. "npm global install". */
export function installChannelLabel(channel: InstallChannel): string {
  return CHANNEL_LABELS[channel];
}

/** Classify the running binary: global (per manager), project-local, npx, workspace link or plugin. */
export function runningInstall(): RunningInstall {
  const path = resolveEntry();
  // plugin-cli.mjs runs a pinned `npx hyperframes@<version>` and marks the child with this.
  if (process.env["HYPERFRAMES_PLUGIN_VERSION"]) return { channel: "plugin", path };
  const installer = detectInstaller();
  if (installer.kind !== "skip") return { channel: installer.kind, path };
  if (!path) return { channel: "unknown", path };
  if (isWorkspaceLink(path)) return { channel: "workspace", path };
  if (isEphemeralExec(path)) return { channel: "npx", path };
  if (normalizePath(path).includes("/node_modules/hyperframes/")) {
    return { channel: "project", path };
  }
  return { channel: "unknown", path };
}

const PROJECT_LOCKFILES: [string, (spec: string) => string][] = [
  ["bun.lock", (spec) => `bun add ${spec}`],
  ["bun.lockb", (spec) => `bun add ${spec}`],
  ["pnpm-lock.yaml", (spec) => `pnpm add ${spec}`],
  ["yarn.lock", (spec) => `yarn add ${spec}`],
];

/**
 * What moves a project-local CLI: its project's manager (named by the lockfile beside the
 * project's `node_modules`, npm without one) adding `hyperframes@<version>`. Each of the four
 * keeps the dependency in the section it is in. `upgrade --project` only rewrites script pins.
 */
function projectInstallCommand(path: string, version: string): string {
  const normalized = normalizePath(path);
  const root = normalized.slice(0, normalized.indexOf("/node_modules/"));
  const spec = `hyperframes@${version}`;
  const lockfile = PROJECT_LOCKFILES.find(([name]) => existsSync(posix.join(root, name)));
  return lockfile ? lockfile[1](spec) : `npm install ${spec}`;
}

/**
 * The command that moves this install to `latest`: the owning manager's for a global or
 * project-local install, `npx hyperframes@latest` everywhere a manager command would not apply.
 */
export function updateCommandFor(install: RunningInstall, latest: string): string {
  if (install.channel === "plugin") return "update the HyperFrames plugin in your agent";
  if (install.channel === "brew") return "brew upgrade hyperframes";
  if (install.channel === "project" && install.path && isSafeVersion(latest)) {
    return projectInstallCommand(install.path, latest);
  }
  const kind = install.channel;
  if (kind === "npm" || kind === "pnpm" || kind === "bun") {
    const invocation = installInvocation(kind, latest);
    if (invocation) return `${invocation.bin} ${invocation.args.join(" ")}`;
  }
  return "npx hyperframes@latest";
}
