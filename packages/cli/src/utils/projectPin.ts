import { isSafeVersion } from "./safeVersion.js";

// Matches `hyperframes@<semver>` as a whole token inside a script string. The
// version class mirrors isSafeVersion's semver shape; capturing group 1 is the
// old version. `(?=\s|$)` keeps it from matching a longer package name.
export const HYPERFRAMES_PIN_RE =
  /\bhyperframes@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/g;

export interface PinRewriteResult {
  changed: boolean;
  scripts: Record<string, string>;
  fromVersions: string[];
}

export function readPinnedHyperframesVersions(scripts: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const cmd of Object.values(scripts ?? {})) {
    for (const m of cmd.matchAll(HYPERFRAMES_PIN_RE)) if (m[1]) found.add(m[1]);
  }
  return [...found].sort();
}

export function rewriteProjectPinnedScripts(
  scripts: Record<string, string>,
  targetVersion: string,
): PinRewriteResult {
  // Never emit an unverified version into a script the user (or npx) will run.
  if (!isSafeVersion(targetVersion)) {
    return { changed: false, scripts: { ...scripts }, fromVersions: [] };
  }
  const fromVersions = new Set<string>();
  const next: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(scripts ?? {})) {
    next[name] = cmd.replace(HYPERFRAMES_PIN_RE, (_full, version: string) => {
      if (version !== targetVersion) fromVersions.add(version);
      return `hyperframes@${targetVersion}`;
    });
  }
  return {
    changed: [...fromVersions].length > 0,
    scripts: next,
    fromVersions: [...fromVersions].sort(),
  };
}
