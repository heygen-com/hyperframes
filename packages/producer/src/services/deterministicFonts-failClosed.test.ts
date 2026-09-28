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

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { defaultLogger } from "../logger.js";
import {
  _clearGoogleFontCssCacheForTests,
  FONT_FETCH_FAILED,
  FONT_FETCH_UNAVAILABLE,
  FontFetchError,
  FontFetchUnavailableError,
  injectDeterministicFontFaces,
  normalizeSystemFontPrimaryFamilies,
} from "./deterministicFonts.js";

// The Google Fonts CSS cache is process-lifetime and keyed by URL; several
// tests here request the same unresolved-font URL, so a leftover entry from
// an earlier test would silently skip this test's own fetchImpl.
beforeEach(() => _clearGoogleFontCssCacheForTests());

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

function makeGoogleFontFetch(cssRequests: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    if (requestUrl.startsWith("https://fonts.googleapis.com/")) {
      cssRequests.push(requestUrl);
      const family = new URL(requestUrl).searchParams.get("family")?.split(":", 1)[0] ?? "test";
      const fontUrl = `https://fonts.gstatic.com/s/test/v1/${family.toLowerCase().replace(/\s+/g, "-")}.woff2`;
      return new Response(
        `@font-face {
          font-style: normal;
          font-weight: 400;
          src: url(${fontUrl}) format('woff2');
        }`,
        { status: 200 },
      );
    }
    return new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
}

async function rejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

