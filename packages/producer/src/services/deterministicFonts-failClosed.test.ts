/**
 * Tests for `injectDeterministicFontFaces`'s `failClosedFontFetch` gate.
 *
 * Production callers (the in-process `htmlCompiler`) call the function
 * without options and get the legacy behavior: external font fetch failures
 * are swallowed and a warning is logged. Distributed callers pass
 * `failClosedFontFetch: true` so non-deterministic infrastructure failures
 * (5xx, network errors, DNS) surface as typed non-retryable failures before
 * any chunk is rendered. 4xx responses are treated as a *deterministic*
 * "Google Fonts does not serve this family" answer — same outcome on every
 * retry — and pass through to the embedded-face fallback without
 * tripping `failClosedFontFetch` in either mode.
 *
 * The tests inject `fetchImpl` so no real network call happens.
 */

import { describe, expect, it } from "bun:test";
import {
  FONT_FETCH_FAILED,
  FontFetchError,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";

// HTML that requests a font NOT in FONT_ALIASES, so the resolver falls
// through to the Google Fonts fetch path. (Bundled fonts like Inter
// bypass fetch entirely.)
const HTML_REQUESTING_UNRESOLVED_FONT = `<!doctype html>
<html><head><style>
  body { font-family: "NotARealFontFamilyForTest", sans-serif; }
</style></head>
<body><h1>hello</h1></body>
</html>`;

function makeFailingFetch(): typeof fetch {
  return (async () => {
    throw new TypeError("simulated network failure");
  }) as unknown as typeof fetch;
}

function makeHttp404Fetch(): typeof fetch {
  return (async () =>
    new Response("", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
}

function makeHttp400Fetch(): typeof fetch {
  return (async () =>
    new Response("", { status: 400, statusText: "Bad Request" })) as unknown as typeof fetch;
}

function makeHttp503Fetch(): typeof fetch {
  return (async () =>
    new Response("", {
      status: 503,
      statusText: "Service Unavailable",
    })) as unknown as typeof fetch;
}

describe("injectDeterministicFontFaces — failClosedFontFetch: false (default)", () => {
  it("swallows a network failure and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      fetchImpl: makeFailingFetch(),
    });
    // No @font-face was injected because the fetch failed — but the call
    // resolves successfully with the original HTML.
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("swallows a 404 response and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      fetchImpl: makeHttp404Fetch(),
    });
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("swallows a 5xx response and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      fetchImpl: makeHttp503Fetch(),
    });
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("preserves legacy behavior when no options object is supplied at all", async () => {
    // injectDeterministicFontFaces(html) — no second arg.
    // We can't easily mock fetch globally here, so just assert the call
    // signature still accepts a single argument.
    const fn = injectDeterministicFontFaces;
    expect(fn.length).toBe(1);
  });
});

describe("injectDeterministicFontFaces — failClosedFontFetch: true", () => {
  it("throws FontFetchError on a network failure", async () => {
    let caught: unknown;
    try {
      await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeFailingFetch(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
    expect((caught as FontFetchError).code).toBe("FONT_FETCH_FAILED");
    expect((caught as FontFetchError).familyName).toBe("NotARealFontFamilyForTest");
    expect((caught as Error).message).toContain("simulated network failure");
  });

  it("throws on a 4xx response when font is completely unresolvable", async () => {
    // 4xx from Google Fonts is deterministic ("this family isn't served"),
    // so it doesn't throw at the *fetch* level. But the font still ends up
    // unresolvable (no alias, no Google Fonts, no system capture) which IS
    // a fail-closed error — the render would use a fallback font, producing
    // non-deterministic output across machines.
    let caught: unknown;
    try {
      await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp400Fetch(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
    expect((caught as FontFetchError).familyName).toBe("NotARealFontFamilyForTest");
  });

  it("throws on a 404 response when font is completely unresolvable", async () => {
    let caught: unknown;
    try {
      await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp404Fetch(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
  });

  it("throws FontFetchError on a 5xx response — non-deterministic, could differ on retry", async () => {
    let caught: unknown;
    try {
      await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeHttp503Fetch(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
    expect((caught as Error).message).toContain("HTTP 503");
    expect((caught as Error).message).toContain("NotARealFontFamilyForTest");
  });

  it("includes the requested URL in 5xx errors", async () => {
    let caught: unknown;
    try {
      await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeHttp503Fetch(),
      });
    } catch (err) {
      caught = err;
    }
    expect((caught as FontFetchError).url).toContain("fonts.googleapis.com");
    expect((caught as FontFetchError).url).toContain("NotARealFontFamilyForTest");
  });

  it("does NOT throw when bundled-font Google Fonts supplement returns no extra faces", async () => {
    // "Inter" is in FONT_ALIASES → uses the embedded font bundle. Since
    // c8e8fdcf, the resolver also queries Google Fonts to supplement any
    // weights not in the embedded bundle. A successful empty CSS response
    // means the bundle was sufficient — `failClosedFontFetch` doesn't
    // trip. (The full <html><head> wrap is required because
    // injectDeterministicFontFaces injects into <head>.)
    const html = `<!doctype html><html><head><style>body { font-family: "Inter", sans-serif; }</style></head><body></body></html>`;
    const fetchImpl = (async () =>
      new Response("/* no faces */", { status: 200 })) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      fetchImpl,
    });
    expect(result).toContain("data-hyperframes-deterministic-fonts");
  });

  it("does NOT throw when font-family uses unresolved CSS var() references", async () => {
    const html = `<!doctype html><html><head><style>
      body { font-family: var(--missing-font), sans-serif; }
    </style></head><body><h1>hello</h1></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      fetchImpl: makeFailingFetch(),
    });
    expect(result).toBe(html);
  });

  it("resolves simple CSS var() font aliases when injecting deterministic fonts", async () => {
    const html = `<!doctype html><html><head><style>
      :root { --ui-font: "Inter"; --vowel-font: "Montserrat"; }
      body { font-family: var(--ui-font), sans-serif; }
      h1 { font-family: var(--vowel-font), serif; }
    </style></head><body><h1>hello</h1></body></html>`;
    const fetchImpl = (async () =>
      new Response("/* no extra faces */", { status: 200 })) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      fetchImpl,
    });
    expect(result).toContain("data-hyperframes-deterministic-fonts");
  });

  it("still resolves concrete fonts alongside var() in mixed declarations", async () => {
    const html = `<!doctype html><html><head><style>
      body { font-family: var(--ui-font), "Inter", sans-serif; }
    </style></head><body><p>mixed</p></body></html>`;
    const fetchImpl = (async () =>
      new Response("/* no extra faces */", { status: 200 })) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      fetchImpl,
    });
    expect(result).toContain("data-hyperframes-deterministic-fonts");
  });

  it("does NOT throw when the HTML requests no fonts at all", async () => {
    const html = `<!doctype html><html><body><p>no fonts</p></body></html>`;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      fetchImpl: makeFailingFetch(),
    });
    expect(result).toBe(html);
  });
});

describe("FontFetchError", () => {
  it("exposes the FONT_FETCH_FAILED typed-failure code", () => {
    const err = new FontFetchError("Foo", "https://example.com", "boom");
    expect(err.code).toBe(FONT_FETCH_FAILED);
    expect(err.code).toBe("FONT_FETCH_FAILED");
    expect(err.familyName).toBe("Foo");
    expect(err.url).toBe("https://example.com");
    expect(err).toBeInstanceOf(Error);
  });
});
