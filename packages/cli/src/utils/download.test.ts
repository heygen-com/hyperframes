import { describe, expect, it } from "vitest";

import { REDIRECT_CODES, redirectTarget } from "./download.js";

describe("redirect handling", () => {
  it("follows every redirect a host may answer with", () => {
    // 307 is the one that broke: HuggingFace answers the tokenizer with it,
    // and the original set stopped at 302, so the download fell through to the
    // not-200 branch and hung.
    for (const code of [301, 302, 303, 307, 308]) {
      expect(REDIRECT_CODES.has(code)).toBe(true);
    }
  });

  it("does not treat a success or an error as a redirect", () => {
    for (const code of [200, 204, 404, 500]) {
      expect(REDIRECT_CODES.has(code)).toBe(false);
    }
  });

  it("resolves a relative location against the url that sent it", () => {
    // The actual failure: handing this path back as a request target is not a
    // valid URL, so nothing was ever fetched.
    expect(
      redirectTarget(
        "/api/resolve-cache/models/x/tokenizer.json",
        "https://huggingface.co/x/resolve/main/tokenizer.json",
      ),
    ).toBe("https://huggingface.co/api/resolve-cache/models/x/tokenizer.json");
  });

  it("keeps an absolute location as it is", () => {
    expect(redirectTarget("https://cdn.example.com/blob", "https://huggingface.co/a/b")).toBe(
      "https://cdn.example.com/blob",
    );
  });

  it("resolves a sibling-relative location", () => {
    expect(redirectTarget("other.json", "https://example.com/a/b/file.json")).toBe(
      "https://example.com/a/b/other.json",
    );
  });
});
