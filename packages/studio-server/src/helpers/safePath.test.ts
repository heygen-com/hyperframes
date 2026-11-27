// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPrivateProjectFile,
  isWritableInProject,
  isWritableProjectFile,
  walkDir,
} from "./safePath";

const hooks = vi.hoisted(() => ({ unreadable: new Map<string, string>() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    readdirSync: ((dir: string, ...rest: unknown[]) => {
      const code = hooks.unreadable.get(dir);
      if (code) throw Object.assign(new Error(`${code}: ${dir}`), { code });
      return (fs.readdirSync as (...args: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync,
  };
});

const tempDirs: string[] = [];

afterEach(() => {
  hooks.unreadable.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-safe-path-"));
  tempDirs.push(projectDir);
  return projectDir;
}

describe("walkDir", () => {
  it("hides internal HyperFrames backup files from project listings", () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, ".hyperframes", "backup"), { recursive: true });
    mkdirSync(join(projectDir, ".hyperframes", "examples"), { recursive: true });
    mkdirSync(join(projectDir, ".cache", "examples"), { recursive: true });
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(join(projectDir, ".hyperframes", "backup", "snapshot.html"), "backup");
    writeFileSync(join(projectDir, ".hyperframes", "examples", "preset.html"), "preset");
    writeFileSync(join(projectDir, ".cache", "examples", "preset.html"), "preset");
    writeFileSync(join(projectDir, "compositions", "scene.html"), "scene");

    const files = walkDir(projectDir);
    expect(files).toContain(".cache/examples/preset.html");
    expect(files).toContain(".hyperframes/examples/preset.html");
    expect(files).toContain("compositions/scene.html");
    expect(files).not.toContain(".hyperframes/backup/snapshot.html");
  });

  it("hides a nested project's backup files too", () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "sub", ".HyperFrames", "Backup"), { recursive: true });
    writeFileSync(join(projectDir, "sub", ".HyperFrames", "Backup", "snapshot.html"), "backup");
    writeFileSync(join(projectDir, "sub", "index.html"), "sub");

    expect(walkDir(projectDir)).toEqual(["sub/index.html"]);
  });

  it("leaves a render's scratch dir out, so its compiled index.html is not listed as a composition", () => {
    const projectDir = createProjectDir();
    const work = join(projectDir, "work-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-Ab12Cd");
    mkdirSync(join(work, "compiled"), { recursive: true });
    writeFileSync(join(work, "compiled", "index.html"), "scratch");
    writeFileSync(join(projectDir, "index.html"), "root");
    writeFileSync(join(projectDir, "video.mp4"), "output");

    expect(walkDir(projectDir).sort()).toEqual(["index.html", "video.mp4"]);
  });

  it.each(["EACCES", "EPERM", "ENOENT", "ENOTDIR"])(
    "skips a subfolder whose listing fails with %s",
    (code) => {
      const projectDir = createProjectDir();
      mkdirSync(join(projectDir, "locked"));
      mkdirSync(join(projectDir, "compositions"));
      writeFileSync(join(projectDir, "locked", "hidden.html"), "hidden");
      writeFileSync(join(projectDir, "compositions", "scene.html"), "scene");
      writeFileSync(join(projectDir, "index.html"), "root");
      hooks.unreadable.set(join(projectDir, "locked"), code);

      expect(walkDir(projectDir).sort()).toEqual(["compositions/scene.html", "index.html"]);
    },
  );

  it("still throws when a subfolder fails for another reason", () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "busy"));
    hooks.unreadable.set(join(projectDir, "busy"), "EMFILE");

    expect(() => walkDir(projectDir)).toThrow("EMFILE");
  });

  it("still throws when the project folder itself cannot be listed", () => {
    const projectDir = createProjectDir();
    hooks.unreadable.set(projectDir, "EACCES");

    expect(() => walkDir(projectDir)).toThrow("EACCES");
  });
});

describe("isPrivateProjectFile", () => {
  it("names everything under .hyperframes/ but Studio's own files and request pictures, in any case", () => {
    for (const name of [
      "agent-handoff.json",
      "agent-handoff-read.json",
      "app-history-seen.json",
      "share.json",
    ])
      expect(isPrivateProjectFile("/p", `/p/.hyperframes/${name}`)).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/.HyperFrames/App-History.JSONL")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/studio-motion.json")).toBe(false);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/studio-manual-edits.json")).toBe(false);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/prepared-assets/gif/a.mp4")).toBe(false);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/prepared-assets")).toBe(false);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/requests/1/before.png")).toBe(false);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/requests-old/x")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/prepared-assets/downloads/a.gif")).toBe(
      true,
    );
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/Prepared-Assets/DOWNLOADS/a.gif")).toBe(
      true,
    );
    expect(isPrivateProjectFile("/p", "/p/.hyperframes/prepared-assets/downloads")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/agent-handoff.json")).toBe(false);
  });

  it("names a nested project's .hyperframes/ records, Studio's file names included", () => {
    expect(isPrivateProjectFile("/p", "/p/sub/.hyperframes/app-history.jsonl")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/a/b/.hyperframes/agent-handoff.json")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/sub/.hyperframes/studio-motion.json")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/sub/.hyperframes/prepared-assets/gif/a.mp4")).toBe(true);
    expect(isPrivateProjectFile("/p", "/p/sub/index.html")).toBe(false);
  });
});

