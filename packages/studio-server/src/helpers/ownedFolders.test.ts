import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotBeforeWrite } from "./backupJournal";
import { stampProjectHfIds } from "./hfIdPersist";
import { createPreviewDocumentStore } from "./previewDocumentStore";
import { isLinkFreeWithinProject, mkdirOwnedWithinProject } from "./safePath";
import { projectHistoryId } from "../history/historyId";
import { pruneThumbnailCache } from "../routes/thumbnail";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-owned-folders-"));
  dirs.push(dir);
  return dir;
}

/** A project and, beside it, a folder of the person's own files that a link in the project points at. */
function projectWithOutsideFolder() {
  const root = tempDir();
  const project = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(outside, "notes.txt"), "keep me");
  writeFileSync(join(project, "index.html"), '<div data-composition-id="main"><p>Hi</p></div>');
  return { project, outside };
}

const listing = (dir: string) => readdirSync(dir).sort();

// Windows needs a privilege to create symlinks.
describe.skipIf(process.platform === "win32")("the tool's own folders inside a project", () => {
  it("are made as real folders when nothing is there yet", () => {
    const project = tempDir();
    mkdirOwnedWithinProject(project, join(project, ".hyperframes", "preview"));
    expect(isLinkFreeWithinProject(project, join(project, ".hyperframes", "preview"))).toBe(true);
  });

  it("are refused when a folder on the way is a link, and nothing is made at its target", () => {
    const { project, outside } = projectWithOutsideFolder();
    symlinkSync(outside, join(project, ".hyperframes"));

    expect(() =>
      mkdirOwnedWithinProject(project, join(project, ".hyperframes", "backup")),
    ).toThrow();
    expect(listing(outside)).toEqual(["notes.txt"]);
  });

  it("still work when the project folder itself is reached through a link", () => {
    const { project } = projectWithOutsideFolder();
    const linkedProject = join(tempDir(), "linked");
    symlinkSync(project, linkedProject);

    mkdirOwnedWithinProject(linkedProject, join(linkedProject, ".thumbnails"));
    expect(existsSync(join(project, ".thumbnails"))).toBe(true);
  });

  it("keep the hf-id stamp record from writing through a linked record file", () => {
    const { project, outside } = projectWithOutsideFolder();
    mkdirSync(join(project, ".hyperframes"));
    symlinkSync(join(outside, "notes.txt"), join(project, ".hyperframes", "hf-ids-stamped.json"));

    stampProjectHfIds(project);

    expect(readFileSync(join(outside, "notes.txt"), "utf-8")).toBe("keep me");
  });

  it("keep the hf-id stamp record out of a linked .hyperframes folder", () => {
    const { project, outside } = projectWithOutsideFolder();
    symlinkSync(outside, join(project, ".hyperframes"));

    stampProjectHfIds(project);

    expect(listing(outside)).toEqual(["notes.txt"]);
  });

  it("keep a new history id from creating the target of a dangling link", () => {
    const { project, outside } = projectWithOutsideFolder();
    mkdirSync(join(project, ".hyperframes"));
    symlinkSync(join(outside, "planted"), join(project, ".hyperframes", "history-id"));

    const id = projectHistoryId(project, tempDir());

    expect(listing(outside)).toEqual(["notes.txt"]);
    expect(readFileSync(join(project, ".hyperframes", "history-id"), "utf-8")).toBe(`${id}\n`);
  });

  it("keep edit backups out of a linked backup folder", () => {
    const { project, outside } = projectWithOutsideFolder();
    mkdirSync(join(project, ".hyperframes"));
    symlinkSync(outside, join(project, ".hyperframes", "backup"));

    const result = snapshotBeforeWrite(project, join(project, "index.html"));

    expect(result.backupPath).toBeNull();
    expect(listing(outside)).toEqual(["notes.txt"]);
  });

  it("keep built preview documents from writing into or emptying a linked preview folder", () => {
    const { project, outside } = projectWithOutsideFolder();
    mkdirSync(join(project, ".hyperframes"));
    symlinkSync(outside, join(project, ".hyperframes", "preview"));

    createPreviewDocumentStore(project, "salt").write("key", "<html></html>");

    expect(listing(outside)).toEqual(["notes.txt"]);
  });

  it("keep the thumbnail cache sweep out of a linked .thumbnails folder", () => {
    const { project, outside } = projectWithOutsideFolder();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(join(outside, "notes.txt"), old, old);
    symlinkSync(outside, join(project, ".thumbnails"));

    pruneThumbnailCache(join(project, ".thumbnails"), new Set());

    expect(listing(outside)).toEqual(["notes.txt"]);
  });
});
