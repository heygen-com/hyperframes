// The skills check's `git ls-remote` never reads a repository's config from the folder it runs in.
// Real git, offline: the person's own config sends all of GitHub to a local "honest" copy, and the
// project's repo config (bare layout, or a .git above the folder) sends this one repo, a longer and
// so winning rule, to a "planted" one.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSkills, MANIFEST_FILE } from "./skillsManifest.js";

// A process start can take seconds on a busy Windows runner, so the fixture counts its git starts.
const fixtureGit = vi.hoisted(() => ({ starts: 0 }));
// The lookup's 4 s cut-off is for a person's network; on a busy Windows runner just starting git took longer,
// so the check fell back to main and this test read the wrong URL. Here git runs without that cut-off.
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = Object.assign(
    (...args: Parameters<typeof real.execFile>) => real.execFile(...args),
    {
      [promisify.custom]: (file: string, args: string[], options: object) =>
        promisify(real.execFile)(file, args, { ...options, timeout: 0 }),
    },
  );
  return {
    ...real,
    execFile: execFile as unknown as typeof real.execFile,
    execFileSync: ((...args: Parameters<typeof real.execFileSync>) => {
      fixtureGit.starts++;
      return real.execFileSync(...args);
    }) as typeof real.execFileSync,
  };
});

// Windows can keep a folder busy for a moment after the git that ran in it has exited.
const busyFolders = vi.hoisted(() => {
  const retriesAsked: number[] = [];
  return { prefix: "", retriesAsked };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const rm: typeof real.rm = async (path, options) => {
    if (!busyFolders.prefix || !String(path).includes(busyFolders.prefix))
      return real.rm(path, options);
    busyFolders.retriesAsked.push(options?.maxRetries ?? 0);
    await real.rm(path, options).catch(() => undefined);
    throw Object.assign(new Error("EBUSY: resource busy or locked, rmdir"), { code: "EBUSY" });
  };
  return { ...real, rm };
});

const REMOTE = "https://github.com/heygen-com/hyperframes.git";
const RAW = "https://raw.githubusercontent.com/heygen-com/hyperframes";

let root: string;
let startDir: string;
/** The two read-only repos every layout reads, made once: GitHub's honest copy and the planted one. */
let repos: string;
let honest: string;
let planted: string;

const git = (cwd: string, ...args: string[]) => {
  const { GIT_DIR: _, ...env } = process.env;
  return execFileSync("git", args, { cwd, encoding: "utf8", env }).trim();
};

/** A repo whose main has one commit named for it; returns that commit. */
function repoWithMain(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", dir);
  return readFileSync(join(dir, ".git", "refs", "heads", "main"), "utf8").trim();
}

const rewrite = (configFile: string, to: string, from: string) =>
  appendFileSync(configFile, `[url "${to}"]\n\tinsteadOf = ${from}\n`);
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

beforeAll(() => {
  repos = mkdtempSync(join(tmpdir(), "skills-git-repos-"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(repos, "none.gitconfig"));
  honest = repoWithMain(join(repos, "github", "heygen-com", "hyperframes.git"));
  planted = repoWithMain(join(repos, "planted"));
  vi.unstubAllEnvs();
});
afterAll(() => rmSync(repos, { recursive: true, force: true }));

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
  busyFolders.prefix = "";
  rmSync(root, { recursive: true, force: true });
});

describe("the skills check's main lookup", () => {
  it.each(Object.keys(layouts))("reads no git config from %s", async (layout) => {
    const before = fixtureGit.starts;
    const github = `${pathToFileURL(join(repos, "github")).href}/`;
    rewrite(join(root, "person.gitconfig"), github, "https://github.com/");
    expect(planted).not.toBe(honest);
    const project = layouts[layout]!(join(repos, "planted"));
    expect(fixtureGit.starts - before).toBe(1);
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

  it("still finds main when its own temp folder cannot be removed", async () => {
    const github = `${pathToFileURL(join(repos, "github")).href}/`;
    rewrite(join(root, "person.gitconfig"), github, "https://github.com/");
    busyFolders.prefix = "hyperframes-git-";
    busyFolders.retriesAsked.length = 0;

    await checkSkills({ home: join(root, "home"), canonical: true, cliVersion: "0.9.59-alpha.1" });

    expect(busyFolders.retriesAsked).toEqual([3]);
    const fetched = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(fetched).toEqual([`${RAW}/${honest}/${MANIFEST_FILE}`]);
  });
});
