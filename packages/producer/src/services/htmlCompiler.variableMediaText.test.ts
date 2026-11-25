// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { compileForRender } from "./htmlCompiler.js";

const FONT_URL = "https://fonts.example.com/brand.woff2";
const FONT_FILE = join(
  __dirname,
  "../../tests/heygen-promo-preview-assets/src/TT_Norms_Pro_Medium.woff2",
);

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (url: string, destDir: string) => {
    if (url !== FONT_URL) throw new Error("offline test");
    mkdirSync(destDir, { recursive: true });
    const local = join(destDir, "download_brand.woff2");
    copyFileSync(FONT_FILE, local);
    return local;
  },
  fetchPublicHttpsText: async () =>
    `@font-face { font-family: "Brand"; src: url("x\\"><script>window.__fromSheet = 1;</script>"); }`,
}));

const PAGE =
  `<!doctype html><html data-composition-variables='[{"id":"clip","type":"string","default":"clip.mp4"}]'>` +
  `<head><style>@font-face { font-family: "Brand"; src: url(${FONT_URL}); }</style></head>` +
  `<body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">` +
  `<video id="v" src="clip.mp4" data-var-src="clip" data-start="0" data-duration="1" data-track-index="0"></video>` +
  `<script>window.__authored = 1;</script></main></body></html>`;

describe("compileForRender with a variable bound to data-var-src", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-var-media-text-"));
    mkdirSync(join(projectDir, "fonts"));
    copyFileSync(FONT_FILE, join(projectDir, "fonts/local.woff2"));
    writeFileSync(join(projectDir, "index.html"), PAGE);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 400 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(projectDir, { recursive: true, force: true });
  });

  const compile = async (clip: string) => {
    const { html } = await compileForRender(
      projectDir,
      join(projectDir, "index.html"),
      join(projectDir, ".dl"),
      { allowSystemFontCapture: false, variables: { clip } },
    );
    return parseHTML(html).document;
  };

  it.each([
    [
      "a planted stylesheet link",
      `<link rel='stylesheet' href='https://fonts.example.com/brand.css'><script>window.__injected = 1;</script>`,
    ],
    [
      "a planted style block naming a project font",
      `<style>@font-face{font-family:B;src:url(fonts/local.woff2)}</style><script>window.__injected = 1;</script>`,
    ],
    ["a planted remote font url", `x.mp4?url(${FONT_URL})/onerror=window.__injected=1//`],
  ])("adds no element or attribute from %s", async (_route, clip) => {
    const document = await compile(clip);
    const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent ?? "");
    expect(
      scripts.some((text) => text.includes("__injected") || text.includes("__fromSheet")),
    ).toBe(false);
    expect(scripts.some((text) => text.includes("__authored"))).toBe(true);
    const names = document.getElementById("v")!.getAttributeNames();
    expect(names.filter((name) => /^on|["'()/]/.test(name))).toEqual([]);
    const styles = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "");
    expect(styles.join("\n")).not.toContain(`url(${FONT_URL})`);
  });
});
