/**
 * Tests for the system font capture path (Path 3) in `buildFontFaceCss`.
 *
 * When a font family is not in FONT_ALIASES and not served by Google Fonts,
 * the resolver can locate it on the local filesystem, compress to woff2,
 * and embed it as a data URI. This path is controlled by the
 * `allowSystemFontCapture` option.
 *
 * Tests inject `fetchImpl` to simulate Google Fonts returning 400 (family
 * not served) so the resolver falls through to the system font path.
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { fontFormatHint, injectDeterministicFontFaces } from "./deterministicFonts.js";

// A font family that is NOT in FONT_ALIASES but exists on macOS as
// /System/Library/Fonts/Supplemental/Impact.ttf. When Google Fonts
// returns 400 for it, the system font locator should find it locally.
const SYSTEM_ONLY_FONT = "Impact";
const SYSTEM_ONLY_FONT_PATH = "/System/Library/Fonts/Supplemental/Impact.ttf";

function makeHtml(fontFamily: string): string {
  return `<!doctype html>
<html><head><style>
  body { font-family: "${fontFamily}", sans-serif; }
</style></head>
<body><h1>test</h1></body>
</html>`;
}

/** Google Fonts returns 400 for families it doesn't serve. */
function makeHttp400Fetch(): typeof fetch {
  return (async () =>
    new Response("", { status: 400, statusText: "Bad Request" })) as unknown as typeof fetch;
}

describe("system font capture — allowSystemFontCapture option", () => {
  it("uses the CSS collection hint for raw TTC data URIs", () => {
    expect(fontFormatHint("data:font/collection;base64,AA==")).toBe("collection");
    expect(fontFormatHint("data:font/woff2;base64,AA==")).toBe("woff2");
  });

  it("does not attempt system font capture when allowSystemFontCapture is false", async () => {
    const html = makeHtml("NotARealFontFamilyForTest");
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl: makeHttp400Fetch(),
      allowSystemFontCapture: false,
    });
    // No @font-face injected — the font is unresolved.
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("defaults allowSystemFontCapture to true when omitted", async () => {
    // Even without an explicit `allowSystemFontCapture`, the default is
    // `true` (`options.allowSystemFontCapture !== false`). We test this
    // with a non-existent font — the locator won't find it, so no
    // @font-face is injected, but importantly we verify it doesn't throw.
    const html = makeHtml("ZZZDefinitelyNotInstalledAnywhere");
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl: makeHttp400Fetch(),
      // allowSystemFontCapture intentionally omitted
    });
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  }, 15_000); // The system font locator runs system_profiler on macOS which can take >5s.
});

describe("system font capture — integration (macOS only)", () => {
  const hasFontLocally = existsSync(SYSTEM_ONLY_FONT_PATH);

  it("embeds a local system font when Google Fonts returns 400", async () => {
    if (!hasFontLocally) {
      console.warn(`Skipping: ${SYSTEM_ONLY_FONT_PATH} not available`);
      return;
    }

    const html = makeHtml(SYSTEM_ONLY_FONT);
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl: makeHttp400Fetch(),
      allowSystemFontCapture: true,
    });

    // The system font was found and embedded as a data URI.
    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(result).toContain(`font-family: "${SYSTEM_ONLY_FONT}"`);
    expect(result).toContain("data:font/woff2;base64,");
  });

  it("skips system font capture when allowSystemFontCapture is false even if font exists locally", async () => {
    if (!hasFontLocally) {
      console.warn(`Skipping: ${SYSTEM_ONLY_FONT_PATH} not available`);
      return;
    }

    const html = makeHtml(SYSTEM_ONLY_FONT);
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl: makeHttp400Fetch(),
      allowSystemFontCapture: false,
    });

    // System font capture disabled — font stays unresolved.
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("still resolves alias-mapped fonts via embedded bundle regardless of allowSystemFontCapture", async () => {
    // "Inter" is in FONT_ALIASES → resolved via embedded bundle, not system font capture.
    const html = makeHtml("Inter");
    const result = await injectDeterministicFontFaces(html, {
      fetchImpl: makeHttp400Fetch(),
      allowSystemFontCapture: false,
    });

    // Even with system font capture disabled, Inter resolves via the alias map.
    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(result).toContain('font-family: "Inter"');
  });
});
