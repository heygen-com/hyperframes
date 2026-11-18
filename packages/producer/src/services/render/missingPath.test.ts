import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describeMissingPath } from "./missingPath.js";

const touched = vi.hoisted(() => [] as string[]);
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const recorded =
    <A extends unknown[], R>(call: (path: string, ...rest: A) => R) =>
    (path: string, ...rest: A) => {
      touched.push(String(path));
      return call(path, ...rest);
    };
  return {
    ...real,
    existsSync: recorded(real.existsSync),
    lstatSync: recorded(real.lstatSync as (path: string) => ReturnType<typeof real.lstatSync>),
    readlinkSync: recorded(real.readlinkSync as (path: string) => string),
  };
});

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

  it("names a removed folder by its own name and the custom cache folder as the cache", () => {
    const { temp, entry } = layout();
    rmSync(entry, { recursive: true, force: true });
    expect(describeMissingPath(enoent(entry), { tempRoot: temp })?.scope).toBe("cache_entry");
    const cacheDir = join(temp, "my-cache");
    expect(
      describeMissingPath(enoent(join(cacheDir, "x.jpg")), { tempRoot: temp, cacheDir })?.scope,
    ).toBe("cache_root");
    expect(
      describeMissingPath(enoent(join(temp, "gone", "x.jpg")), { tempRoot: temp })?.scope,
    ).toBe("other");
  });

  it("does not read through a link that points outside the temp root and cache folder", () => {
    const { temp, work } = layout();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    roots.push(outside);
    const link = join(work, "out");
    symlinkSync(
      join(outside, "hfcache-v10-x", "dir"),
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(describeMissingPath(enoent(join(link, "x.jpg")), { tempRoot: temp })?.scope).toBe(
      "link_target",
    );
  });

  it("stops on a link that points into itself", () => {
    const { temp, work } = layout();
    const loop = join(work, "loop");
    symlinkSync(join(loop, "x"), loop, process.platform === "win32" ? "junction" : "dir");
    expect(
      describeMissingPath(enoent(join(loop, "x", "frame.jpg")), { tempRoot: temp })?.scope,
    ).toBe("link_target");
  });

  it("says nothing when nothing was missing or a program could not start", () => {
    expect(describeMissingPath(new Error("Target closed"))).toBeUndefined();
    const spawn = Object.assign(enoent("ffmpeg"), { syscall: "spawn ffmpeg" });
    expect(describeMissingPath(spawn)).toBeUndefined();
  });

  it("never looks at a path that only the error's text names, as page-written text can", () => {
    const { temp, linkedFrame } = layout();
    const written = new Error(`Composition failed to start: ENOENT, open '${linkedFrame}'`);
    expect(describeMissingPath(written, { tempRoot: temp })).toBeUndefined();
  });

  it("names a path outside the render's folders from its text, so it cannot tell whether one exists", () => {
    const { temp } = layout();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    roots.push(outside);
    const there = describeMissingPath(enoent(join(outside, "x.jpg")), { tempRoot: temp });
    const gone = describeMissingPath(enoent(join(outside, "gone", "x.jpg")), { tempRoot: temp });
    expect(there).toEqual({ scope: "other", synced: false, root: "other" });
    expect(gone).toEqual(there);
    expect(
      describeMissingPath(enoent("//attacker.example/share/x.jpg"), { tempRoot: temp }),
    ).toEqual(there);
  });

  /** The error Node raises reading `path`. */
  const readError = (path: string) => {
    try {
      readFileSync(path);
    } catch (error) {
      return error;
    }
    throw new Error(`${path} exists`);
  };
  const under = (path: string, folder: string) => !relative(folder, path).startsWith("..");

  it("never looks past a link out of the render's folders, so what is beyond cannot change the facts", () => {
    const { temp, work } = layout();
    const outside = mkdtempSync(join(tmpdir(), "hf-outside-"));
    roots.push(outside);
    mkdirSync(join(outside, "present"));
    symlinkSync(outside, join(work, "out"), process.platform === "win32" ? "junction" : "dir");
    touched.length = 0;
    const present = describeMissingPath(readError(join(work, "out", "present", "x.jpg")), {
      tempRoot: temp,
    });
    const absent = describeMissingPath(readError(join(work, "out", "absent", "x.jpg")), {
      tempRoot: temp,
    });
    expect(present?.scope).toBe("link_target");
    expect(absent).toEqual(present);
    expect(touched.filter((path) => path.startsWith(outside) || !under(path, temp))).toEqual([]);
  });

  it("names a missing work folder outside the temp root without looking above it", () => {
    const parent = mkdtempSync(join(tmpdir(), "hf-work-parent-"));
    roots.push(parent);
    const workDir = join(parent, "work");
    const where = { tempRoot: join(tmpdir(), "not-here"), workDir };
    const error = readError(join(workDir, "frame.jpg"));
    touched.length = 0;
    expect(describeMissingPath(error, where)?.scope).toBe("work_dir");
    rmSync(parent, { recursive: true, force: true });
    expect(describeMissingPath(error, where)?.scope).toBe("work_dir");
    expect(touched.filter((path) => !under(path, workDir))).toEqual([]);
  });

  it("looks inside the render's work folder when it is outside the temp root", () => {
    const work = mkdtempSync(join(tmpdir(), "hf-work-elsewhere-"));
    roots.push(work);
    expect(
      describeMissingPath(enoent(join(work, "x.jpg")), {
        tempRoot: join(tmpdir(), "not-here"),
        workDir: work,
      })?.scope,
    ).toBe("file");
  });
});
