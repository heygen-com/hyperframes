import { describe, expect, it } from "vitest";
import { HYPERFRAMES_BROWSER_MARKER_ARG, withHyperframesBrowserMarker } from "./browserMarker.js";

describe("withHyperframesBrowserMarker", () => {
  it("appends the marker to a copy of the args", () => {
    const args = ["--no-sandbox"];
    expect(withHyperframesBrowserMarker(args)).toEqual([
      "--no-sandbox",
      HYPERFRAMES_BROWSER_MARKER_ARG,
    ]);
    expect(args).toEqual(["--no-sandbox"]);
  });

  it("adds the marker once when a wrapper marks already-marked args", () => {
    expect(withHyperframesBrowserMarker(withHyperframesBrowserMarker())).toEqual([
      HYPERFRAMES_BROWSER_MARKER_ARG,
    ]);
  });
});
