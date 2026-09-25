import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  listProjectCatalogItems,
  summarizeCatalogUsage,
  type CatalogUsage,
  type ProjectCatalogItems,
} from "./catalogUsage.js";
import type { RegistryManifestEntry } from "@hyperframes/core";
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

/** A throwaway project listed with `listProjectCatalogItems`; `config` is hyperframes.json. */
function listOf(
  files: Record<string, string>,
  config: Record<string, unknown> | string | null,
  catalog?: RegistryManifestEntry[],
): ProjectCatalogItems {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-list-"));
  try {
    if (config !== null) {
      const text = typeof config === "string" ? config : JSON.stringify(config);
      writeFileSync(join(dir, "hyperframes.json"), text);
    }
    for (const [rel, html] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), html);
    }
    return listProjectCatalogItems(dir, catalog);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const COMPONENT = (name: string): RegistryItemRecord => ({
  name,
  type: "hyperframes:component",
  target: `compositions/components/${name}.html`,
});

describe("listProjectCatalogItems", () => {
  it("says which recorded items the video uses, which it does not, and which files are gone", () => {
    const { items } = listOf(
      {
        "index.html": entryDoc("compositions/kept.html"),
        "compositions/kept.html": subCompDoc("kept"),
        "compositions/dropped.html": subCompDoc("dropped"),
        "compositions/components/badge.html": "<div class=badge></div>",
      },
      { registryItems: [BLOCK("kept"), BLOCK("dropped"), BLOCK("deleted"), COMPONENT("badge")] },
    );
    expect(items.map(({ name, status, foundBy }) => [name, status, foundBy])).toEqual([
      ["badge", "pasted-inline", "recorded"],
      ["deleted", "file-missing", "recorded"],
      ["dropped", "not-used", "recorded"],
      ["kept", "in-use", "recorded"],
    ]);
  });

  // Projects from before `add` recorded items, or with items copied in by hand.
  it("finds unrecorded registry items by their install path, flat or in their own folder", () => {
    const { items, scannedFiles } = listOf(
      {
        "index.html": entryDoc("compositions/orbit-card/orbit-card.html"),
        "compositions/orbit-card/orbit-card.html": subCompDoc("orbit"),
        "compositions/glitch.html": subCompDoc("glitch"),
        "compositions/my-own-scene.html": subCompDoc("mine"),
      },
      {},
      [
        { name: "orbit-card", type: "hyperframes:block" },
        { name: "glitch", type: "hyperframes:block" },
        { name: "not-installed", type: "hyperframes:block" },
      ],
    );
    expect(scannedFiles).toBe(true);
    expect(items).toEqual([
      {
        name: "glitch",
        type: "block",
        file: "compositions/glitch.html",
        status: "not-used",
        foundBy: "file",
      },
      {
        name: "orbit-card",
        type: "block",
        file: "compositions/orbit-card/orbit-card.html",
        status: "in-use",
        foundBy: "file",
      },
    ]);
  });

  it("looks for unrecorded items under the project's own paths", () => {
    const { items } = listOf(
      { "index.html": entryDoc(), "scenes/glitch.html": subCompDoc("glitch") },
      { paths: { blocks: "scenes/" } },
      [{ name: "glitch", type: "hyperframes:block" }],
    );
    expect(items.map((item) => item.file)).toEqual(["scenes/glitch.html"]);
  });

  it("lists recorded items only, and says so, without the registry list", () => {
    const view = listOf(
      { "index.html": entryDoc(), "compositions/glitch.html": subCompDoc("glitch") },
      { registryItems: [BLOCK("kept")] },
    );
    expect(view.scannedFiles).toBe(false);
    expect(view.items.map((item) => item.name)).toEqual(["kept"]);
  });

  it("reports the view in the render event's shape, file finds included", () => {
    const { usage } = listOf(
      {
        "index.html": entryDoc("compositions/glitch.html"),
        "compositions/glitch.html": subCompDoc("glitch"),
        "compositions/kept.html": subCompDoc("kept"),
      },
      { registryItems: [BLOCK("kept"), BLOCK("Not A Slug")] },
      [{ name: "glitch", type: "hyperframes:block" }],
    );
    expect(usage).toEqual({
      installed: ["glitch", "kept"],
      usedBlocks: ["glitch"],
      manifestUnreadable: false,
    });
  });

  it("still finds items by file when hyperframes.json is unreadable, and flags the manifest", () => {
    const view = listOf(
      { "index.html": entryDoc(), "compositions/glitch.html": subCompDoc("glitch") },
      "{ not json",
      [{ name: "glitch", type: "hyperframes:block" }],
    );
    expect(view.items.map((item) => item.name)).toEqual(["glitch"]);
    expect(view.usage.manifestUnreadable).toBe(true);
  });

  it("marks a recorded target that escapes the project as missing rather than reading it", () => {
    const { items } = listOf(
      { "index.html": entryDoc() },
      { registryItems: [{ name: "evil", type: "hyperframes:block", target: "../outside.html" }] },
    );
    expect(items.map((item) => item.status)).toEqual(["file-missing"]);
  });
});
