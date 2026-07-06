import { describe, expect, it } from "vitest";
import { filterByUsage, countUsage, deriveUsedPaths } from "./AssetsTab";
import { globalAssetRows } from "./GlobalAssetsView";

const assets = ["bgm.mp3", "logo.png", "orphan.wav"];
const used = new Set(["bgm.mp3", "logo.png"]);

describe("filterByUsage", () => {
  it("returns everything for 'all'", () => {
    expect(filterByUsage(assets, used, "all")).toEqual(assets);
  });

  it("keeps only referenced assets for 'used'", () => {
    expect(filterByUsage(assets, used, "used")).toEqual(["bgm.mp3", "logo.png"]);
  });

  it("keeps only unreferenced assets for 'unused'", () => {
    expect(filterByUsage(assets, used, "unused")).toEqual(["orphan.wav"]);
  });

  it("treats everything as unused when nothing is referenced", () => {
    expect(filterByUsage(assets, new Set(), "used")).toEqual([]);
    expect(filterByUsage(assets, new Set(), "unused")).toEqual(assets);
  });
});

describe("deriveUsedPaths", () => {
  it("matches the asset-list format across every src shape", () => {
    const used = deriveUsedPaths([
      { src: "assets/logo.png" }, // raw authored relative path
      { src: "/api/projects/demo/preview/assets/bgm.mp3" }, // served form
      { src: "./assets/icon.svg" }, // ./-prefixed
      { src: "assets/clip.mp4?v=2" }, // cache-busted
      {}, // no src — skipped
    ]);
    expect(used.has("assets/logo.png")).toBe(true);
    expect(used.has("assets/bgm.mp3")).toBe(true);
    expect(used.has("assets/icon.svg")).toBe(true);
    expect(used.has("assets/clip.mp4")).toBe(true);
    expect(used.size).toBe(4);
  });

  it("an authored relative src lines up with the asset entry (the live bug class)", () => {
    const used = deriveUsedPaths([{ src: "assets/logo.png" }]);
    // asset-list entries are project-relative (see serveUrl = preview/${asset})
    expect(filterByUsage(["assets/logo.png", "assets/orphan.wav"], used, "used")).toEqual([
      "assets/logo.png",
    ]);
  });
});

describe("countUsage", () => {
  it("counts used vs unused", () => {
    expect(countUsage(assets, used)).toEqual({ used: 2, unused: 1 });
  });

  it("is all-unused with an empty used set", () => {
    expect(countUsage(assets, new Set())).toEqual({ used: 0, unused: 3 });
  });
});

describe("globalAssetRows", () => {
  const recs = [
    { id: "bgm_001", type: "bgm", description: "calm ambient" },
    { id: "img_001", type: "image", entity: "Acme" },
    { sha: "abc", type: "sfx" },
  ];

  it("maps records to display rows with a sensible label", () => {
    const rows = globalAssetRows(recs);
    expect(rows).toEqual([
      { id: "bgm_001", type: "bgm", label: "calm ambient" },
      { id: "img_001", type: "image", label: "Acme" },
      { id: "abc", type: "sfx", label: "abc" },
    ]);
  });

  it("filters by id / type / description / entity, case-insensitively", () => {
    expect(globalAssetRows(recs, "ACME").map((r) => r.id)).toEqual(["img_001"]);
    expect(globalAssetRows(recs, "bgm").map((r) => r.id)).toEqual(["bgm_001"]);
    expect(globalAssetRows(recs, "ambient").map((r) => r.id)).toEqual(["bgm_001"]);
  });

  it("empty query returns all", () => {
    expect(globalAssetRows(recs, "  ").length).toBe(3);
  });
});