describe("isWritableProjectFile and Node tooling", () => {
  function projectWith(pkg: object | string, folder = "") {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, folder), { recursive: true });
    const text = typeof pkg === "string" ? pkg : JSON.stringify(pkg);
    writeFileSync(join(projectDir, folder, "package.json"), text);
    const writable = (path: string) => isWritableProjectFile(projectDir, join(projectDir, path));
    return Object.assign(writable, { projectDir });
  }
  const SCAFFOLD = {
    name: "demo",
    private: true,
    type: "module",
    scripts: {
      dev: "npx --yes hyperframes@1.2.3 preview",
      check:
        "npx --yes hyperframes lint && npx --yes hyperframes validate && npx --yes hyperframes inspect",
      render: "npx hyperframes render --quality high",
    },
  };

  it("refuses Node-only scripts in any project, in any spelling the write rule folds", () => {
    const writable = projectWith(SCAFFOLD);
    for (const path of [
      "a.ts",
      "A.TS",
      "b.d.ts",
      "c.mts",
      "d.cts",
      "e.tsx",
      "f.jsx",
      "g.cjs",
      "h.ts.",
    ])
      expect(writable(path), path).toBe(false);
  });

  it("writes composition scripts below a package.json that only runs hyperframes", () => {
    const writable = projectWith(SCAFFOLD);
    for (const path of ["script.js", "assets/three.module.min.mjs", "lib/x.iife.js", "index.html"])
      expect(writable(path), path).toBe(true);
  });

  it.each([
    ["a script of its own", { ...SCAFFOLD, scripts: { build: "vite build" } }],
    [
      "a hyperframes script chained to another",
      { scripts: { dev: "npx hyperframes preview; node x" } },
    ],
    ["a main entry", { name: "demo", main: "index" }],
    ["a bin", { bin: { tool: "tool" } }],
    ["dependencies", { name: "demo", devDependencies: { vitest: "^4.0.0" } }],
    ["workspaces", { workspaces: ["packages/*"] }],
    ["scripts that are not strings", { scripts: { dev: ["hyperframes"] } }],
    ["a manifest that is not JSON", "{ not json"],
    ["a manifest that is not an object", "[]"],
  ])("refuses .js and .mjs below a package.json with %s", (_, pkg) => {
    const writable = projectWith(pkg);
    for (const path of ["script.js", "Script.JS", "deep/er/x.mjs"])
      expect(writable(path), path).toBe(false);
    expect(writable("index.html")).toBe(true);
  });

  it("refuses scripts below a nested package.json and leaves the rest of the project writable", () => {
    const writable = projectWith({ scripts: { gen: "node gen.js" } }, "tools");
    expect(writable("tools/gen.js")).toBe(false);
    expect(writable("tools/sub/helper.mjs")).toBe(false);
    expect(writable("script.js")).toBe(true);
  });

  it("refuses scripts in a project inside a folder whose package.json brings Node tooling", () => {
    const parent = createProjectDir();
    writeFileSync(
      join(parent, "package.json"),
      JSON.stringify({ scripts: { build: "node apps/video/run.js" } }),
    );
    const projectDir = join(parent, "apps", "video");
    mkdirSync(projectDir, { recursive: true });
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(false);
    expect(isWritableProjectFile(projectDir, join(projectDir, "index.html"))).toBe(true);
  });

  it("reads a package.json changed since the last write", () => {
    const projectDir = createProjectDir();
    const pkg = join(projectDir, "package.json");
    writeFileSync(pkg, JSON.stringify(SCAFFOLD));
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(true);
    writeFileSync(pkg, JSON.stringify({ ...SCAFFOLD, scripts: { start: "node run.js" } }));
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(false);
  });

  it("refuses extensionless files below a package.json with tooling, but not folders of that name", () => {
    const writable = projectWith({ main: "server/start" });
    for (const path of ["server/start", "server/Start.", "bin/www", "config"])
      expect(writable(path), path).toBe(false);
    mkdirSync(join(writable.projectDir, "assets"));
    expect(writable("assets")).toBe(true);
    expect(isWritableInProject(writable.projectDir, "new-folder", "folder")).toBe(true);
    expect(isWritableInProject(writable.projectDir, "new-folder", "file")).toBe(false);
  });

  it("writes extensionless files below a package.json that only runs hyperframes", () => {
    const writable = projectWith(SCAFFOLD);
    for (const path of ["server/start", "notes"]) expect(writable(path), path).toBe(true);
  });

  it("writes composition scripts when no package.json covers them", () => {
    const projectDir = createProjectDir();
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(true);
  });
});
