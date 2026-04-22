/**
 * Detect how the running `hyperframes` binary was installed so auto-update can
 * re-use the same installer. Getting this wrong means either silently failing
 * to update or clobbering a Homebrew install with npm, so the classifier is
 * deliberately conservative — when unsure we return `skip` and leave the user
 * in charge.
 */

import { realpathSync } from "node:fs";
import { posix } from "node:path";

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
    posix.basename(posix.dirname(normalized)).startsWith("bunx-")
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