describe("injectDeterministicFontFaces — failClosedFontFetch: false (default)", () => {
  it("swallows a network failure and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      allowSystemFontCapture: false,
      fetchImpl: makeFailingFetch(),
    });
    // No @font-face was injected because the fetch failed — but the call
    // resolves successfully with the original HTML.
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("swallows a 404 response and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      allowSystemFontCapture: false,
      fetchImpl: makeHttp404Fetch(),
    });
    expect(result.includes("data-hyperframes-deterministic-fonts")).toBe(false);
  });

  it("swallows a 5xx response and returns the original HTML (no throw)", async () => {
    const result = await injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
      failClosedFontFetch: false,
      allowSystemFontCapture: false,
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
  for (const [authoredFamily, googleFamily] of [
    ["DM+Mono", "DM Mono"],
    ["IBM+Plex+Mono", "IBM Plex Mono"],
    ["Spline+Sans+Mono", "Spline Sans Mono"],
  ] as const) {
    it(`resolves URL-style family ${authoredFamily} through Google Fonts`, async () => {
      const cssRequests: string[] = [];
      const html = `<!doctype html><html><head><style>
        body { font-family: "${authoredFamily}", monospace; }
      </style></head><body><p>hello</p></body></html>`;

      const result = await injectDeterministicFontFaces(html, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeGoogleFontFetch(cssRequests),
      });

      expect(cssRequests).toHaveLength(1);
      const familyParam = new URL(cssRequests[0]!).searchParams.get("family");
      expect(familyParam?.startsWith(`${googleFamily}:`)).toBe(true);
      expect(familyParam?.startsWith(`${authoredFamily}:`)).toBe(false);
      expect(result).toContain(`font-family: "${authoredFamily}"`);
      expect(result).toContain("data-hyperframes-deterministic-fonts");
    });
  }

  it("throws FontFetchUnavailableError after retrying a network failure", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeFailingFetch(),
        fontFetchRetryPolicy: { baseDelayMs: 0 },
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect(caught).toBeInstanceOf(FontFetchUnavailableError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_UNAVAILABLE);
    expect((caught as FontFetchError).code).toBe("FONT_FETCH_UNAVAILABLE");
    expect((caught as FontFetchError).familyName).toBe("NotARealFontFamilyForTest");
    expect((caught as Error).message).toContain("simulated network failure");
  });

  it("throws on a 4xx response when font is completely unresolvable", async () => {
    // 4xx from Google Fonts is deterministic ("this family isn't served"),
    // so it doesn't throw at the *fetch* level. But the font still ends up
    // unresolvable (no alias, no Google Fonts, no system capture) which IS
    // a fail-closed error — the render would use a fallback font, producing
    // non-deterministic output across machines.
    const caught = await rejectedError(
      injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp400Fetch(),
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
    expect((caught as FontFetchError).familyName).toBe("NotARealFontFamilyForTest");
  });

  it("throws on a 404 response when font is completely unresolvable", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp404Fetch(),
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
  });

  it("fails closed when a secondary family in the authored cascade is unresolved", async () => {
    const html = `<!doctype html><html><head><style>
      body { font-family: "Inter", "Author Custom Fallback", sans-serif; }
    </style></head><body><p>hello</p></body></html>`;
    const fetchImpl = (async (input: string | URL | Request) => {
      const family = new URL(input instanceof Request ? input.url : String(input)).searchParams.get(
        "family",
      );
      return family?.startsWith("Inter:")
        ? new Response("/* bundled Inter is sufficient */", { status: 200 })
        : new Response("", { status: 400 });
    }) as unknown as typeof fetch;

    const caught = await rejectedError(
      injectDeterministicFontFaces(html, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl,
      }),
    );

    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).familyName).toContain("Author Custom Fallback");
  });

  it("throws FontFetchUnavailableError on an exhausted 5xx response", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeHttp503Fetch(),
        fontFetchRetryPolicy: { baseDelayMs: 0 },
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect(caught).toBeInstanceOf(FontFetchUnavailableError);
    expect((caught as FontFetchError).code).toBe(FONT_FETCH_UNAVAILABLE);
    expect((caught as Error).message).toContain("HTTP 503");
    expect((caught as Error).message).toContain("NotARealFontFamilyForTest");
  });

  it("includes the requested URL in 5xx errors", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(HTML_REQUESTING_UNRESOLVED_FONT, {
        failClosedFontFetch: true,
        fetchImpl: makeHttp503Fetch(),
        fontFetchRetryPolicy: { baseDelayMs: 0 },
      }),
    );
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

  it("does NOT throw when font-family uses a CSS var() reference with a fallback", async () => {
    const html = `<!doctype html><html><head><style>
      .title { font-family: var(--brand-font, inherit); }
    </style></head><body><h1 class="title">hello</h1></body></html>`;
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

describe("fail-closed fonts named only in an undefined var() fallback", () => {
  const styled = (css: string) =>
    `<!doctype html><html><head><style>${css}</style></head><body><p>hello</p></body></html>`;

  it("injects what resolves from a Tailwind v4 stack and skips the rest", async () => {
    const html = normalizeSystemFontPrimaryFamilies(
      styled(
        `body { font-family: var(--default-font-family, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"); }`,
      ),
    );
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl: makeHttp400Fetch(),
    });
    expect(result).toContain(`font-family: "Inter";`);
  });

  it("still throws for an unresolved family in a direct list", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(styled(`body { font-family: "Acme Brand Sans", sans-serif; }`), {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp400Fetch(),
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).familyName).toContain("Acme Brand Sans");
  });

  it("tries a fallback-only family and tolerates it not being found", async () => {
    const html = styled(`body { font-family: var(--brand, "Acme Brand Sans", sans-serif); }`);
    let requests = 0;
    const notFound = makeHttp400Fetch();
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      requests += 1;
      return notFound(...args);
    }) as unknown as typeof fetch;
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl,
    });
    expect(result).toBe(html);
    expect(requests).toBeGreaterThan(0);
  });

  it.each([
    [`:root { --a: var(--b); --b: "Acme Brand Sans"; } body { font-family: var(--a), serif; }`],
    [`:root { --b: "Acme Brand Sans"; } body { font-family: var(--unset, var(--b)), serif; }`],
  ])("tolerates a family behind a chain of var()s not being found: %s", async (css) => {
    const html = styled(css);
    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl: makeHttp400Fetch(),
    });
    expect(result).toBe(html);
  });

  it("keeps a family named after a leading var() required", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(
        styled(`body { font-family: var(--unset, Inter), "Acme Brand Sans", serif; }`),
        { failClosedFontFetch: true, allowSystemFontCapture: false, fetchImpl: makeHttp400Fetch() },
      ),
    );
    expect((caught as FontFetchError).familyName).toContain("Acme Brand Sans");
  });

  it("keeps a family required behind one defined var()", async () => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(
        styled(`:root { --a: "Acme Brand Sans"; } body { font-family: var(--a), serif; }`),
        { failClosedFontFetch: true, allowSystemFontCapture: false, fetchImpl: makeHttp400Fetch() },
      ),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
  });

  describe("a transient failure on a fallback-only family", () => {
    const FALLBACK_ONLY = styled(
      `body { font-family: var(--brand, "Acme Brand Sans", sans-serif); }`,
    );
    let warnings: string[] = [];
    let warnSpy: ReturnType<typeof spyOn>;
    beforeEach(() => {
      warnings = [];
      warnSpy = spyOn(defaultLogger, "warn").mockImplementation((message: string) => {
        warnings.push(message);
      });
    });
    afterEach(() => warnSpy.mockRestore());

    const counting = (inner: typeof fetch) => {
      const counter = { requests: 0 };
      const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
        counter.requests += 1;
        return inner(...args);
      }) as unknown as typeof fetch;
      return { counter, fetchImpl };
    };
    const hangingFetch = (async (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const optionalWarnings = () => warnings.filter((w) => w.includes("Optional font"));

    it.each([
      ["HTTP 503", makeHttp503Fetch],
      ["a network failure", makeFailingFetch],
    ])("retries once on %s, then renders the fallback and warns", async (_label, makeFetch) => {
      const { counter, fetchImpl } = counting(makeFetch());
      const result = await injectDeterministicFontFaces(FALLBACK_ONLY, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl,
        fontFetchRetryPolicy: { baseDelayMs: 0, maxAttempts: 3 },
      });
      expect(result).toBe(FALLBACK_ONLY);
      expect(counter.requests).toBe(2);
      expect(optionalWarnings()).toHaveLength(1);
      expect(optionalWarnings()[0]).toContain(`"Acme Brand Sans"`);
    });

    it("fetches a required family before hanging optional ones spend the budget", async () => {
      const requested: string[] = [];
      const notFound = makeHttp400Fetch();
      const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requested.push(String(input));
        return String(input).includes("Required")
          ? notFound(input, init)
          : hangingFetch(input, init);
      }) as unknown as typeof fetch;
      const caught = await rejectedError(
        injectDeterministicFontFaces(
          styled(
            `.a { font-family: var(--a, "Optional One"), serif; } .b { font-family: var(--b, "Optional Two"), serif; } .c { font-family: "Required Face", serif; }`,
          ),
          {
            failClosedFontFetch: true,
            allowSystemFontCapture: false,
            fetchImpl,
            fontFetchRetryPolicy: { baseDelayMs: 0, attemptTimeoutMs: 100, maxElapsedMs: 300 },
          },
        ),
      );
      expect((caught as FontFetchError).code).toBe(FONT_FETCH_FAILED);
      expect(requested.some((url) => url.includes("Required"))).toBe(true);
    });

    it("keeps the bundled Inter faces and warns when its top-up fetch fails", async () => {
      const html = styled(`body { font-family: var(--brand, Inter, sans-serif); }`);
      const result = await injectDeterministicFontFaces(html, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp503Fetch(),
        fontFetchRetryPolicy: { baseDelayMs: 0 },
      });
      expect(result).toContain(`font-family: "Inter";`);
      expect(optionalWarnings()).toHaveLength(1);
      expect(optionalWarnings()[0]).toContain(`"Inter"`);
    });

    it("gives up on a hanging fetch within the per-attempt bound and warns", async () => {
      const { counter, fetchImpl } = counting(hangingFetch);
      const started = Date.now();
      const result = await injectDeterministicFontFaces(FALLBACK_ONLY, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl,
        fontFetchRetryPolicy: { baseDelayMs: 0, attemptTimeoutMs: 50, maxAttempts: 3 },
      });
      expect(result).toBe(FALLBACK_ONLY);
      expect(counter.requests).toBe(2);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(optionalWarnings()[0]).toContain(`"Acme Brand Sans"`);
    });

    it("injects the face when the retry succeeds, without a warning", async () => {
      const served = makeGoogleFontFetch([]);
      const unavailable = makeHttp503Fetch();
      let calls = 0;
      const fetchImpl = (async (...args: Parameters<typeof fetch>) =>
        (calls += 1) === 1 ? unavailable(...args) : served(...args)) as unknown as typeof fetch;
      const result = await injectDeterministicFontFaces(FALLBACK_ONLY, {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl,
        fontFetchRetryPolicy: { baseDelayMs: 0 },
      });
      expect(result).toContain("data-hyperframes-deterministic-fonts");
      expect(result).toContain(`font-family: "Acme Brand Sans"`);
      expect(optionalWarnings()).toHaveLength(0);
    });

    it("still aborts when the caller cancels", async () => {
      const controller = new AbortController();
      const reason = new Error("caller cancelled");
      setTimeout(() => controller.abort(reason), 20);
      const caught = await rejectedError(
        injectDeterministicFontFaces(FALLBACK_ONLY, {
          failClosedFontFetch: true,
          allowSystemFontCapture: false,
          fetchImpl: hangingFetch,
          abortSignal: controller.signal,
          fontFetchRetryPolicy: { baseDelayMs: 0, attemptTimeoutMs: 5_000 },
        }),
      );
      expect(caught).toBe(reason);
      expect(optionalWarnings()).toHaveLength(0);
    });

    it("keeps a required family fail-closed after all its attempts", async () => {
      const { counter, fetchImpl } = counting(makeHttp503Fetch());
      const caught = await rejectedError(
        injectDeterministicFontFaces(
          styled(`body { font-family: "Acme Brand Sans", sans-serif; }`),
          {
            failClosedFontFetch: true,
            allowSystemFontCapture: false,
            fetchImpl,
            fontFetchRetryPolicy: { baseDelayMs: 0, maxAttempts: 3 },
          },
        ),
      );
      expect(caught).toBeInstanceOf(FontFetchUnavailableError);
      expect(counter.requests).toBe(3);
      expect(optionalWarnings()).toHaveLength(0);
    });

    it("does not hand a required family the optional retry count for the same request", async () => {
      const { counter, fetchImpl } = counting(makeHttp503Fetch());
      const fontFetchRetryPolicy = { baseDelayMs: 0, maxAttempts: 3 };
      const [optionalResult, requiredError] = await Promise.all([
        injectDeterministicFontFaces(FALLBACK_ONLY, {
          failClosedFontFetch: true,
          allowSystemFontCapture: false,
          fetchImpl,
          fontFetchRetryPolicy,
        }),
        rejectedError(
          injectDeterministicFontFaces(
            styled(
              `body { font-family: var(--brand, "Acme Brand Sans", sans-serif); } p { font-family: "Acme Brand Sans"; }`,
            ),
            {
              failClosedFontFetch: true,
              allowSystemFontCapture: false,
              fetchImpl,
              fontFetchRetryPolicy,
            },
          ),
        ),
      ]);
      expect(optionalResult).toBe(FALLBACK_ONLY);
      expect(requiredError).toBeInstanceOf(FontFetchUnavailableError);
      expect(counter.requests).toBe(5);
    });

    it("keeps a family fail-closed when it is also named directly", async () => {
      const caught = await rejectedError(
        injectDeterministicFontFaces(
          styled(
            `.a { font-family: var(--brand, "Acme Brand Sans", sans-serif); } .b { font-family: "Acme Brand Sans", serif; }`,
          ),
          {
            failClosedFontFetch: true,
            allowSystemFontCapture: false,
            fetchImpl: makeHttp503Fetch(),
            fontFetchRetryPolicy: { baseDelayMs: 0 },
          },
        ),
      );
      expect(caught).toBeInstanceOf(FontFetchUnavailableError);
    });
  });

  it.each([
    [
      `.a { font-family: var(--brand, "Acme Brand Sans", sans-serif); } .b { font-family: "Acme Brand Sans", serif; }`,
    ],
    [
      `.b { font-family: "Acme Brand Sans", serif; } .a { font-family: var(--brand, "Acme Brand Sans", sans-serif); }`,
    ],
  ])("keeps a family required when it is also named directly: %s", async (css) => {
    const caught = await rejectedError(
      injectDeterministicFontFaces(styled(css), {
        failClosedFontFetch: true,
        allowSystemFontCapture: false,
        fetchImpl: makeHttp400Fetch(),
      }),
    );
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchError).familyName).toContain("Acme Brand Sans");
  });
});
