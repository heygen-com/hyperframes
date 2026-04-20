import { describe, expect, it } from "vitest";
import { rewriteAssetPath, rewriteCssAssetUrls } from "./rewriteSubCompPaths.js";

describe("rewriteAssetPath", () => {
  it("rewrites `../` against the sub-composition dir", () => {
    expect(rewriteAssetPath("compositions/scene.html", "../icon.svg")).toBe("icon.svg");
  });

  it("leaves plain relative paths untouched", () => {
    expect(rewriteAssetPath("compositions/scene.html", "assets/logo.png")).toBe("assets/logo.png");
  });

  it("leaves absolute URLs and data URIs untouched", () => {
    expect(rewriteAssetPath("compositions/scene.html", "https://x/y")).toBe("https://x/y");
    expect(rewriteAssetPath("compositions/scene.html", "data:image/png;base64,AA")).toBe(
      "data:image/png;base64,AA",
    );
    expect(rewriteAssetPath("compositions/scene.html", "#hash")).toBe("#hash");
  });

  // Regression guard for a Windows-only bug: the rewriter used to import
  // `path` (native) and emit `:\fonts\brand.woff2` — native `join` used
  // backslashes, and `resolve("/", x).slice(1)` chopped the `D` off a
  // `D:\…` absolute path. URLs must be POSIX regardless of host OS.
  it("never emits backslashes on any platform", () => {
    const out = rewriteAssetPath("compositions/nested/scene.html", "../../fonts/brand.woff2");
    expect(out).toBe("fonts/brand.woff2");
    expect(out).not.toMatch(/\\/);
    expect(out).not.toMatch(/^:/);
  });

  it("CSS url(...) rewrites also stay POSIX under nesting", () => {
    const css = `@font-face { src: url("../../fonts/brand.woff2") format("woff2"); }`;
    const out = rewriteCssAssetUrls(css, "compositions/nested/scene.html");
    expect(out).toContain(`url("fonts/brand.woff2")`);
    expect(out).not.toMatch(/\\/);
    expect(out).not.toMatch(/:\\/);
  });
});
