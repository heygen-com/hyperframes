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

  // Pricing is LLM-facing contract too: the guide once labeled Enhance "the paid step", which
  // teaches Claude the wrong billing boundary. The shipped model (heygen-server
  // magic_edit/logic/usage_limits.py) is: import + enhance turns free; only Render is billed —
  // FREE accounts get 3 renders/month, paid plans 20 credits/rendered-minute. Pin the concept,
  // not an exact sentence, and block the retired Enhance-as-paid wording from returning.
  it("identifies Enhance as free and Render as the paid/billed step, with the tiered contract", () => {
    expect(GUIDE).toContain("Enhance turns are free");
    expect(GUIDE).toContain("Render is the paid step");
    expect(GUIDE).toContain("3 renders per month");
    expect(GUIDE).toContain("20 credits per rendered minute");
  });

  it("does not restore the retired 'Enhance ... paid step' wording", () => {
    expect(GUIDE).not.toContain("HeyGen media. This is the paid step");
  });
});
