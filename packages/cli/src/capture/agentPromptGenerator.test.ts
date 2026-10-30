import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateAgentPrompt } from "./agentPromptGenerator.js";
import type { DesignTokens } from "./types.js";

const tokens = {
  title: "Example",
  description: "",
  cssVariables: {},
  fonts: [],
  colors: ["#111111"],
} as unknown as DesignTokens;

describe("generateAgentPrompt", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("points agents at the hyperframes skill's film reference", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-agent-prompt-"));
    generateAgentPrompt(dir, "https://example.com", tokens, undefined, false);
    const prompt = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(prompt).toContain("use the `hyperframes` skill and read its `references/film.md`");
    expect(prompt).toContain("`references/types/launch.md`");
    expect(prompt).not.toContain("product-launch-video");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(prompt);
  });
});
