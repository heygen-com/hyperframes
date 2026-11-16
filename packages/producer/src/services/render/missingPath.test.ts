import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeMissingPath } from "./missingPath.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temp folder laid out like a render's: the extract cache with one entry, and a work dir whose compiled frames link
 * into that entry. */
function layout() {
  const temp = mkdtempSync(join(tmpdir(), "hf-missing-"));
  roots.push(temp);
  const cacheRoot = join(temp, "hyperframes-extract-cache-u");
  const entry = join(cacheRoot, "hfcache-v10-abc");
  const work = join(temp, "hf-render-xyz");
  const link = join(work, "compiled", "__hyperframes_video_frames", "v1");
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, "frame_00001.jpg"), "x");
  mkdirSync(join(work, "compiled", "__hyperframes_video_frames"), { recursive: true });
  symlinkSync(entry, link, process.platform === "win32" ? "junction" : "dir");
  return { temp, cacheRoot, entry, work, linkedFrame: join(link, "frame_00002.jpg") };
}

const enoent = (path: string) =>
  Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
    code: "ENOENT",
    path,
  });

describe("describeMissingPath", () => {
  it("says only the file is gone when its folder is there", () => {
    const { temp, linkedFrame } = layout();
    expect(describeMissingPath(enoent(linkedFrame), { tempRoot: temp })).toEqual({
      scope: "file",
      synced: false,
      root: "system_temp",
    });
  });

  it("reads through a link to the cache entry that went", () => {
    const { temp, entry, linkedFrame } = layout();
    rmSync(entry, { recursive: true, force: true });
    expect(describeMissingPath(enoent(linkedFrame), { tempRoot: temp })?.scope).toBe("cache_entry");
  });

  it("names an unfinished cache entry that went", () => {
    const { temp, cacheRoot } = layout();
    const partial = join(cacheRoot, "hfcache-v10-def.partial-123");
    expect(
      describeMissingPath(enoent(join(partial, "frame_00001.jpg")), { tempRoot: temp })?.scope,
    ).toBe("cache_partial");
  });

  it("names the whole cache, the work folder and the temp folder when those went", () => {
    const { temp, cacheRoot, work, entry, linkedFrame } = layout();
    rmSync(cacheRoot, { recursive: true, force: true });
    expect(
      describeMissingPath(enoent(join(entry, "frame_00001.jpg")), { tempRoot: temp })?.scope,
    ).toBe("cache_root");
    rmSync(work, { recursive: true, force: true });
    expect(describeMissingPath(enoent(linkedFrame), { tempRoot: temp })?.scope).toBe("work_dir");
    rmSync(temp, { recursive: true, force: true });
    expect(describeMissingPath(enoent(linkedFrame), { tempRoot: temp })?.scope).toBe("temp_root");
  });

  it("says whether a sync app owns the path and which root it is under", () => {
    const synced = "C:\\Users\\a\\OneDrive - Contoso\\renders\\.frames\\frame_00001.jpg";
    expect(describeMissingPath(enoent(synced), { tempRoot: "C:\\Temp" })).toMatchObject({
      synced: true,
      root: "other",
    });
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-cache-dir-"));
    roots.push(cacheDir);
    expect(
      describeMissingPath(enoent(join(cacheDir, "hfcache-v10-a", "frame_00001.jpg")), {
        tempRoot: join(tmpdir(), "not-here"),
        cacheDir,
      })?.root,
    ).toBe("cache_dir");
  });

  it("says nothing when nothing was missing", () => {
    expect(describeMissingPath(new Error("Target closed"))).toBeUndefined();
  });
});
