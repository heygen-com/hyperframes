// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPrivateProjectFile, isWritableProjectFile, walkDir } from "./safePath";

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

describe("isWritableProjectFile and the project's package.json", () => {
  function projectRunning(pkg: object) {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "package.json"), JSON.stringify(pkg));
    return (path: string) => isWritableProjectFile(projectDir, join(projectDir, path));
  }

  it("refuses the script files package.json runs, in any spelling the write rule folds", () => {
    const writable = projectRunning({
      main: "server.js",
      bin: { tool: "./bin/tool.mjs" },
      scripts: { build: "node ./build.mjs && tsx scripts/gen.ts --out=dist", dev: "vite" },
    });
    for (const path of ["server.js", "Server.JS", "bin/tool.mjs", "build.mjs", "scripts/gen.ts"])
      expect(writable(path), path).toBe(false);
  });

  it("still writes composition scripts, folders and files package.json does not name", () => {
    const writable = projectRunning({ scripts: { build: "vite build --outDir dist" } });
    for (const path of ["script.js", "compositions/scene.js", "dist", "index.html"])
      expect(writable(path), path).toBe(true);
  });

  it("reads a package.json changed since the last write", () => {
    const projectDir = createProjectDir();
    const pkg = join(projectDir, "package.json");
    writeFileSync(pkg, JSON.stringify({ scripts: {} }));
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(true);
    writeFileSync(pkg, JSON.stringify({ scripts: { start: "node run.js" } }));
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(false);
  });

  it("writes as before when package.json is missing or not JSON", () => {
    const projectDir = createProjectDir();
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(true);
    writeFileSync(join(projectDir, "package.json"), "{ not json");
    expect(isWritableProjectFile(projectDir, join(projectDir, "run.js"))).toBe(true);
  });
});
