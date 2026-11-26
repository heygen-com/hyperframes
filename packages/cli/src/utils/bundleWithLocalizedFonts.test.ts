import { afterEach, describe, expect, it, vi } from "vitest";

const producerMocks = vi.hoisted(() => ({
  loadProducer: vi.fn(async () => ({
    injectDeterministicFontFaces: async (html: string) => `${html}<!--bundled-producer-->`,
  })),
}));

vi.mock("@hyperframes/core/compiler", () => ({
  bundleToSingleHtml: vi.fn(async () => "<html><body>bundled</body></html>"),
}));

vi.mock("./producer.js", () => ({
  loadProducer: producerMocks.loadProducer,
}));

import {
  __resetFontLocalizationWarningsForTests,
  bundleWithLocalizedFonts,
  localizeWithProducer,
} from "./bundleWithLocalizedFonts.js";

afterEach(() => {
  __resetFontLocalizationWarningsForTests();
  vi.clearAllMocks();
});

describe("bundleWithLocalizedFonts (call-site integration)", () => {
  it("runs the injected font localizer over the plain bundle", async () => {
    const localize = vi.fn(async (html: string) => html.replace("bundled", "bundled+fonts"));
    const html = await bundleWithLocalizedFonts("/project", localize);
    expect(localize).toHaveBeenCalledOnce();
    expect(localize).toHaveBeenCalledWith("<html><body>bundled</body></html>");
    expect(html).toBe("<html><body>bundled+fonts</body></html>");
  });

  it("returns the localizer output verbatim (localization is the last step)", async () => {
    const html = await bundleWithLocalizedFonts("/project", async () => "<html>embedded</html>");
    expect(html).toBe("<html>embedded</html>");
  });
});

describe("localizeWithProducer", () => {
  it("loads the injector through the producer module bundled with the CLI", async () => {
    const out = await localizeWithProducer("<html></html>");
    expect(producerMocks.loadProducer).toHaveBeenCalledOnce();
    expect(out).toBe("<html></html><!--bundled-producer-->");
  });

  it("embeds fonts when the injector is available", async () => {
    const inject = vi.fn(async (html: string) => `${html}<!--fonts-->`);
    const warn = vi.fn();
    const out = await localizeWithProducer("<html></html>", async () => inject, warn);
    expect(out).toBe("<html></html><!--fonts-->");
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails open silently when producer is unavailable (module absent → null)", async () => {
    const warn = vi.fn();
    const out = await localizeWithProducer("<html>plain</html>", async () => null, warn);
    // Never worse than a plain bundle; benign absence is not a warning.
    expect(out).toBe("<html>plain</html>");
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails open WITH a diagnostic when the injector itself throws", async () => {
    const warn = vi.fn();
    const boom: () => Promise<never> = () => Promise.reject(new Error("fetch layer down"));
    const out = await localizeWithProducer("<html>plain</html>", async () => boom, warn);
    expect(out).toBe("<html>plain</html>");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("fetch layer down");
  });

  it("dedups repeated identical injector failures across re-bundles", async () => {
    const warn = vi.fn();
    const boom: () => Promise<never> = () => Promise.reject(new Error("same failure"));
    for (let i = 0; i < 5; i++) {
      await localizeWithProducer("<html></html>", async () => boom, warn);
    }
    // snapshot/check re-bundle per grid point; the warning must fire once.
    expect(warn).toHaveBeenCalledOnce();
  });

  // fails without the fix: a font address from the project reached the terminal with its ESC raw
  it("prints the injector's failure with control characters as visible escapes", async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const printed = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const boom: () => Promise<never> = () =>
      Promise.reject(
        new Error(`cannot fetch fonts/brand${esc}]0;owned${String.fromCharCode(7)}.woff2`),
      );
    await localizeWithProducer("<html></html>", async () => boom);
    const line = String(printed.mock.calls[0]?.[0]).replace(
      new RegExp(`${esc}\\[[0-9;]*m`, "g"),
      "",
    );
    printed.mockRestore();
    expect(line).not.toContain(esc);
    expect(line).toContain("cannot fetch fonts/brand\\x1b]0;owned\\x07.woff2");
  });
});
