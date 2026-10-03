import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: packages/engine/src/services/drawElementService.ts,
// frameCapture.ts, packages/producer/.../compileStage.ts,
// fallbackCaptureProfile.ts, validate-fast-video.ts, and
// .github/workflows/fast-video-validation.yml all cite specific numbered
// limitations in docs/fast-capture-limitations.md -- but that file never
// existed anywhere in the repo (PRINFRA-301), so every one of those
// references was dangling. Pin both that the doc exists and that it still
// defines every limitation number cited elsewhere in the codebase, so a
// future rename/removal can't silently orphan a reference again.
const DOC_PATH = join(__dirname, "..", "..", "docs", "fast-capture-limitations.md");

// Numbers cited by name ("Lim N" / "Limitation N") at least once in the
// codebase as of this writing -- keep in sync if a new numbered citation is
// added elsewhere.
const CITED_LIMITATION_NUMBERS = [2, 6, 7];

describe("fast-capture-limitations.md", () => {
  it("exists at the path the fast-capture gates reference", () => {
    expect(() => readFileSync(DOC_PATH, "utf8")).not.toThrow();
  });

  it("defines every limitation number cited elsewhere in the codebase", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const n of CITED_LIMITATION_NUMBERS) {
      expect(doc).toMatch(new RegExp(`^## Limitation ${n}\\b`, "m"));
    }
  });
});
