import { describe, expect, it } from "vitest";
import { resolveProjectAssetPath } from "./projectAssetPath";

describe("resolveProjectAssetPath", () => {
  it("normalizes relative and ./ paths", () => {
    expect(resolveProjectAssetPath("assets/portrait.jpg")).toBe("assets/portrait.jpg");
    expect(resolveProjectAssetPath("./assets/portrait.jpg")).toBe("assets/portrait.jpg");
    expect(resolveProjectAssetPath("assets/./nested/../portrait.jpg")).toBe("assets/portrait.jpg");
  });

  it("resolves relative paths against the composition source file", () => {
    expect(resolveProjectAssetPath("../shared/hero.png", "scenes/intro.html")).toBe(
      "shared/hero.png",
    );
    expect(resolveProjectAssetPath("./hero.png", "scenes/intro.html")).toBe("scenes/hero.png");
  });

  it("strips query and hash", () => {
    expect(resolveProjectAssetPath("assets/portrait.jpg?v=2#top")).toBe("assets/portrait.jpg");
    expect(
      resolveProjectAssetPath(
        "http://localhost:3012/api/projects/demo/preview/assets/portrait.jpg?cache=1#x",
      ),
    ).toBe("assets/portrait.jpg");
  });

  it("safely URI-decodes without crashing on bad encoding", () => {
    expect(
      resolveProjectAssetPath(
        "http://localhost:3012/api/projects/demo/preview/assets/my%20file%20(1).jpg",
      ),
    ).toBe("assets/my file (1).jpg");
    expect(resolveProjectAssetPath("assets/bad%zz.jpg")).toBe("assets/bad%zz.jpg");
  });

  it("converts Studio preview URLs to project-relative paths", () => {
    expect(
      resolveProjectAssetPath(
        "http://localhost:3012/api/projects/demo/preview/assets/portrait.jpg",
      ),
    ).toBe("assets/portrait.jpg");
    expect(resolveProjectAssetPath("/api/projects/abc123/preview/assets/logo.png")).toBe(
      "assets/logo.png",
    );
  });

  it("rejects external http(s), data, blob, file, and protocol-relative URLs", () => {
    expect(resolveProjectAssetPath("https://cdn.example.com/photo.jpg")).toBeNull();
    expect(resolveProjectAssetPath("http://example.com/assets/photo.jpg")).toBeNull();
    expect(resolveProjectAssetPath("data:image/png;base64,abc")).toBeNull();
    expect(resolveProjectAssetPath("blob:http://localhost/abc")).toBeNull();
    expect(resolveProjectAssetPath("file:///Users/me/photo.jpg")).toBeNull();
    expect(resolveProjectAssetPath("//cdn.example.com/photo.jpg")).toBeNull();
  });

  it("rejects non-preview /api paths", () => {
    expect(resolveProjectAssetPath("/api/media/photo.jpg")).toBeNull();
    expect(resolveProjectAssetPath("/api/projects/demo/files/assets/photo.jpg")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveProjectAssetPath("")).toBeNull();
    expect(resolveProjectAssetPath("   ")).toBeNull();
  });
});
