import { describe, it, expect } from "vitest";

import { pretext } from "./pretext.js";

// Behavior is not asserted here on purpose. `prepare` measures fonts through a
// canvas, which Node does not have, so the real measuring is covered by the
// browser check in `packages/cli` rather than mocked into meaninglessness here.
// What this file guards is the shape of the published surface.
describe("pretext runtime surface", () => {
  it("exposes the documented prepare and layout functions", () => {
    // The skill file agents are required to read documents
    // `window.__hyperframes.pretext.prepare(...)` / `.layout(...)`. If either
    // name disappears, every composition written against that doc throws.
    expect(typeof pretext.prepare).toBe("function");
    expect(typeof pretext.layout).toBe("function");
  });

  it("exposes the width helpers the documented shrinkwrap case needs", () => {
    // `layout` returns only { lineCount, height }. Width has to come from
    // these, so without them "shrinkwrap containers" is not actually doable.
    expect(typeof pretext.prepareWithSegments).toBe("function");
    expect(typeof pretext.measureLineStats).toBe("function");
    expect(typeof pretext.measureNaturalWidth).toBe("function");
  });

  it("does not expose the globally-stateful functions", () => {
    // clearCache/setLocale mutate state shared across compositions, which
    // would make a render depend on what ran before it.
    expect("clearCache" in pretext).toBe(false);
    expect("setLocale" in pretext).toBe(false);
  });
});
