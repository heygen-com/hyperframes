import { describe, expect, it } from "vitest";
import {
  HYPERFRAMES_BROWSER_MARKER_ARG,
  withHyperframesBrowserMarker,
  withoutHyperframesOwner,
} from "./browserMarker.js";

describe("withHyperframesBrowserMarker", () => {
  it("appends the marker to a copy of the args", () => {
    const args = ["--no-sandbox"];
    expect(withHyperframesBrowserMarker(args, {})).toEqual([
      "--no-sandbox",
      HYPERFRAMES_BROWSER_MARKER_ARG,
    ]);
    expect(args).toEqual(["--no-sandbox"]);
  });

  it("adds the marker once when a wrapper marks already-marked args", () => {
    expect(withHyperframesBrowserMarker(withHyperframesBrowserMarker([], {}), {})).toEqual([
      HYPERFRAMES_BROWSER_MARKER_ARG,
    ]);
  });

  // fails without the fix: a caller running several renders at once could not tell whose browser was whose.
  it("names the caller's owner once, and only a plain id", () => {
    const owned = { HYPERFRAMES_OWNER: "run-7" };
    const args = withHyperframesBrowserMarker(withHyperframesBrowserMarker([], owned), owned);
    expect(args).toEqual([HYPERFRAMES_BROWSER_MARKER_ARG, "--hyperframes-owner=run-7"]);
    expect(withoutHyperframesOwner(args)).toEqual([HYPERFRAMES_BROWSER_MARKER_ARG]);
    expect(
      withHyperframesBrowserMarker([], { HYPERFRAMES_OWNER: "x --remote-debugging-port=9" }),
    ).toEqual([HYPERFRAMES_BROWSER_MARKER_ARG]);
  });
});
