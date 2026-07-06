import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGlobalAssets, toPublicAsset } from "./globalAssets";

describe("readGlobalAssets", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "mu-global-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function writeManifest(lines: string[]) {
    mkdirSync(join(home, ".media"), { recursive: true });
    writeFileSync(join(home, ".media", "manifest.jsonl"), lines.join("\n"));
  }

  it("returns [] when there is no global manifest", () => {
    expect(readGlobalAssets(home)).toEqual([]);
  });

  it("returns only reusable records", () => {
    writeManifest([
      JSON.stringify({ id: "bgm_001", type: "bgm", reusable: true, sha: "a" }),
      JSON.stringify({ id: "tmp_001", type: "sfx", reusable: false, sha: "b" }),
    ]);
    const assets = readGlobalAssets(home);
    expect(assets.map((a) => a.id)).toEqual(["bgm_001"]);
  });

  it("skips malformed lines instead of throwing (torn write)", () => {
    writeManifest([
      JSON.stringify({ id: "bgm_001", reusable: true }),
      "{ not valid json",
      "",
      JSON.stringify({ id: "img_001", reusable: true }),
    ]);
    expect(readGlobalAssets(home).map((a) => a.id)).toEqual(["bgm_001", "img_001"]);
  });
});

describe("toPublicAsset", () => {
  it("drops the absolute cached_path before it reaches the browser (m13)", () => {
    const pub = toPublicAsset({
      id: "bgm_001",
      type: "bgm",
      description: "calm",
      sha: "abc",
      entity: "Acme",
      cached_path: "/Users/someone/.media/bgm/bgm_001.mp3",
    });
    expect(pub).toEqual({
      id: "bgm_001",
      type: "bgm",
      description: "calm",
      sha: "abc",
      entity: "Acme",
    });
    expect("cached_path" in pub).toBe(false);
  });
});
