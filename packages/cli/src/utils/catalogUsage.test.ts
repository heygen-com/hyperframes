import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { summarizeCatalogUsage, type CatalogUsage } from "./catalogUsage.js";
import type { RegistryItemRecord } from "./projectConfig.js";

/**
 * Materialize a throwaway project, summarize it, and clean up. Every case here
 * needs the same fixture, so the shape lives once.
 */
function usageOf(
  files: Record<string, string>,
  registryItems?: RegistryItemRecord[],
  entry = "index.html",
): CatalogUsage {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-test-"));
  try {
    writeFileSync(
      join(dir, "hyperframes.json"),
      JSON.stringify({
        registry: "https://example.test",
        ...(registryItems ? { registryItems } : {}),
      }),
    );
    for (const [rel, html] of Object.entries(files)) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, html);
    }
    return summarizeCatalogUsage(dir, join(dir, entry));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Same as {@link usageOf}, but writes `hyperframes.json` verbatim. */
function usageOfRawConfig(configText: string | null): CatalogUsage {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-test-"));
  try {
    if (configText !== null) writeFileSync(join(dir, "hyperframes.json"), configText);
    writeFileSync(join(dir, "index.html"), entryDoc());
    return summarizeCatalogUsage(dir, join(dir, "index.html"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mountTag(src: string): string {
  return `<div data-composition-src="${src}" data-duration="3" data-width="1920" data-height="1080"></div>`;
}

/** Render entry: a plain document, never `<template>`-wrapped (lint forbids it). */
function entryDoc(...srcs: string[]): string {
  return `<!doctype html><html><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080">${srcs
    .map(mountTag)
    .join("")}</div></body></html>`;
}

/**
 * A sub-composition as they are actually authored everywhere in this repo:
 * wrapped in `<template>`. Template content is inert, so a DOM scan of this
 * file finds nothing — the fixture exists to keep that failure from returning.
 */
function subCompDoc(id: string, ...srcs: string[]): string {
  return `<template id="${id}-template"><div data-composition-id="${id}" data-width="1920" data-height="1080">${srcs
    .map(mountTag)
    .join("")}</div></template>`;
}

const BLOCK = (name: string): RegistryItemRecord => ({
  name,
  type: "hyperframes:block",
  target: `compositions/${name}.html`,
});

describe("summarizeCatalogUsage", () => {
  it("reports nothing for a project that never added a catalog item", () => {
    expect(usageOf({ "index.html": entryDoc() })).toEqual({
      installed: [],
      usedBlocks: [],
      manifestUnreadable: false,
    });
  });

  // The whole point of the manifest: an item that was installed and then not
  // mounted is a rejection, and no add-time event can say so.
  it("separates an installed block that the entry mounts from one it dropped", () => {
    expect(
      usageOf(
        {
          "index.html": entryDoc("compositions/kept.html"),
          "compositions/kept.html": subCompDoc("kept"),
          "compositions/dropped.html": subCompDoc("dropped"),
        },
        [BLOCK("kept"), BLOCK("dropped")],
      ),
    ).toEqual({
      installed: ["dropped", "kept"],
      usedBlocks: ["kept"],
      manifestUnreadable: false,
    });
  });

  // Regression for two invariants that a DOM scan of raw files gets wrong, each
  // of which reports a block that renders in every video as abandoned:
  // `<template>` content is invisible to `querySelectorAll`, and nested
  // `data-composition-src` is root-relative, not relative to its own file.
  it("follows a root-relative mount from inside a template-wrapped sub-composition", () => {
    expect(
      usageOf(
        {
          "index.html": entryDoc("compositions/outer.html"),
          "compositions/outer.html": subCompDoc("outer", "compositions/inner.html"),
          "compositions/inner.html": subCompDoc("inner"),
        },
        [BLOCK("outer"), BLOCK("inner")],
      ).usedBlocks,
    ).toEqual(["inner", "outer"]);
  });

  // A cyclic project must not wedge a render that already produced a video.
  it("terminates on a mount cycle", () => {
    expect(
      usageOf(
        {
          "index.html": entryDoc("compositions/a.html"),
          "compositions/a.html": subCompDoc("a", "compositions/b.html"),
          "compositions/b.html": subCompDoc("b", "compositions/a.html"),
        },
        [BLOCK("a"), BLOCK("b")],
      ).usedBlocks,
    ).toEqual(["a", "b"]);
  });

  // A mount the author commented out does not render, so it is not "used".
  it("ignores a commented-out mount", () => {
    expect(
      usageOf(
        {
          "index.html": `<!doctype html><html><body><!-- ${mountTag("compositions/kept.html")} --></body></html>`,
          "compositions/kept.html": subCompDoc("kept"),
        },
        [BLOCK("kept")],
      ),
    ).toEqual({ installed: ["kept"], usedBlocks: [], manifestUnreadable: false });
  });

  // Components are pasted inline, so there is no src to match. Reporting one as
  // "used" would be a guess; reporting it as installed is a fact.
  it("counts a component as installed but never as used", () => {
    expect(
      usageOf({ "index.html": entryDoc() }, [
        {
          name: "film-grain",
          type: "hyperframes:component",
          target: "compositions/components/film-grain.html",
        },
      ]),
    ).toEqual({ installed: ["film-grain"], usedBlocks: [], manifestUnreadable: false });
  });

  it("drops a manifest name that is not a safe slug rather than sending it", () => {
    expect(
      usageOf({ "index.html": entryDoc() }, [
        { name: "/Users/someone/secret", type: "hyperframes:block", target: "compositions/x.html" },
        BLOCK("fine"),
      ]).installed,
    ).toEqual(["fine"]);
  });

  it("never matches a manifest target that escapes the project directory", () => {
    expect(
      usageOf({ "index.html": entryDoc("compositions/kept.html") }, [
        { name: "escaping", type: "hyperframes:block", target: "../outside.html" },
      ]).usedBlocks,
    ).toEqual([]);
  });

  it("survives an entry file that does not exist", () => {
    expect(usageOf({}, [BLOCK("kept")], "missing.html")).toEqual({
      installed: ["kept"],
      usedBlocks: [],
      manifestUnreadable: false,
    });
  });

  it("contributes nothing for a remote mount, which has no local file to match", () => {
    expect(
      usageOf({ "index.html": entryDoc("https://example.test/compositions/kept.html") }, [
        BLOCK("kept"),
      ]).usedBlocks,
    ).toEqual([]);
  });

  // A degraded read must not enrol a catalog user into the no-catalog control
  // group, which would bias the comparison toward "the catalog changes nothing".
  it("distinguishes a corrupt manifest from a project that never used the catalog", () => {
    expect(usageOfRawConfig("{ not valid json")).toEqual({
      installed: [],
      usedBlocks: [],
      manifestUnreadable: true,
    });
    expect(usageOfRawConfig('{ "registry": "https://example.test" }')).toEqual({
      installed: [],
      usedBlocks: [],
      manifestUnreadable: false,
    });
    expect(usageOfRawConfig(null)).toEqual({
      installed: [],
      usedBlocks: [],
      manifestUnreadable: false,
    });
  });
});
