import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapInspection } from "../src/mapInspection";
import { Sources } from "../src/sources";
import type { ElementRef, RuntimeResponse, Snippet } from "../src/types";

describe("components report compositions", () => {
  const files = {
    "index.html": [
      `<html><body>`,
      `<div id="root" data-composition-id="main" data-start="0" data-duration="20">`,
      `<div id="film" data-composition-id="film" data-composition-src="films/a/index.html"`,
      `     data-start="2" data-duration="10"></div>`,
      `</div>`,
      `</body></html>`,
    ],
    "films/a/index.html": [
      `<html><head><style>`,
      `#word{${"color:red;".repeat(40)}}`,
      `</style></head><body>`,
      `<div id="film-root" data-composition-id="film" data-duration="10">`,
      `<!-- <div data-composition-src="films/a/scene.html"> -->`,
      `<div id="sec" data-composition-id="scene" data-composition-src="./films/a/scene.html"`,
      `     data-start="1" data-duration="3"></div>`,
      `</div>`,
      `</body></html>`,
    ],
    "films/a/scene.html": [
      `<template id="scene-template">`,
      `<div id="scene-root" data-composition-id="scene" data-duration="3">`,
      `<p>One<p><span id="word">Hi</span>`,
      `</div>`,
      `</template>`,
    ],
  };
  const ref = (id: string, tag: string): ElementRef => ({
    ref: `hfi:g:${id}`,
    tag,
    id,
    hfId: null,
    classes: [],
    composition: null,
  });

  function inspectIds(
    ids: [string, string][],
    request: Partial<Parameters<typeof mapInspection>[1]>,
    prepare: (sources: Sources) => void = () => {},
    projectFiles: Record<string, string[]> = files,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "inspect-compositions-"));
    mkdirSync(join(dir, "films/a"), { recursive: true });
    for (const [file, lines] of Object.entries(projectFiles))
      writeFileSync(join(dir, file), lines.join("\n"));
    try {
      const sources = new Sources(dir);
      prepare(sources);
      const raw: RuntimeResponse = {
        results: ids.map(([id, tag], index) => ({
          target: request.targets?.[index] ?? { selector: `#${id}` },
          status: "found",
          candidates: [ref(id, tag)],
          animations: [],
          elements: [ref(id, tag)],
          css: sources.cssRules.filter((rule) => rule.selector === `#${id}`).map((rule) => rule.id),
          truncated: false,
        })),
        recorded: 0,
        recordLimitReached: false,
        hooked: true,
      };
      return mapInspection(
        raw,
        { targets: ids.map(([id]) => ({ selector: `#${id}` })), ...request },
        {
          sources,
          map: () => [],
          catalog: new Map<string, Snippet>(),
          generation: "g",
          sourceVersion: "v",
          reused: false,
          start: performance.now(),
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const shown = (report: ReturnType<typeof inspectIds>) =>
    report.snippets.map((s) => [s.id, s.kind.join(",")]).sort();

  it("shows every composition and host that times an element inside a sub-composition", () => {
    const report = inspectIds([["word", "span"]], { maxBytes: 256000 });
    expect(shown(report)).toEqual(
      [
        ["films/a/index.html:2-2", "matched CSS candidate"],
        ["films/a/scene.html:3-3", "html opening tag"],
        ["films/a/index.html:4-4", "composition root"],
        ["films/a/index.html:6-7", "composition host"],
        ["films/a/scene.html:2-2", "composition root"],
        ["index.html:2-4", "composition root,composition host"],
      ].sort(),
    );
  });

  it("shows the root a targeted host mounts and the compositions around the host", () => {
    const report = inspectIds([["sec", "div"]], { maxBytes: 256000 });
    expect(shown(report)).toEqual(
      [
        ["films/a/index.html:6-7", "html opening tag"],
        ["films/a/index.html:4-4", "composition root"],
        ["films/a/scene.html:2-2", "composition root"],
        ["index.html:2-4", "composition root,composition host"],
      ].sort(),
    );
  });

  it.each(["scene", "missing", undefined])("selects the mounted root for host ID %s", (id) => {
    const report = inspectIds(
      [["sec", "div"]],
      { maxBytes: 256000 },
      (sources) => {
        const host = sources.htmlTags.find((tag) => tag.id === "sec");
        if (!host) throw new Error("missing fixture host");
        host.compositionId = id;
      },
      {
        ...files,
        "films/a/scene.html": [
          '<div data-composition-id="first" data-duration="1"></div>',
          '<div data-composition-id="scene" data-duration="9"></div>',
        ],
      },
    );
    const roots = report.snippets.filter((snippet) => snippet.id.startsWith("films/a/scene.html:"));
    expect(roots.map((snippet) => Number(snippet.id.split(":").at(-1)?.split("-")[0]))).toEqual(
      id === "scene" ? [2] : id === "missing" ? [] : [1],
    );
  });

  it("resolves root-relative and host-relative mounts with Windows source keys", () => {
    const report = inspectIds([["word", "span"]], { maxBytes: 256000 }, (sources) => {
      for (const [file, source] of [...sources.files]) {
        sources.files.delete(file);
        sources.files.set(file.replaceAll("/", "\\"), source);
      }
      for (const tag of sources.htmlTags) {
        tag.file = tag.file.replaceAll("/", "\\");
        if (tag.id === "sec") tag.compositionSrc = "scene.html";
      }
      for (const rule of sources.cssRules) rule.file = rule.file.replaceAll("/", "\\");
    });
    expect(
      report.snippets.some(
        (snippet) => snippet.id.startsWith("index.html:") && snippet.code.includes('id="film"'),
      ),
    ).toBe(true);
    expect(
      report.snippets.some(
        (snippet) =>
          snippet.id.startsWith("films\\a\\index.html:") && snippet.code.includes('id="sec"'),
      ),
    ).toBe(true);
  });

  it.each([{ selector: "#word", within: "#left" }, { ref: "hfi:g:word" }])(
    "retains repeated mounts as source candidates for scoped target %j",
    (target) => {
      const report = inspectIds(
        [["word", "span"]],
        { targets: [target], maxBytes: 256000 },
        () => {},
        {
          "index.html": [
            '<div data-composition-id="main">',
            '<div id="left" data-composition-src="films/a/scene.html" data-start="0"></div>',
            "",
            '<div id="right" data-composition-src="films/a/scene.html" data-start="20"></div>',
            "</div>",
          ],
          "films/a/scene.html": files["films/a/scene.html"],
        },
      );
      const candidates = report.snippets.filter((snippet) =>
        snippet.kind.includes("composition host candidate"),
      );
      expect(candidates).toHaveLength(2);
      expect(candidates.map((snippet) => snippet.code)).toEqual([
        expect.stringContaining('id="left"'),
        expect.stringContaining('id="right"'),
      ]);
      expect(report.results.map((result) => result.target)).toEqual([0]);
      expect(report.snippets.some((snippet) => snippet.kind.includes("composition host"))).toBe(
        false,
      );
      expect(report.coverage).toContain(
        "Composition candidates are alternative source mounts and their enclosing roots, not a verified runtime instance chain; all alternatives remain available within the snippet budget and pagination.",
      );
    },
  );

  it("keeps primary snippets when candidate context does not fit", () => {
    const report = inspectIds([["word", "span"]], { maxBytes: 2048 }, () => {}, {
      "index.html": [
        '<div id="left" data-composition-src="films/a/scene.html" data-start="0"></div>',
        "",
        '<div id="right" data-composition-src="films/a/scene.html" data-start="20"></div>',
      ],
      "films/a/scene.html": [`<span id="word" title="${"x".repeat(650)}">Hi</span>`],
    });
    expect(report.snippets.map((snippet) => snippet.kind)).toEqual([["html opening tag"]]);
    expect(report.omittedCount).toBe(2);
    expect(
      report.coverage?.some((line) => line.startsWith("Composition candidates")) ?? false,
    ).toBe(false);
  });

  it("leaves out a composition tag another snippet already shows", () => {
    const report = inspectIds(
      [
        ["word", "span"],
        ["film", "div"],
      ],
      { maxBytes: 256000 },
    );
    const lines = report.snippets.map((s) => s.id.split("-")[0]);
    expect(new Set(lines).size).toBe(lines.length);
    expect(report.snippets.find((s) => s.id === "index.html:3-4")?.kind).toEqual([
      "html opening tag",
    ]);
    expect(report.snippets.find((s) => s.id === "index.html:2-2")?.kind).toEqual([
      "composition root",
    ]);
  });

  it("omits composition tags before the snippets about the element itself", () => {
    const report = inspectIds([["word", "span"]], { maxBytes: 1800 });
    expect(report.snippets.map((s) => s.kind[0])).toEqual([
      "matched CSS candidate",
      "html opening tag",
    ]);
    expect(report.omitted.map((s) => s.id)).toEqual([
      "films/a/index.html:4-4",
      "films/a/index.html:6-7",
      "films/a/scene.html:2-2",
      "index.html:2-4",
    ]);
    expect(report.nextOffset).toBe(2);
  });
});
