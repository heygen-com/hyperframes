// @vitest-environment node
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTokensImport } from "./tokens.js";
import { FigmaClientError, type FigmaClient } from "@hyperframes/core/figma";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-figma-tokens-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function client(overrides: Partial<FigmaClient>): FigmaClient {
  return {
    renderNode: () => Promise.reject(new Error("unused")),
    imageFills: () => Promise.resolve(new Map()),
    variables: () =>
      Promise.resolve({
        variables: {
          "VariableID:1:1": {
            name: "Blue/500",
            key: "kblue",
            resolvedType: "COLOR",
            valuesByMode: { m1: { r: 0, g: 0.4, b: 1, a: 1 } },
          },
        },
        variableCollections: {},
      }),
    styles: () => Promise.resolve([{ key: "s1", name: "Primary", style_type: "FILL" }]),
    nodeTree: () => Promise.reject(new Error("unused")),
    fileVersion: () => Promise.resolve({ version: "7", lastModified: "2026-07-01" }),
    ...overrides,
  };
}

describe("runTokensImport", () => {
  it("imports variables: entries + sidecar + binding index", async () => {
    const out = await runTokensImport("FILE", { projectDir: dir, client: client({}) });
    expect(out.entries).toHaveLength(1);
    expect(out.mode).toBe("variables");
    const sidecar = JSON.parse(readFileSync(join(dir, "figma-tokens.json"), "utf8")) as {
      tokens: unknown[];
    };
    expect(sidecar.tokens).toHaveLength(1);
    const bindings = readFileSync(join(dir, ".media", "figma-bindings.jsonl"), "utf8");
    expect(bindings).toContain('"figmaId":"VariableID:1:1"');
  });

  it("falls back to styles metadata when variables are enterprise-gated", async () => {
    const gated = client({
      variables: () =>
        Promise.reject(new FigmaClientError("REQUIRES_ENTERPRISE", "enterprise only", 403)),
    });
    const out = await runTokensImport("FILE", { projectDir: dir, client: gated });
    expect(out.mode).toBe("styles");
    expect(out.entries).toEqual([]);
    const sidecar = JSON.parse(readFileSync(join(dir, "figma-tokens.json"), "utf8")) as {
      tokens: Array<{ name: string; type: string }>;
    };
    expect(sidecar.tokens[0]).toMatchObject({ name: "Primary", type: "style:FILL" });
  });

  it("propagates non-enterprise failures", async () => {
    const broken = client({
      variables: () => Promise.reject(new FigmaClientError("RATE_LIMITED", "429", 429)),
    });
    await expect(runTokensImport("FILE", { projectDir: dir, client: broken })).rejects.toThrow(
      /429/,
    );
    expect(existsSync(join(dir, "figma-tokens.json"))).toBe(false);
  });
});
