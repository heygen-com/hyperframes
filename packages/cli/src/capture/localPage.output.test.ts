import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPartialCaptureState } from "./partialCapture.js";
import { generateProjectScaffold } from "./scaffolding.js";
import { CAPTURE_PHASE_SCHEMA } from "./types.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

const { attemptMock } = vi.hoisted(() => ({ attemptMock: vi.fn() }));
vi.mock("./captureAttempt.js", () => ({ captureWebsiteAttempt: attemptMock }));
import { captureWebsite } from "./index.js";

const REMOTE = "https://cdn.example.com/hero.png";

// Writes what a real attempt writes, through the real scaffold, with whatever URL it navigated.
async function fakeAttempt(opts: CaptureOptions): Promise<CaptureResult> {
  const pageUrl = new URL(opts.url);
  const localAsset = new URL("img/logo%20mark.png?v=2", pageUrl).href;
  const partial = createPartialCaptureState(opts);
  mkdirSync(join(opts.outputDir, "extracted"), { recursive: true });
  writeFileSync(
    join(opts.outputDir, "extracted", "assets-manifest.json"),
    JSON.stringify({ page: opts.url, assets: [{ url: localAsset }, { url: REMOTE }] }, null, 2),
  );
  writeFileSync(
    join(opts.outputDir, "extracted", "page.html"),
    `<img src="${localAsset}"><img src="${REMOTE}">`,
  );
  await generateProjectScaffold(
    opts.outputDir,
    opts.url,
    partial.tokens,
    undefined,
    false,
    false,
    false,
    [],
    () => {},
    [],
  );
  return {
    ok: true,
    projectDir: opts.outputDir,
    url: opts.url,
    httpStatus: 200,
    title: "",
    extracted: partial.extracted,
    screenshots: [],
    tokens: partial.tokens,
    assets: [
      { url: localAsset, localPath: "assets/logo.png", type: "image" },
      { url: REMOTE, localPath: "assets/hero.png", type: "image" },
    ],
    dropped: partial.dropped,
    warnings: [],
    lastPhase: {
      schema: CAPTURE_PHASE_SCHEMA,
      phase: "complete",
      status: "completed",
      remainingMs: 1,
    },
  };
}

let base: string;
let site: string;
let outputDir: string;

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-local-output-")));
  site = join(base, "Client Upload");
  outputDir = join(base, "out");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), "<h1>upload</h1>");
  attemptMock.mockImplementation(fakeAttempt);
});

afterEach(() => {
  attemptMock.mockReset();
  rmSync(base, { recursive: true, force: true });
});

function written(path: string): string {
  return readFileSync(join(outputDir, path), "utf8");
}

describe("local capture output", () => {
  it("never mentions the temporary loopback server", async () => {
    const result = await captureWebsite({ url: "", localFile: site, outputDir });
    const outputs = [
      written("meta.json"),
      written("AGENTS.md"),
      written("CLAUDE.md"),
      written("extracted/assets-manifest.json"),
      written("extracted/page.html"),
      JSON.stringify(result),
    ];
    for (const text of outputs) expect(text).not.toContain("127.0.0.1");

    const entry = pathToFileURL(join(site, "index.html")).href;
    const logo = `${pathToFileURL(join(site, "img", "logo mark.png")).href}?v=2`;
    expect(JSON.parse(written("meta.json"))).toEqual({
      id: "client-upload-video",
      name: "client-upload",
      source: entry,
    });
    expect(written("AGENTS.md")).toContain(`Source: ${entry}`);
    expect(JSON.parse(written("extracted/assets-manifest.json"))).toEqual({
      page: entry,
      assets: [{ url: logo }, { url: REMOTE }],
    });
    expect(result.url).toBe(entry);
    expect(result.assets.map((asset) => asset.url)).toEqual([logo, REMOTE]);
  });

  it("leaves URL-mode output as it was", async () => {
    const result = await captureWebsite({ url: "https://www.example.com/", outputDir });
    expect(JSON.parse(written("meta.json"))).toEqual({
      id: "example.com-video",
      name: "example.com",
    });
    expect(written("AGENTS.md")).toContain("Source: https://www.example.com/");
    expect(JSON.parse(written("extracted/assets-manifest.json")).assets).toEqual([
      { url: "https://www.example.com/img/logo%20mark.png?v=2" },
      { url: REMOTE },
    ]);
    expect(result.assets.map((asset) => asset.url)).toEqual([
      "https://www.example.com/img/logo%20mark.png?v=2",
      REMOTE,
    ]);
  });
});
