import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stagePublishFiles } from "./publishProject.js";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-abs-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A project whose index.html is `html(external, project)`, beside a folder holding song.mp3. */
function stage(html: (external: string, project: string) => string) {
  const project = temp();
  const external = temp();
  writeFileSync(join(external, "song.mp3"), "audio");
  mkdirSync(join(project, "media"));
  writeFileSync(join(project, "media", "inside.mp3"), "audio");
  writeFileSync(join(project, "index.html"), html(external, project));
  const files = stagePublishFiles(project, Infinity);
  const index = files.get("index.html")!.toString("utf-8");
  return { files, index, external };
}

describe("a media file referenced by its filesystem path", () => {
  it("outside the project is archived under _ext and the reference points at it", () => {
    const { files, index, external } = stage(
      (ext) => `<html><audio id="music" src="${join(ext, "song.mp3")}"></audio></html>`,
    );
    expect([...files.keys()].filter((key) => key.startsWith("_ext/"))).toHaveLength(1);
    expect(index).toMatch(/src="_ext\/[^"]*song\.mp3"/);
    expect(index).not.toContain(external);
  });

  it("inside the project is rewritten to its path in the archive", () => {
    const { files, index } = stage(
      (_ext, project) =>
        `<html><audio id="music" src="${join(project, "media/inside.mp3")}"></audio></html>`,
    );
    expect(files.has("media/inside.mp3")).toBe(true);
    expect(index).toContain('src="media/inside.mp3"');
  });

  it("keeps its #fragment and ?query after the archive path", () => {
    const inside = stage(
      (_ext, project) =>
        `<html><audio id="a" src="${join(project, "media/inside.mp3")}#t=1"></audio></html>`,
    );
    expect(inside.index).toContain('src="media/inside.mp3#t=1"');
    const outside = stage(
      (ext) => `<html><audio id="a" src="${join(ext, "song.mp3")}?v=2"></audio></html>`,
    );
    expect(outside.index).toMatch(/src="_ext\/[^"]*song\.mp3\?v=2"/);
  });

  it("that does not exist is left as written, like any root-relative URL", () => {
    const { index } = stage(() => `<html><img src="/assets/none.png"></html>`);
    expect(index).toContain('src="/assets/none.png"');
  });
});
