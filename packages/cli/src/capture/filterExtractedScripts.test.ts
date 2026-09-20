import { describe, expect, it } from "vitest";
import { filterExtractedScripts } from "./filterExtractedScripts.js";

describe("filterExtractedScripts", () => {
  it("removes framework scripts while preserving surrounding markup", () => {
    const result = filterExtractedScripts(
      "<main><h1>Welcome</h1><script>self.__next_f.push([])</script></main>",
      '<style>body{color:red}</style><script src="/_next/static/chunks/main.js"></script>',
    );

    expect(result.bodyHtml).toContain("<main><h1>Welcome</h1></main>");
    expect(result.headHtml).toContain("<style>body{color:red}</style>");
    expect(result.bodyHtml).not.toContain("__next_f");
    expect(result.headHtml).not.toContain("/_next/static/chunks/main.js");
  });
});
