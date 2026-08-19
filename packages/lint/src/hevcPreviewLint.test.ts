import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectLocalVideoCandidates } from "./hevcPreviewLint.js";

function makeProject(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-hevc-lint-"));
  for (const rel of files) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "video-bytes", "utf-8");
  }
  return dir;
}

// A sub-composition referencing a SIBLING video (`clip.mp4` next to it) resolves
// against its own directory, exactly as the preview and render paths now do.
// Resolving it against the project root instead either finds nothing (the file
// is silently skipped, so a real HEVC source is never reported) or finds a
// same-named file at the root and probes the WRONG one.
describe("collectLocalVideoCandidates", () => {
  it("resolves a sibling video against the sub-composition dir", () => {
    const dir = makeProject(["design/styleframes/clip.mp4"]);

    const candidates = collectLocalVideoCandidates(dir, [
      { html: `<video src="clip.mp4"></video>`, compSrcPath: "design/styleframes/frame-01.html" },
    ]);

    expect([...candidates.keys()]).toEqual([join(dir, "design/styleframes/clip.mp4")]);
  });

  it("prefers the sibling over a same-named file at the project root", () => {
    const dir = makeProject(["clip.mp4", "design/styleframes/clip.mp4"]);

    const candidates = collectLocalVideoCandidates(dir, [
      { html: `<video src="clip.mp4"></video>`, compSrcPath: "design/styleframes/frame-01.html" },
    ]);

    expect([...candidates.keys()]).toEqual([join(dir, "design/styleframes/clip.mp4")]);
  });

  it("still resolves project-root refs that have no sibling", () => {
    const dir = makeProject(["assets/clip.mp4"]);

    const candidates = collectLocalVideoCandidates(dir, [
      { html: `<video src="assets/clip.mp4"></video>`, compSrcPath: "blocks/hero.html" },
    ]);

    expect([...candidates.keys()]).toEqual([join(dir, "assets/clip.mp4")]);
  });
});
