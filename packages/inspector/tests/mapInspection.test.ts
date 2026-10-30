import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapInspection } from "../src/mapInspection";
import { Sources } from "../src/sources";
import type { ElementRef, RuntimeResponse, Snippet } from "../src/types";

const element = (n: number): ElementRef => ({
  ref: `hfi:g:${n}`,
  tag: "i",
  id: "",
  hfId: null,
  classes: ["w-dot"],
  composition: "s03-weeks",
});

function project(css: string) {
  const dir = mkdtempSync(join(tmpdir(), "inspect-map-"));
  writeFileSync(
    join(dir, "index.html"),
    `<html><head><style>\n${css}\n</style></head><body></body></html>`,
  );
  return dir;
}

function inspect(dir: string, candidates: number, request: Parameters<typeof mapInspection>[1]) {
  const sources = new Sources(dir);
  const raw: RuntimeResponse = {
    results: [
      {
        target: { selector: ".w-dot" },
        status: "found",
        candidates: Array.from({ length: candidates }, (_, n) => element(n)),
        animations: [],
        elements: [],
        css: sources.cssRules.map((rule) => rule.id),
        truncated: false,
      },
    ],
    recorded: 0,
    recordLimitReached: false,
    hooked: true,
  };
  return mapInspection(raw, request, {
    sources,
    map: () => [],
    catalog: new Map<string, Snippet>(),
    generation: "g",
    sourceVersion: "v",
    reused: false,
    start: performance.now(),
  });
}

