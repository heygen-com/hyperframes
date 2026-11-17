// The skills check's `git ls-remote` never reads a repository's config from the folder it runs in.
// Real git, offline: the person's own config sends all of GitHub to a local "honest" copy, and the
// project's repo config (bare layout, or a .git above the folder) sends this one repo, a longer and
// so winning rule, to a "planted" one.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSkills, MANIFEST_FILE } from "./skillsManifest.js";

const REMOTE = "https://github.com/heygen-com/hyperframes.git";
const RAW = "https://raw.githubusercontent.com/heygen-com/hyperframes";

let root: string;
let startDir: string;

const git = (cwd: string, ...args: string[]) => {
  const { GIT_DIR: _, ...env } = process.env;
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
};

/** A repo whose main has one commit named for it; returns that commit. */
function repoWithMain(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", dir);
  return git(dir, "rev-parse", "HEAD");
}

const rewrite = (configFile: string, to: string, from: string) =>
  git(root, "config", "--file", configFile, `url.${to}.insteadOf`, from);
const sendGitHubTo = (configFile: string, repo: string) =>
  rewrite(configFile, pathToFileURL(repo).href, REMOTE);

const layouts: Record<string, (planted: string) => string> = {
  "a bare-layout repo": (planted) => {
    const project = join(root, "bare-project");
    mkdirSync(project);
    git(project, "init", "-q", "--bare", ".");
    sendGitHubTo(join(project, "config"), planted);
    return project;
  },
  "a folder inside a repo": (planted) => {
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q");
    sendGitHubTo(join(repo, ".git", "config"), planted);
    const project = join(repo, "film");
    mkdirSync(project);
    return project;
  },
  // As in a command run from one of the project's git hooks.
  "a repo an inherited GIT_DIR names": (planted) => {
    const repo = join(root, "hooked");
    mkdirSync(repo);
    git(repo, "init", "-q");
    sendGitHubTo(join(repo, ".git", "config"), planted);
    vi.stubEnv("GIT_DIR", join(repo, ".git"));
    const project = join(root, "film");
    mkdirSync(project);
    return project;
  },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skills-git-folder-"));
  startDir = process.cwd();
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(root, "person.gitconfig"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ skills: {} }) })),
  );
});
afterEach(() => {
  process.chdir(startDir);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("the skills check's main lookup", () => {
  it.each(Object.keys(layouts))("reads no git config from %s", async (layout) => {
    const honest = repoWithMain(join(root, "github", "heygen-com", "hyperframes.git"));
    const planted = repoWithMain(join(root, "planted"));
    const github = `${pathToFileURL(join(root, "github")).href}/`;
    rewrite(join(root, "person.gitconfig"), github, "https://github.com/");
    expect(planted).not.toBe(honest);
    const project = layouts[layout]!(join(root, "planted"));
    process.chdir(project);

    // A prerelease has no release tag, so the check pins main through git.
    await checkSkills({
      home: join(root, "home"),
      canonical: true,
      cliVersion: "0.9.59-alpha.1",
    });

    const fetched = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(fetched).toEqual([`${RAW}/${honest}/${MANIFEST_FILE}`]);
    expect(fetched.join(" ")).not.toContain(planted);
  });
});
