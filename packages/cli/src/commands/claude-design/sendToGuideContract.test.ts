// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Semantic pin for the Claude Design "Send to HyperFrames" authoring guide. The guide is
// LLM-facing prompt text, so a wording regression silently reintroduces a real failure mode.
// A live Send-to import genericized a source design's concrete figures ("2.4M signals/sec" ->
// "streaming now") because the guide both called the rebuild "lossy by nature" AND demanded
// "content match the brief exactly" — a contradiction with no rule for what to preserve. This
// pins the resolved "preserve substance, adapt form" instruction and asserts the two retired
// contradictory phrases cannot silently return. validate-docs proves syntax, not intent.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const GUIDE = readFileSync(
  join(REPO_ROOT, "docs", "guides", "claude-design-send-to-hyperframes.md"),
  "utf8",
);

describe("Send-to guide fidelity contract", () => {
  it("carries the resolved 'preserve substance, adapt form' instruction", () => {
    expect(GUIDE).toContain("Preserve substance; adapt form");
    expect(GUIDE).toContain("do NOT genericize");
    expect(GUIDE).toContain("do NOT invent copy or numbers");
  });

  it("does not restore the retired contradictory fidelity phrasing", () => {
    expect(GUIDE).not.toContain("lossy by nature");
    expect(GUIDE).not.toContain("content match the brief exactly");
  });
});
