import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AssetMatch,
  type ResolvedAssetLibrary,
  copyAssetToProject,
  expandAssetPath,
  inferAssetKind,
  resolveAssetLibraries,
  scanAssetLibraries,
} from "./library.js";
import { DEFAULT_PROJECT_CONFIG } from "../utils/projectConfig.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "hf-assets-test-"));
}

function makeAssetLibrary(root: string): string {
  const library = join(root, "pro-assets");
  mkdirSync(join(library, "logos"), { recursive: true });
  mkdirSync(join(library, "people"), { recursive: true });
  writeFileSync(join(library, "logos", "neon-brand-token.svg"), "<svg></svg>", "utf-8");
  writeFileSync(join(library, "people", "jane-founder.png"), "png", "utf-8");
  writeFileSync(join(library, "notes.txt"), "not indexed", "utf-8");
  return library;
}

interface AssetFixture {
  projectDir: string;
  library: string;
  libraries: ResolvedAssetLibrary[];
}

function withAssetFixture(fn: (fixture: AssetFixture) => void): void {
  const root = tmp();
  try {
    const projectDir = join(root, "project");
    mkdirSync(projectDir);
    const library = makeAssetLibrary(root);
    const libraries = resolveAssetLibraries({
      projectDir,
      config: {
        ...DEFAULT_PROJECT_CONFIG,
        assetLibraries: [{ name: "Pro", path: library }],
      },
      env: {},
    });
    fn({ projectDir, library, libraries });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function firstAsset(libraries: ResolvedAssetLibrary[], query: string): AssetMatch {
  const [asset] = scanAssetLibraries({ libraries, query });
  if (!asset) throw new Error(`Expected asset match for "${query}"`);
  return asset;
}

describe("asset library helpers", () => {
  it("expands home and project-relative asset paths", () => {
    const projectDir = tmp();
    try {
      expect(expandAssetPath("~/Assets", projectDir)).toMatch(/Assets$/);
      expect(expandAssetPath("brand-assets", projectDir)).toBe(join(projectDir, "brand-assets"));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("infers supported asset kinds from extensions", () => {
    expect(inferAssetKind("logo.svg")).toBe("image");
    expect(inferAssetKind("clip.webm")).toBe("video");
    expect(inferAssetKind("voice.wav")).toBe("audio");
    expect(inferAssetKind("brand.woff2")).toBe("font");
    expect(inferAssetKind("animations/lottie/card.json")).toBe("lottie");
    expect(inferAssetKind("data.csv")).toBe("data");
    expect(inferAssetKind("notes.txt")).toBeUndefined();
  });

  it("resolves project and env libraries that exist on disk", () => {
    const root = tmp();
    try {
      const projectDir = join(root, "project");
      mkdirSync(projectDir);
      const library = makeAssetLibrary(root);
      const config = {
        ...DEFAULT_PROJECT_CONFIG,
        assetLibraries: [{ name: "Pro", path: library }],
      };

      const libraries = resolveAssetLibraries({
        projectDir,
        config,
        env: { HYPERFRAMES_ASSET_LIBRARY: library },
      });

      expect(libraries.some((item) => item.name === "Pro" && item.path === library)).toBe(true);
      expect(libraries.filter((item) => item.path === library)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("searches libraries by query and kind", () => {
    withAssetFixture(({ libraries }) => {
      const matches = scanAssetLibraries({
        libraries,
        query: "neon token",
        kind: "image",
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.relativePath).toBe("logos/neon-brand-token.svg");
      expect(matches[0]?.id).toBe("Pro:logos/neon-brand-token.svg");
    });
  });

  it("copies a selected asset into the configured project assets directory", () => {
    withAssetFixture(({ projectDir, libraries }) => {
      const asset = firstAsset(libraries, "jane founder");

      const result = copyAssetToProject({
        asset,
        projectDir,
        assetsDir: "media",
      });

      expect(result.relativeTarget).toBe("media/people/jane-founder.png");
      expect(result.src).toBe("media/people/jane-founder.png");
      expect(existsSync(join(projectDir, "media/people/jane-founder.png"))).toBe(true);
      expect(readFileSync(join(projectDir, "media/people/jane-founder.png"), "utf-8")).toBe("png");
    });
  });

  it("refuses to overwrite copied assets unless force is enabled", () => {
    withAssetFixture(({ projectDir, libraries }) => {
      const asset = firstAsset(libraries, "jane founder");

      copyAssetToProject({ asset, projectDir, assetsDir: "assets" });
      expect(() => copyAssetToProject({ asset, projectDir, assetsDir: "assets" })).toThrow(
        /Refusing to overwrite/,
      );
      expect(() =>
        copyAssetToProject({ asset, projectDir, assetsDir: "assets", force: true }),
      ).not.toThrow();
    });
  });
});
