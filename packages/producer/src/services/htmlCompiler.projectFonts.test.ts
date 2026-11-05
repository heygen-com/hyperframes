// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileForRender } from "./htmlCompiler.js";

vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async () => {
    throw new Error("offline test");
  },
  fetchPublicHttpsText: async () =>
    `@font-face { font-family: "Project Display"; src: url("https://cdn.example.com/display.woff2"); }`,
}));

// A distributed render must never ask the network for a font the project itself ships.
const FONT_FILE = join(
  __dirname,
  "../../tests/heygen-promo-preview-assets/src/TT_Norms_Pro_Medium.woff2",
);

const page = (head: string, body = "") => `<!doctype html>
<html><head>${head}</head>
<body><div id="root" data-composition-id="root" data-width="320" data-height="180" data-duration="1">
  <h1 style="font-family: 'Project Display', sans-serif">hello</h1>${body}
</div></body></html>`;

const FACE = `@font-face { font-family: "Project Display"; src: url("fonts/display.woff2") format("woff2"); }`;

describe("compileForRender with fonts shipped in the project", () => {
  let projectDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-project-fonts-"));
    mkdirSync(join(projectDir, "fonts"));
    copyFileSync(FONT_FILE, join(projectDir, "fonts/display.woff2"));
    fetchSpy = vi.fn(async () => new Response("", { status: 400 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(projectDir, { recursive: true, force: true });
  });

  const compile = (html: string) => {
    writeFileSync(join(projectDir, "index.html"), html);
    return compileForRender(projectDir, join(projectDir, "index.html"), join(projectDir, ".dl"), {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
    });
  };

  it("accepts a family whose @font-face in the page points at a project file", async () => {
    const { html } = await compile(page(`<style>${FACE}</style>`));
    expect(html).toContain("Project Display");
    expect(html).not.toContain('url("fonts/display.woff2")');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a family whose @font-face lives in a project stylesheet", async () => {
    writeFileSync(join(projectDir, "fonts.css"), FACE);
    const { html } = await compile(page(`<link rel="stylesheet" href="fonts.css">`));
    expect(html).toContain('<link rel="stylesheet" href="fonts.css">');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves a project stylesheet's font urls against the stylesheet's folder", async () => {
    mkdirSync(join(projectDir, "css"));
    writeFileSync(join(projectDir, "css/fonts.css"), FACE.replace("fonts/", "../fonts/"));
    const { html } = await compile(page(`<link rel="stylesheet" href="./css/fonts.css">`));
    expect(html).toContain('<link rel="stylesheet" href="./css/fonts.css">');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still fails closed when a project stylesheet names a font file the project lacks", async () => {
    writeFileSync(
      join(projectDir, "fonts.css"),
      FACE.replace("fonts/display.woff2", "fonts/missing.woff2"),
    );
    await expect(compile(page(`<link rel="stylesheet" href="fonts.css">`))).rejects.toThrow(
      /Unresolved fonts in fail-closed mode: Project Display/,
    );
  });

  it("accepts a family whose @font-face lives in a remote stylesheet", async () => {
    const { html } = await compile(
      page(`<link rel="stylesheet" href="https://cdn.example.com/fonts.css">`),
    );
    expect(html).toContain("Project Display");
  });
});
