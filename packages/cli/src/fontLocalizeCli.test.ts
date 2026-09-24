import { describe, expect, it, vi } from "vitest";

const injectDeterministicFontFaces = vi.fn(async (html: string) => html);

vi.mock("@hyperframes/producer", () => ({
  injectDeterministicFontFaces: (...args: Parameters<typeof injectDeterministicFontFaces>) =>
    injectDeterministicFontFaces(...args),
}));

// `localizeForPreviewBundle` is the preview-bundling activity's actual font-localization
// call site: a Temporal activity (bundle_preview) shells out to this CLI and hard-fails
// the whole activity (retried 3x, then the compose session) on a non-zero exit. Fonts
// that fail to resolve must substitute instead of raising, so preview bundling completes.
describe("localizeForPreviewBundle", () => {
  it("calls the injector fail-open, so an unresolved font substitutes instead of throwing", async () => {
    const { localizeForPreviewBundle } = await import("./fontLocalizeCli.js");
    injectDeterministicFontFaces.mockResolvedValueOnce("<html>localized</html>");

    await localizeForPreviewBundle("<html>source</html>");

    expect(injectDeterministicFontFaces).toHaveBeenCalledWith(
      "<html>source</html>",
      expect.objectContaining({ failClosedFontFetch: false }),
    );
  });

  it("stamps the localized output with producer and localizer versions", async () => {
    const { localizeForPreviewBundle } = await import("./fontLocalizeCli.js");
    injectDeterministicFontFaces.mockResolvedValueOnce(
      "<!doctype html><html><head></head><body></body></html>",
    );

    const result = await localizeForPreviewBundle("<html>source</html>");

    expect(result).toContain("hyperframes-font-compiler-version");
    expect(result).toContain("hyperframes-font-localizer-version");
  });
});
