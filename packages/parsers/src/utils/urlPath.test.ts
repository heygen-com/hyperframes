import { describe, expect, it } from "vitest";
import {
  decodeUrlPathVariants,
  decodedUrlPath,
  encodeUrlPath,
  decodeCssEscapes,
} from "./urlPath.js";

describe("URL filename identity", () => {
  it("decodes valid escapes beside a literal percent while retaining the raw candidate", () => {
    expect(decodeUrlPathVariants("it's%20100%.mp4")).toEqual(["it's 100%.mp4", "it's%20100%.mp4"]);
  });
  it("removes URL suffixes before decoding encoded filename punctuation exactly once", () => {
    expect(decodedUrlPath("a%2520%3F%23.png?cache=1#view")).toBe("a%20?#.png");
  });
  it("normalizes CSS nulls and invalid escaped code points before URL encoding", () => {
    for (const escaped of ["\0", String.raw`\0`, String.raw`\d800`, String.raw`\110000`]) {
      expect(decodeCssEscapes(escaped)).toBe("\uFFFD");
    }
  });
  it("encodes a physical path for a CSS URL without changing path separators", () => {
    expect(encodeUrlPath("assets/it's (100%)?#.png")).toBe(
      "assets/it%27s%20%28100%25%29%3F%23.png",
    );
  });
});
