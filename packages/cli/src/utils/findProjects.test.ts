import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjects, type FoundProject } from "./findProjects.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

function tree(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "hf-find-projects-"));
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
  found.map((project) => project.path.slice(root.length + 1)).sort();

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

  it.skipIf(process.getuid?.() === 0)(
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
