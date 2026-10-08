import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectWatcher, type ProjectWatcher } from "./fileWatcher.js";

// Real files, no fs mock: the failure lives in how the OS watch tracks a replaced inode.
describe("createProjectWatcher on a real directory", () => {
  let dir = "";
  let watcher: ProjectWatcher | null = null;

  afterEach(() => {
    watcher?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const watchProject = (projectDir = dir) => {
    const seen: string[] = [];
    watcher = createProjectWatcher(projectDir);
    watcher.addListener((path) => seen.push(path));
    return seen;
  };
  const expectReported = async (seen: string[], path: string) => {
    await vi.waitFor(() => expect(seen).toContain(path), { timeout: 3000, interval: 25 });
    seen.length = 0;
  };
  const replaceByRename = (path: string, text: string) => {
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  };

  it("keeps reporting a file after an atomic save replaced it", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
    mkdirSync(join(dir, "compositions"));
    writeFileSync(join(dir, "index.html"), "v0");
    writeFileSync(join(dir, "compositions", "scene.html"), "v0");
    const seen = watchProject();

    for (const path of ["index.html", join("compositions", "scene.html")]) {
      replaceByRename(join(dir, path), "stamped");
      await expectReported(seen, path);
      writeFileSync(join(dir, path), "edited in place");
      await expectReported(seen, path);
      replaceByRename(join(dir, path), "saved again");
      await expectReported(seen, path);
    }
  });

  it.runIf(process.platform === "linux")(
    "follows a project folder replaced by rename",
    async () => {
      dir = mkdtempSync(join(tmpdir(), "hf-watch-root-"));
      const project = join(dir, "project");
      const replacement = join(dir, "replacement");
      mkdirSync(project);
      mkdirSync(join(replacement, "scenes"), { recursive: true });
      writeFileSync(join(project, "index.html"), "before");
      writeFileSync(join(replacement, "index.html"), "after");
      writeFileSync(join(replacement, "scenes", "intro.html"), "new scene");
      const seen = watchProject(project);

      renameSync(project, join(dir, "previous"));
      renameSync(replacement, project);
      await expectReported(seen, ".");
      writeFileSync(join(project, "index.html"), "edited root");
      await expectReported(seen, "index.html");
      writeFileSync(join(project, "scenes", "intro.html"), "edited scene");
      await expectReported(seen, join("scenes", "intro.html"));
    },
  );

  it.runIf(process.platform === "linux")(
    "re-arms after the project path is absent between replacements",
    async () => {
      dir = mkdtempSync(join(tmpdir(), "hf-watch-gap-"));
      const project = join(dir, "project");
      mkdirSync(project);
      writeFileSync(join(project, "index.html"), "before");
      const seen = watchProject(project);

      renameSync(project, join(dir, "previous"));
      await expectReported(seen, ".");
      mkdirSync(project);
      writeFileSync(join(project, "index.html"), "after");
      await expectReported(seen, ".");
      writeFileSync(join(project, "index.html"), "later edit");
      await expectReported(seen, "index.html");
    },
  );

  it.runIf(process.platform === "linux")(
    "follows a replaced subdirectory's new inode",
    async () => {
      dir = mkdtempSync(join(tmpdir(), "hf-watch-subdir-"));
      const scenes = join(dir, "scenes");
      mkdirSync(scenes);
      mkdirSync(join(dir, "replacement"));
      writeFileSync(join(scenes, "intro.html"), "before");
      writeFileSync(join(dir, "replacement", "intro.html"), "after");
      const seen = watchProject();

      renameSync(scenes, join(dir, "previous"));
      renameSync(join(dir, "replacement"), scenes);
      await expectReported(seen, "scenes");
      writeFileSync(join(scenes, "intro.html"), "later edit");
      await expectReported(seen, join("scenes", "intro.html"));
    },
  );

  it("reports Studio's manifest writes inside .hyperframes", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
    mkdirSync(join(dir, ".hyperframes"));
    const seen = watchProject();

    writeFileSync(join(dir, ".hyperframes", "studio-motion.json"), "{}");
    await expectReported(seen, join(".hyperframes", "studio-motion.json"));
  });

  it("keeps watching a sibling whose name starts with a removed directory's", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
    mkdirSync(join(dir, "scene"));
    mkdirSync(join(dir, "scenes"));
    const seen = watchProject();

    rmSync(join(dir, "scene"), { recursive: true });
    await expectReported(seen, "scene");
    writeFileSync(join(dir, "scenes", "a.html"), "v1");
    await expectReported(seen, join("scenes", "a.html"));
  });

  it("reports files in a directory created after it started", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
    const seen = watchProject();

    mkdirSync(join(dir, "scenes"));
    await expectReported(seen, "scenes");
    writeFileSync(join(dir, "scenes", "new.html"), "v0");
    await expectReported(seen, join("scenes", "new.html"));
  });
});
