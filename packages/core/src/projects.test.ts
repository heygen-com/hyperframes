import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findProjects, type FoundProject } from "./projects";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

function tree(files: string[]): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-find-projects-")));
  roots.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), file.endsWith(".git") ? "gitdir: ../.git/modules/x" : "");
  }
  return root;
}

async function find(root: string, spotlight: string[] = []): Promise<FoundProject[]> {
  const found: FoundProject[] = [];
  await findProjects({
    root,
    onProject: (project) => found.push(project),
    spotlight: async () => spotlight.map((path) => join(root, path)),
  });
  return found;
}

const paths = (root: string, found: FoundProject[]) =>
  found.map((project) => relative(root, project.path).split(sep).join("/")).sort();

describe("findProjects", () => {
  it("finds a folder with index.html and a project marker, and nothing else", async () => {
    const root = tree([
      "film/index.html",
      "film/meta.json",
      "site/index.html",
      "notes/project.json",
    ]);

    const found = await find(root);

    expect(paths(root, found)).toEqual(["film"]);
    expect(found[0]).toMatchObject({ name: "film", source: "walk" });
    expect(Date.parse(found[0]!.mtime)).toBeGreaterThan(0);
  });

  it("skips node_modules and hidden folders", async () => {
    const root = tree([
      "app/node_modules/pkg/index.html",
      "app/node_modules/pkg/project.json",
      ".cache/film/index.html",
      ".cache/film/meta.json",
    ]);

    expect(await find(root)).toEqual([]);
  });

  it("skips a git worktree copy but walks a submodule", async () => {
    const root = tree([
      "repo-copy/film/index.html",
      "repo-copy/film/meta.json",
      "vendor/sub/.git",
      "vendor/sub/film/index.html",
      "vendor/sub/film/hyperframes.json",
    ]);
    writeFileSync(join(root, "repo-copy", ".git"), "gitdir: /src/repo/.git/worktrees/repo-copy\n");

    expect(paths(root, await find(root))).toEqual(["vendor/sub/film"]);
  });

  it("skips Library in the home folder but not a folder named Library elsewhere", async () => {
    const root = tree([
      "Library/film/index.html",
      "Library/film/meta.json",
      "Movies/Library/film/index.html",
      "Movies/Library/film/meta.json",
    ]);
    vi.stubEnv("HOME", root + sep);
    vi.stubEnv("USERPROFILE", root + sep);

    const found = await find(root, ["Library/film/meta.json", "Movies/Library/film/meta.json"]);

    expect(paths(root, found)).toEqual(["Movies/Library/film"]);
  });

  it("does not look for projects inside a project", async () => {
    const root = tree([
      "film/index.html",
      "film/hyperframes.json",
      "film/compositions/intro/index.html",
      "film/compositions/intro/meta.json",
    ]);

    expect(paths(root, await find(root))).toEqual(["film"]);
  });

  it("searches a root that is itself a git worktree copy", async () => {
    const root = tree(["film/index.html", "film/meta.json"]);
    writeFileSync(join(root, ".git"), "gitdir: /src/repo/.git/worktrees/copy\n");

    expect(paths(root, await find(root))).toEqual(["film"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "finishes past a symlink loop and an unreadable folder",
    async () => {
      const root = tree([
        "film/index.html",
        "film/meta.json",
        "locked/film/index.html",
        "locked/film/meta.json",
      ]);
      symlinkSync(root, join(root, "loop"), "dir");
      chmodSync(join(root, "locked"), 0o000);

      try {
        expect(paths(root, await find(root))).toEqual(["film"]);
      } finally {
        chmodSync(join(root, "locked"), 0o755);
      }
    },
  );

  it("fails on a root that is missing or not a folder instead of finding nothing", async () => {
    const root = tree(["file.txt"]);
    await expect(find(join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(find(join(root, "file.txt"))).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails on a root it may not read instead of finding nothing",
    async () => {
      const root = tree([]);
      chmodSync(root, 0o000);
      await expect(find(root)).rejects.toMatchObject({ code: "EACCES" });
    },
  );

  it("reports a Spotlight hit once, and only where the walk would also count it", async () => {
    const root = tree([
      "film/index.html",
      "film/meta.json",
      "film/compositions/intro/index.html",
      "film/compositions/intro/meta.json",
      "app/node_modules/pkg/index.html",
      "app/node_modules/pkg/project.json",
      "repo-copy/film/index.html",
      "repo-copy/film/meta.json",
      "readme/meta.json",
    ]);
    writeFileSync(join(root, "repo-copy", ".git"), "gitdir: /src/repo/.git/worktrees/repo-copy\n");

    const found = await find(root, [
      "film/meta.json",
      "film/compositions/intro/meta.json",
      "app/node_modules/pkg/project.json",
      "repo-copy/film/meta.json",
      "readme/meta.json",
      "../elsewhere/meta.json",
    ]);

    expect(paths(root, found)).toEqual(["film"]);
  });
});
