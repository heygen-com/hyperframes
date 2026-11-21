// Cloning the repo to read `skills/` costs ~80 MB of pack and ~400 MB of
// checkout, so keep a sparse checkout and hand out immutable snapshots of it.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  ensurePrivateCacheDir,
  foreignWritableTree,
  hyperframesCacheDir,
  trustedCacheRoot,
} from "@hyperframes/core/cache-dir";
import { copyDirSync } from "./copyDir.js";

const MIRROR_FORMAT = "1";

const SPARSE_PATH = "skills";
const GIT_TIMEOUT_MS = 300_000;

// Only abandoned snapshots go: an install reads its own for seconds.
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Both reach the filesystem or a git argv: no flags, no `ext::`, no `../`.
const PLAIN_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

// `HYPERFRAMES_SKILLS_MIRROR=0` restores the plain URL clone, for diagnosis.
const DISABLE_ENV = "HYPERFRAMES_SKILLS_MIRROR";

export interface SkillsRepoMirror {
  dir: string;
  created: boolean;
}

/** Root of the git checkout and its snapshots. */
export function skillsRepoMirrorDir(): string {
  return hyperframesCacheDir("skills-repo", MIRROR_FORMAT);
}

/** Lock attribution: an install from this tree is ours, whatever slug it lacks. */
export function isSkillsRepoMirrorPath(path: string | undefined): boolean {
  if (!path) return false;
  const candidate = resolve(path);
  const dir = resolve(skillsRepoMirrorDir());
  return candidate === dir || candidate.startsWith(dir + sep);
}

/** The snapshot to install `ref` from; null leaves the caller on the URL clone. */
export function ensureSkillsRepoMirror(opts: {
  url: string;
  ref: string;
  /** Test seam; defaults to {@link skillsRepoMirrorDir}. */
  dir?: string;
}): SkillsRepoMirror | null {
  const disabled = process.env[DISABLE_ENV]?.trim().toLowerCase();
  if (disabled === "0" || disabled === "false" || disabled === "off") return null;
  const ref = opts.ref.trim() || "main";
  if (!PLAIN_REF.test(ref)) return null;
  const root = opts.dir ?? skillsRepoMirrorDir();
  try {
    const mirror = join(root, "mirror");
    const sha = isCheckout(mirror) ? refresh(mirror, opts.url, ref) : build(mirror, opts.url, ref);
    return publishSnapshot(root, sha);
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

// Git reads config and hooks out of an existing checkout, and its skill files
// feed global agent instructions: same trust boundary as a fresh cache dir.
function isTrusted(dir: string): boolean {
  const root = resolve(trustedCacheRoot());
  const target = resolve(dir);
  const insideRoot = target === root || target.startsWith(root + sep);
  if (!insideRoot) return false;
  try {
    return foreignWritableTree(target, root) === undefined;
  } catch {
    return false;
  }
}

function git(cwd: string | undefined, args: string[]): string {
  return execFileSync("git", args, {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    env: {
      ...process.env,
      // The guards the `skills add` spawn carries: an LFS hook aborts clones, and
      // this repo's LFS objects are not part of the text we install.
      GIT_CLONE_PROTECTION_ACTIVE: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
    },
  });
}

/** Clone into a staging dir and rename, so an interrupted clone is never reused. */
function build(dir: string, url: string, ref: string): string {
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
    return headSha(dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function headSha(dir: string): string {
  const sha = git(dir, ["rev-parse", "HEAD"]).trim();
  if (!COMMIT_SHA.test(sha)) throw new Error(`unexpected commit from git: ${sha}`);
  return sha;
}

/** Fetch `ref`'s delta into the checkout and return the commit it landed on. */
function refresh(dir: string, url: string, ref: string): string {
  if (!isTrusted(dir)) throw new Error("skills checkout is not in a private cache");
  const target = ref === "main" ? "FETCH_HEAD" : `refs/tags/${ref}`;
  const spec =
    ref === "main" ? "+refs/heads/main:refs/remotes/origin/main" : `+${target}:${target}`;
  // A mirror built from one URL must not silently start tracking another.
  const origin = git(dir, ["remote", "get-url", "origin"]).trim();
  if (origin !== url) git(dir, ["remote", "set-url", "origin", url]);
  git(dir, ["fetch", "--quiet", "--depth=1", "origin", spec]);
  const want =
    ref === "main"
      ? git(dir, ["rev-parse", "FETCH_HEAD"]).trim()
      : git(dir, ["rev-parse", `${target}^{commit}`]).trim();
  git(dir, ["checkout", "--quiet", "--force", target]);
  const head = headSha(dir);
  if (head !== want) throw new Error(`skills checkout is at ${head}, wanted ${want}`);
  if (!existsSync(join(dir, SPARSE_PATH))) {
    throw new Error(`skills checkout at ${ref} has no ${SPARSE_PATH}/`);
  }
  return head;
}

/** Freeze the checkout's `skills/` at `sha`; a concurrent fetch cannot alter it. */
function publishSnapshot(root: string, sha: string): SkillsRepoMirror {
  if (!COMMIT_SHA.test(sha)) throw new Error(`unexpected commit from git: ${sha}`);
  const snapshots = join(root, "snapshots");
  const snapshot = join(snapshots, sha);
  const ready = () => existsSync(join(snapshot, SPARSE_PATH));
  if (ready()) return { dir: snapshot, created: false };
  ensurePrivateCacheDir(snapshots, trustedCacheRoot());
  const staging = `${snapshot}.partial-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    copyDirSync(join(root, "mirror", SPARSE_PATH), join(staging, SPARSE_PATH));
    // A concurrent publisher's snapshot holds the same bytes for this commit.
    if (!ready()) renameSync(staging, snapshot);
  } catch (error) {
    if (!ready()) throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  pruneSnapshots(snapshots, snapshot);
  return { dir: snapshot, created: true };
}

function pruneSnapshots(snapshots: string, keep: string): void {
  try {
    const now = Date.now();
    for (const name of readdirSync(snapshots)) {
      const path = join(snapshots, name);
      if (path === keep) continue;
      if (now - statSync(path).mtimeMs < SNAPSHOT_TTL_MS) continue;
      rmSync(path, { recursive: true, force: true });
    }
  } catch {
    // a snapshot we cannot prune is not worth failing an install over
  }
}
