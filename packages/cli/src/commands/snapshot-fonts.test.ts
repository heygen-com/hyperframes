import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bundleToSingleHtml: vi.fn(async () => "<html><head></head><body>bundled</body></html>"),
  injectDeterministicFontFaces: vi.fn(async (html: string) => `${html}\n<!-- fonts -->`),
}));

vi.mock("@hyperframes/core/compiler", () => ({
  bundleToSingleHtml: mocks.bundleToSingleHtml,
}));
vi.mock("@hyperframes/producer", () => ({
  injectDeterministicFontFaces: mocks.injectDeterministicFontFaces,
}));

import { prepareSnapshotHtml } from "./snapshot.js";

describe("prepareSnapshotHtml", () => {
  it("injects the same deterministic font faces used by render", async () => {
    const html = await prepareSnapshotHtml("/project");

    expect(mocks.bundleToSingleHtml).toHaveBeenCalledWith("/project");
    expect(mocks.injectDeterministicFontFaces).toHaveBeenCalledWith(
      "<html><head></head><body>bundled</body></html>",
    );
    expect(html).toContain("<!-- fonts -->");
  });
});
