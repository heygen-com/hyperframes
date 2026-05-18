import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insertTimelineComment,
  parseTimelineCommentsFromHtml,
  removeTimelineComment,
  removeTimelineCommentFromProject,
  writeTimelineCommentToProject,
} from "./timelineComments";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-comments-helper-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("timeline comments", () => {
  it("inserts a source comment before a target id", () => {
    const html = '<main><section id="hero" data-start="1">Hero</section></main>';
    const result = insertTimelineComment(html, {
      id: "hfc_test",
      filePath: "index.html",
      rangeStart: 1,
      rangeEnd: 4,
      prompt: "Make hero faster",
      elements: [{ id: "hero", tag: "section", start: 1, duration: 3, track: 0 }],
      target: { id: "hero" },
    });

    expect(result.indexOf("hyperframes-comment")).toBeLessThan(result.indexOf('id="hero"'));
    expect(result).toContain("<!-- hyperframes-comment {");
    expect(result).not.toContain("<!-- /hyperframes-comment -->");
    expect(parseTimelineCommentsFromHtml(result, "index.html")).toMatchObject([
      {
        id: "hfc_test",
        filePath: "index.html",
        rangeStart: 1,
        rangeEnd: 4,
        prompt: "Make hero faster",
      },
    ]);
  });

  it("removes only the matching source comment", () => {
    const html = insertTimelineComment(
      insertTimelineComment("<div>Body</div>", {
        id: "hfc_keep",
        filePath: "index.html",
        rangeStart: 0,
        rangeEnd: 1,
        prompt: "Keep",
        elements: [],
      }),
      {
        id: "hfc_remove",
        filePath: "index.html",
        rangeStart: 2,
        rangeEnd: 3,
        prompt: "Remove",
        elements: [],
      },
    );

    const result = removeTimelineComment(html, "hfc_remove");

    expect(result).toContain("hfc_keep");
    expect(result).not.toContain("hfc_remove");
  });

  it("removes a comment id from every .html file that contains it", () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "a.html"), "<div>A</div>", "utf-8");
    writeFileSync(join(projectDir, "b.html"), "<div>B</div>", "utf-8");

    writeTimelineCommentToProject(projectDir, {
      id: "hfc_dup",
      filePath: "a.html",
      rangeStart: 0,
      rangeEnd: 1,
      prompt: "dup",
      elements: [],
    });
    writeTimelineCommentToProject(projectDir, {
      id: "hfc_dup",
      filePath: "b.html",
      rangeStart: 0,
      rangeEnd: 1,
      prompt: "dup",
      elements: [],
    });

    const result = removeTimelineCommentFromProject(projectDir, "hfc_dup");

    expect(result.changed).toBe(true);
    expect(readFileSync(join(projectDir, "a.html"), "utf-8")).not.toContain("hfc_dup");
    expect(readFileSync(join(projectDir, "b.html"), "utf-8")).not.toContain("hfc_dup");
  });

  it("does not create visible text nodes in the rendered document", () => {
    const html = insertTimelineComment(
      '<main><section id="hero" data-start="1">Hero</section></main>',
      {
        id: "hfc_hidden",
        filePath: "index.html",
        rangeStart: 1,
        rangeEnd: 4,
        prompt: "Make hero faster",
        elements: [],
        target: { id: "hero" },
      },
    );

    const { document } = parseHTML(html);

    expect(document.body?.textContent ?? document.textContent).not.toContain("Make hero faster");
    expect(document.body?.textContent ?? document.textContent).not.toContain("hfc_hidden");
  });
});
