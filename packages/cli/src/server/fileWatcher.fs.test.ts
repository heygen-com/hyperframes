import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

  const watchProject = async () => {
    const seen: string[] = [];
    watcher = createProjectWatcher(dir);
    watcher.addListener((path) => seen.push(path));
    await new Promise((resolve) => setTimeout(resolve, 100));
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
    const seen = await watchProject();

    for (const path of ["index.html", join("compositions", "scene.html")]) {
      replaceByRename(join(dir, path), "stamped");
      await expectReported(seen, path);
      writeFileSync(join(dir, path), "edited in place");
      await expectReported(seen, path);
      replaceByRename(join(dir, path), "saved again");
      await expectReported(seen, path);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    "keeps watching the project when one subdirectory cannot be watched",
    async () => {
      dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
      mkdirSync(join(dir, "locked"));
      chmodSync(join(dir, "locked"), 0);
      writeFileSync(join(dir, "index.html"), "v0");
      const seen = await watchProject();
      chmodSync(join(dir, "locked"), 0o700);

      writeFileSync(join(dir, "index.html"), "v1");
      await expectReported(seen, "index.html");
    },
  );

  it("reports files in a directory created after it started", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-watch-"));
    const seen = await watchProject();

    mkdirSync(join(dir, "scenes"));
    await expectReported(seen, "scenes");
    writeFileSync(join(dir, "scenes", "new.html"), "v0");
    await expectReported(seen, join("scenes", "new.html"));
  });
});
