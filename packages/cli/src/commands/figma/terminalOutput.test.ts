// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FigmaClient } from "@hyperframes/core/figma";

vi.mock("@hyperframes/core/figma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/core/figma")>();
  const client: FigmaClient = {
    renderNode: () => Promise.reject(new Error("no render expected")),
    renderNodes: () => Promise.reject(new Error("no render expected")),
    imageFills: () => Promise.resolve(new Map()),
    variables: () => Promise.resolve({ variables: {}, variableCollections: {} }),
    styles: () => Promise.resolve([]),
    nodeTree: () => Promise.resolve({ id: "1:2", name: "n", type: "FRAME" }),
    fileVersion: () => Promise.resolve({ version: "7", lastModified: "2026-07-01" }),
  };
  return { ...actual, createFigmaClient: () => client };
});
vi.mock("../../telemetry/index.js", () => ({ trackFigmaImport: vi.fn() }));

const { default: assetCommand } = await import("./asset.js");
const { default: tokensCommand } = await import("./tokens.js");

function runAsset(dir: string): Promise<unknown> {
  return runCommand(assetCommand, { rawArgs: ["FILEKEY:1:2", "--format", "png", "--dir", dir] });
}

function captureOutput(): string[] {
  const lines: string[] = [];
  const capture = (...parts: unknown[]) => void lines.push(parts.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  return lines;
}

function writeRow(mediaRoot: string, row: Record<string, unknown>): void {
  writeFileSync(join(mediaRoot, "manifest.jsonl"), `${JSON.stringify(row)}\n`);
}

const PROVENANCE = {
  source: "figma",
  fileKey: "FILEKEY",
  nodeId: "1:2",
  version: "7",
  format: "png",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const RAW_CONTROLS = ["\u001b", "\u0007", "\r", "\u0085", "\u009b"];

// Windows refuses control characters in file and folder names, which these fixtures need.
describe.skipIf(process.platform === "win32")("figma terminal output", () => {
  it("prints a reused manifest row's id, path and description with visible escapes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-figma-asset-term-"));
    dirs.push(dir);
    const path = ".media/images/a\u001b]0;title\u0007\u009b2J.png";
    mkdirSync(join(dir, ".media", "images"), { recursive: true });
    writeFileSync(join(dir, path), PNG);
    writeRow(join(dir, ".media"), {
      id: "image_001\u001b[2K\r",
      type: "image",
      path,
      source: "figma:FILEKEY/1:2",
      description: "logo\u001b[1A\u0085forged",
      provenance: PROVENANCE,
    });
    const manifest = join(dir, ".media", "manifest.jsonl");
    const before = readFileSync(manifest);

    const lines = captureOutput();
    await runAsset(dir);

    const out = lines.join("\n");
    expect(lines[0]).toMatch(/^reused /);
    for (const control of RAW_CONTROLS) expect(out).not.toContain(control);
    expect(out).toContain("image_001\\x1b[2K\\x0d");
    expect(out).toContain("a\\x1b]0;title\\x07\\x9b2J.png");
    expect(out).toContain('alt="logo\\x1b[1A\\x85forged"');
    expect(readFileSync(manifest)).toEqual(before);
  });

  it("prints an index.md regeneration failure naming the project folder with visible escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-figma-asset-term-"));
    dirs.push(root);
    const dir = join(root, "proj\u001b]0;title\u0007");
    const media = join(root, "media");
    mkdirSync(join(media, "images"), { recursive: true });
    mkdirSync(dir);
    symlinkSync(media, join(dir, ".media"));
    writeFileSync(join(media, "images", "image_001.png"), PNG);
    writeRow(media, {
      id: "image_001",
      type: "image",
      path: ".media/images/image_001.png",
      source: "figma:FILEKEY/1:2",
      provenance: PROVENANCE,
    });

    const lines = captureOutput();
    await runAsset(dir);

    const warning = lines.find((line) => line.startsWith("index.md regeneration failed"));
    expect(warning).toContain("proj\\x1b]0;title\\x07");
    for (const control of RAW_CONTROLS) expect(lines.join("\n")).not.toContain(control);
  });

  it("prints the tokens sidecar path under a project folder with visible escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-figma-tokens-term-"));
    dirs.push(root);
    const dir = join(root, "proj\u001b[2J\u009b1A");
    mkdirSync(dir);

    const lines = captureOutput();
    await runCommand(tokensCommand, { rawArgs: ["FILEKEY", "--dir", dir] });

    expect(lines.join("\n")).toContain("proj\\x1b[2J\\x9b1A");
    for (const control of RAW_CONTROLS) expect(lines.join("\n")).not.toContain(control);
  });
});
