// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { compileForRender } from "./htmlCompiler.js";

const SHEET = "https://fonts.example.com/brand.css";
const requested = vi.hoisted(() => [] as string[]);

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (url: string) => {
    requested.push(url);
    throw new Error("offline test");
  },
  fetchPublicHttpsText: async (url: string) => {
    requested.push(url);
    if (url !== SHEET) throw new Error("offline test");
    return (
      `@font-face { font-family: "Brand</style><script>window.__fromSheet = 1;</script>` +
      `<script src="https://elsewhere.example/x.js"></script>` +
      `<img src="https://elsewhere.example/i.png"><style>"; src: url("https://fonts.example.com/brand.woff2"); }`
    );
  },
}));

describe("compileForRender with a remote font stylesheet", () => {
  let projectDir: string;

  beforeEach(() => {
    requested.length = 0;
    projectDir = mkdtempSync(join(tmpdir(), "hf-remote-font-text-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 400 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps the sheet's text inside its style element as CSS", async () => {
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head><link rel="stylesheet" href="${SHEET}"></head>` +
        `<body><div id="root" data-composition-id="root" data-width="320" data-height="180" data-duration="1">` +
        `<h1 style="font-family: Brand, sans-serif">hello</h1></div></body></html>`,
    );

    const { html } = await compileForRender(
      projectDir,
      join(projectDir, "index.html"),
      join(projectDir, ".dl"),
    );

    const { document } = parseHTML(html);
    const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent ?? "");
    expect(scripts.some((text) => text.includes("__fromSheet"))).toBe(false);
    expect(document.querySelector('script[src*="elsewhere"], img[src*="elsewhere"]')).toBeNull();
    expect(requested.filter((url) => url.includes("elsewhere"))).toEqual([]);
    const styles = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "");
    expect(styles.some((text) => text.includes("\\3c /style>\\3c script>"))).toBe(true);
  });
});
