// The installer reads `skills/`; cloning the repo around it costs ~80 MB of pack
// and ~400 MB of checkout. Keep a sparse, blob-filtered checkout of `skills/`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  ensurePrivateCacheDir,
  hyperframesCacheDir,
  trustedCacheRoot,
} from "@hyperframes/core/cache-dir";

const MIRROR_FORMAT = "1";

const SPARSE_PATH = "skills";
const GIT_TIMEOUT_MS = 300_000;

// The ref reaches a git argv: no flag-like or `ext::` transport values.
const PLAIN_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// `HYPERFRAMES_SKILLS_MIRROR=0` restores the plain URL clone, for diagnosis.
const DISABLE_ENV = "HYPERFRAMES_SKILLS_MIRROR";

export interface SkillsRepoMirror {
  dir: string;
  created: boolean;
}

export function skillsRepoMirrorDir(): string {
  return hyperframesCacheDir("skills-repo", MIRROR_FORMAT);
}

/** Lock attribution: an install from this path is ours, whatever slug it lacks. */
export function isSkillsRepoMirrorPath(path: string | undefined): boolean {
  if (!path) return false;
  const candidate = resolve(path);
  const dir = resolve(skillsRepoMirrorDir());
  return candidate === dir || candidate.startsWith(dir + sep);
}

/** The checkout to install `ref` from; null leaves the caller on the URL clone. */
export function ensureSkillsRepoMirror(opts: {
  url: string;
  ref: string;
  dir?: string;
}): SkillsRepoMirror | null {
  const disabled = process.env[DISABLE_ENV]?.trim().toLowerCase();
  if (disabled === "0" || disabled === "false" || disabled === "off") return null;
  const ref = opts.ref.trim() || "main";
  if (!PLAIN_REF.test(ref)) return null;
  const dir = opts.dir ?? skillsRepoMirrorDir();
  try {
    if (isCheckout(dir)) {
      refresh(dir, opts.url, ref);
      return { dir, created: false };
    }
    build(dir, opts.url, ref);
    return { dir, created: true };
  } catch {
    return null;
  }
}

export function publishedSkillNames(dir: string | undefined): string[] {
  if (!dir) return [];
  try {
    return readdirSync(join(dir, SPARSE_PATH), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(dir, SPARSE_PATH, entry.name, "SKILL.md")),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isCheckout(dir: string): boolean {
  return existsSync(join(dir, ".git")) && existsSync(join(dir, SPARSE_PATH));
}

function git(cwd: string | undefined, args: string[]): string {
  return execFileSync("git", args, {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    env: {
      ...process.env,
      // The two guards the `skills add` spawn carries: an LFS post-checkout hook
      // aborts clones, and this repo's LFS objects are not needed here.
      GIT_CLONE_PROTECTION_ACTIVE: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
    },
  });
}

/** Clone into a staging dir and rename, so an interrupted clone is never reused. */
function build(dir: string, url: string, ref: string): void {
  ensurePrivateCacheDir(dirname(dir), trustedCacheRoot());
  const staging = `${dir}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    git(undefined, [
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--depth=1",
      "--sparse",
      "--single-branch",
      "--branch",
      ref,
      url,
      staging,
    ]);
    git(staging, ["sparse-checkout", "set", SPARSE_PATH]);
    if (!existsSync(join(staging, SPARSE_PATH))) {
      throw new Error(`skills checkout at ${ref} has no ${SPARSE_PATH}/`);
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function refresh(dir: string, url: string, ref: string): void {
  const target = ref === "main" ? "FETCH_HEAD" : `refs/tags/${ref}`;
  const spec = ref === "main" ? "+refs/heads/main:refs/remotes/origin/main" : `+${target}:${target}`;
  // A mirror built from one URL must not silently start tracking another.
  const origin = git(dir, ["remote", "get-url", "origin"]).trim();
  if (origin !== url) git(dir, ["remote", "set-url", "origin", url]);
  git(dir, ["fetch", "--quiet", "--depth=1", "origin", spec]);
  const want =
    ref === "main"
      ? git(dir, ["rev-parse", "FETCH_HEAD"]).trim()
      : git(dir, ["rev-parse", `${target}^{commit}`]).trim();
  git(dir, ["checkout", "--quiet", "--force", target]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  if (head !== want) throw new Error(`skills checkout is at ${head}, wanted ${want}`);
  if (!existsSync(join(dir, SPARSE_PATH))) {
    throw new Error(`skills checkout at ${ref} has no ${SPARSE_PATH}/`);
  }
}