describe("components report budget", () => {
  it("never answers a page that fits no snippet with a continuation to that same page", () => {
    const big = `.big{${"color:red;".repeat(300)}}`;
    const dir = project(big);
    try {
      const page = inspect(dir, 1, { targets: [{ selector: ".w-dot" }], maxBytes: 2048 });
      expect(page.snippets).toHaveLength(0);
      expect(page.nextOffset).toBeNull();
      expect(page.omitted).toHaveLength(1);
      expect(page.omitted[0].bytes).toBeGreaterThan(2048);
      const fetched = inspect(dir, 1, {
        targets: [],
        snippets: page.omitted.map((o) => o.id),
        maxBytes: 12000,
      });
      expect(fetched.snippets.map((s) => s.code.trim())).toEqual([big]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns every candidate the budget holds instead of five", () => {
    const dir = project(".w-dot{color:red}");
    try {
      const report = inspect(dir, 25, { targets: [{ selector: ".w-dot" }] });
      expect(report.results[0].candidates).toHaveLength(25);
      expect(report.results[0].candidatesOmitted).toBe(0);
      expect(report.snippets).toHaveLength(1);
      const tight = inspect(dir, 25, { targets: [{ selector: ".w-dot" }], maxBytes: 4096 });
      expect(Buffer.byteLength(JSON.stringify(tight))).toBeLessThanOrEqual(4096);
      expect(tight.results[0].candidates.length).toBeGreaterThanOrEqual(5);
      expect(tight.results[0].candidates.length + tight.results[0].candidatesOmitted).toBe(25);
      expect(tight.snippets).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("continues past a snippet that does not fit so later snippets stay reachable", () => {
    const big = `.big{${"color:red;".repeat(300)}}`;
    const small = Array.from({ length: 20 }, (_, n) => `.s${n}{color:red}`);
    const dir = project([big, ...small].join("\n\n"));
    try {
      const first = inspect(dir, 1, { targets: [{ selector: ".w-dot" }], maxBytes: 2048 });
      expect(first.snippets).toHaveLength(0);
      expect(first.nextOffset).toBe(1);
      expect(first.omitted[0]?.bytes).toBeGreaterThan(2048);
      const seen = new Set<string>();
      let offset: number | null = first.nextOffset;
      for (let guard = 0; offset !== null && guard < 25; guard++) {
        const page = inspect(dir, 1, {
          targets: [{ selector: ".w-dot" }],
          maxBytes: 2048,
          offset,
        });
        for (const snippet of page.snippets) seen.add(snippet.code.trim());
        expect(page.nextOffset === null || page.nextOffset > offset).toBe(true);
        offset = page.nextOffset;
      }
      expect(offset).toBeNull();
      expect([...seen].sort()).toEqual([...small].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("components report priority", () => {
  const css = Array.from({ length: 6 }, (_, n) => `.w-dot.n${n}{${"color:red;".repeat(30)}}`).join(
    "\n",
  );
  const call = `tl.to(".w-dot", { x: 100, duration: 1 }, 2);`;

  function withAnimation(
    request: Parameters<typeof mapInspection>[1],
    catalog = new Map<string, Snippet>(),
  ) {
    const dir = mkdtempSync(join(tmpdir(), "inspect-priority-"));
    const html = `<html><head><style>\n${css}\n</style></head><body>\n<script>\nconst tl = gsap.timeline();\n${call}\n</script>\n</body></html>`;
    writeFileSync(join(dir, "index.html"), html);
    const sources = new Sources(dir);
    const start = html.indexOf(call);
    const creation = sources.slice(
      "index.html",
      start,
      start + call.length,
      "animation creation",
      0,
    )!;
    const raw: RuntimeResponse = {
      results: [
        {
          target: { selector: ".w-dot" },
          status: "found",
          candidates: [element(0)],
          animations: [{ stack: "s", attachmentStacks: [], targets: [element(0)] } as never],
          elements: [],
          css: sources.cssRules.map((rule) => rule.id),
          truncated: false,
        },
      ],
      recorded: 1,
      recordLimitReached: false,
      hooked: true,
    };
    const report = mapInspection(raw, request, {
      sources,
      map: () => [creation],
      catalog,
      generation: "g",
      sourceVersion: "v",
      reused: false,
      start: performance.now(),
    });
    rmSync(dir, { recursive: true, force: true });
    return { report, creation };
  }

  it("keeps the code that makes an animation before CSS candidates that sit earlier in the file", () => {
    const { report, creation } = withAnimation({
      targets: [{ selector: ".w-dot" }],
      maxBytes: 2600,
    });
    expect(report.snippets.map((s) => s.id)).toContain(creation.id);
    expect(report.omittedCount).toBeGreaterThan(0);
    for (const s of report.snippets.filter((s) => s.id !== creation.id))
      expect(s.kind).toEqual(["matched CSS candidate"]);
  });

  it("returns the snippets it keeps in file order", () => {
    const { report } = withAnimation({ targets: [{ selector: ".w-dot" }], maxBytes: 256000 });
    const lines = report.snippets.map((s) => Number(/:(\d+)-/.exec(s.id)![1]));
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(report.snippets.at(-1)?.kind).toEqual(["animation creation"]);
    expect(report.omittedCount).toBe(0);
  });

  it("returns explicit snippet IDs in request order rather than file order", () => {
    const catalog = new Map<string, Snippet>();
    const { report } = withAnimation(
      { targets: [{ selector: ".w-dot" }], maxBytes: 256000 },
      catalog,
    );
    const ids = report.snippets.map((snippet) => snippet.id).reverse();
    expect(ids).toHaveLength(2);
    const { report: fetched } = withAnimation(
      { targets: [], snippets: ids, maxBytes: 256000 },
      catalog,
    );
    expect(fetched.snippets.map((snippet) => snippet.id)).toEqual(ids);
    expect(fetched.omittedCount).toBe(0);
  });
});

describe("components report shape", () => {
  const call = `tl.to(".w-dot", { x: 100, duration: 1 }, 2);`;

  function report(targets: number, coTargets: number) {
    const dir = mkdtempSync(join(tmpdir(), "inspect-shape-"));
    const html = `<html><body>\n<script>\nconst tl = gsap.timeline();\n${call}\n</script>\n</body></html>`;
    writeFileSync(join(dir, "index.html"), html);
    const sources = new Sources(dir);
    const start = html.indexOf(call);
    const creation = sources.slice(
      "index.html",
      start,
      start + call.length,
      "animation creation",
      0,
    )!;
    const moved = Array.from({ length: coTargets + 1 }, (_, n) => element(n));
    const result = (n: number) => ({
      target: { selector: `.w-dot.t${n}` },
      status: "found" as const,
      candidates: [element(n)],
      animations: [{ stack: "s", attachmentStacks: [], targets: moved } as never],
      elements: [element(n)],
      css: [],
      truncated: false,
    });
    try {
      return mapInspection(
        {
          results: Array.from({ length: targets }, (_, n) => result(n)),
          recorded: 1,
          recordLimitReached: false,
          hooked: true,
        },
        { targets: Array.from({ length: targets }, (_, n) => ({ selector: `.w-dot.t${n}` })) },
        {
          sources,
          map: () => [{ ...creation, targets: Array.from({ length: targets }, (_, n) => n) }],
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

  it("names a snippet's file and lines once, in its id, and carries no fixed disclaimers", () => {
    const shown = report(1, 0);
    expect(shown).not.toHaveProperty("coverage");
    expect(shown.snippets).toEqual([
      { id: "index.html:4-4", kind: ["animation creation"], code: `${call}\n`, uniqueInFile: true },
    ]);
  });

  it("says which target each snippet serves when the query names more than one", () => {
    expect(report(2, 0).snippets[0]).toMatchObject({ id: "index.html:4-4", targets: [0, 1] });
  });

  it("keeps an unqueried co-target visible when four queried elements share its tween", () => {
    for (const result of report(4, 4).results) {
      expect(result.coTargets[0]?.ref).toBe(element(4).ref);
      expect(result.coTargets).toHaveLength(3);
      expect(result.coTargetsOmitted).toBe(1);
    }
  });

  it("lists three elements the same animation also moves and counts the rest", () => {
    const [result] = report(1, 7).results;
    expect(result!.coTargets).toHaveLength(3);
    expect(result!.coTargetsOmitted).toBe(4);
    expect(report(1, 2).results[0]).not.toHaveProperty("coTargetsOmitted");
  });
});
