import { describe, expect, it } from "vitest";
import { normalizeCompositionSrc } from "./useRenderClipContent";

describe("normalizeCompositionSrc", () => {
  const origin = "http://localhost:5190";
  const pid = "my-project";

  it("strips absolute preview URL to relative path", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/my-project/preview/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe("compositions/intro.html");
  });

  it("preserves already-relative paths", () => {
    const result = normalizeCompositionSrc("compositions/intro.html", pid, origin);
    expect(result).toBe("compositions/intro.html");
  });

  it("preserves absolute URLs from different origins", () => {
    const result = normalizeCompositionSrc(
      "https://cdn.example.com/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe("https://cdn.example.com/compositions/intro.html");
  });

  it("preserves absolute URLs for different projects", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/other-project/preview/compositions/intro.html",
      pid,
      origin,
    );
    expect(result).toBe(
      "http://localhost:5190/api/projects/other-project/preview/compositions/intro.html",
    );
  });

  it("handles nested composition paths", () => {
    const result = normalizeCompositionSrc(
      "http://localhost:5190/api/projects/my-project/preview/compositions/scenes/hero.html",
      pid,
      origin,
    );
    expect(result).toBe("compositions/scenes/hero.html");
  });
});
