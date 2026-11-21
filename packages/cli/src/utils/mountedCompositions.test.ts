import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectCompositionFiles } from "./mountedCompositions.js";

describe("projectCompositionFiles", () => {
  let directory: string;
  let project: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "hf-mounted-compositions-"));
    project = join(directory, "project");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function write(file: string, html: string): void {
    const path = join(project, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html);
  }

  it("follows template-wrapped scenes recursively without revisiting cycles or duplicate mounts", () => {
    write(
      "index.html",
      '<div data-composition-src="compositions/outer.html"></div>' +
        '<div data-composition-src="./compositions/outer.html"></div>',
    );
    write(
      "compositions/outer.html",
      '<template><div data-composition-src="compositions/inner.html"></div></template>',
    );
    write(
      "compositions/inner.html",
      '<template><div data-composition-src="index.html"></div></template>',
    );
    write("compositions/unmounted.html", "<template>Unused scene</template>");

    expect(projectCompositionFiles(project)).toEqual([
      "index.html",
      "compositions/outer.html",
      "compositions/inner.html",
    ]);
  });

  it("ignores mounts in comments and scripts while finding active template content", () => {
    write(
      "index.html",
      '<template><!-- <div data-composition-src="commented.html"></div> -->' +
        "<script>const example = '<div data-composition-src=\"scripted.html\"></div>';</script>" +
        '<div data-composition-src="active.html"></div></template>',
    );
    for (const file of ["commented.html", "scripted.html", "active.html"]) write(file, "");

    expect(projectCompositionFiles(project)).toEqual(["index.html", "active.html"]);
  });

  it("keeps nested mounts inside the project and skips missing files", () => {
    write("../outside.html", "<template>Outside scene</template>");
    write("index.html", '<div data-composition-src="outer.html"></div>');
    write(
      "outer.html",
      '<template><div data-composition-src="../outside.html"></div>' +
        '<div data-composition-src="missing.html"></div>' +
        '<div data-composition-src="inner.html"></div></template>',
    );
    write("inner.html", "<template>Inner scene</template>");

    expect(projectCompositionFiles(project)).toEqual(["index.html", "outer.html", "inner.html"]);
  });
});
