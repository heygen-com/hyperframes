// @vitest-environment node

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _clearGoogleFontCssCacheForTests,
  FONT_FETCH_FAILED,
  FONT_FETCH_UNAVAILABLE,
  FontFetchError,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";
import type { FontAttemptDiag, FontDiagnostics } from "./fontDiagnostics.js";

const FAMILY = "Bricolage Grotesque";
const PAGE_TEXT = "quick brown fox";
const PRIVATE_FAMILY = "PRIVATE_FONT_SENTINEL_7f3a";
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);

const block = (family = FAMILY, fmt = "woff2", n = 0): string =>
  `/* latin */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 200 800;\n  src: url(https://fonts.gstatic.com/s/b/v9/f${n}.woff2) format('${fmt}');\n  unicode-range: U+0000-00FF;\n}\n`;
const blocks = (count: number, family = FAMILY, fmt = "woff2"): string =>
  Array.from({ length: count }, (_, n) => block(family, fmt, n)).join("\n");
const urlLessBlocks = `/* latin */\n@font-face {\n  font-family: '${FAMILY}';\n  font-style: normal;\n  font-weight: 200 800;\n  unicode-range: U+0000-00FF;\n}\n/* latin-ext */\n@font-face {\n  font-family: '${FAMILY}';\n  font-style: normal;\n  font-weight: 200 800;\n}\n`;

type Rule = (url: string) => Response | Promise<Response>;
interface Stub {
  css: string[];
  woff2: string[];
  fetchImpl: typeof fetch;
}
const status = (code: number): Response => new Response("x", { status: code });
const ok = (body: string): Response => new Response(body, { status: 200 });
function stub(css: Rule, woff: Rule = () => new Response(WOFF2, { status: 200 })): Stub {
  const cssUrls: string[] = [];
  const woff2Urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://fonts.gstatic.com/")) {
      woff2Urls.push(url);
      return woff(url);
    }
    cssUrls.push(url);
    return css(url);
  };
  return { css: cssUrls, woff2: woff2Urls, fetchImpl };
}

const POLICY = { maxAttempts: 2, baseDelayMs: 0, attemptTimeoutMs: 2000, maxElapsedMs: 8000 };
const page = (extraCss = ""): string =>
  `<!doctype html><html><head><style>.a{font-family:'${FAMILY}',sans-serif;font-weight:700}${extraCss}</style></head><body><p class="a">The ${PAGE_TEXT} jumps.</p></body></html>`;

async function fail(html: string, s: Stub, abortSignal?: AbortSignal): Promise<FontFetchError> {
  try {
    await injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl: s.fetchImpl,
      abortSignal,
      fontFetchRetryPolicy: POLICY,
      logger: { info: () => undefined, warn: () => undefined },
    });
  } catch (err) {
    if (err instanceof FontFetchError) return err;
    throw err;
  }
  throw new Error("expected FontFetchError");
}

function diagnosticsOf(e: FontFetchError): FontDiagnostics {
  if (!e.diagnostics) throw new Error("expected diagnostics");
  return e.diagnostics;
}

const attempt = (o: Partial<FontAttemptDiag> = {}): FontAttemptDiag => ({
  path: "direct_google",
  urlSource: "default",
  textParam: "present",
  cssCache: "fresh",
  cssStatus: 200,
  blocksTotal: 0,
  regexMatches: 0,
  assets: { total: 0, diskCacheHit: 0, fetchedOk: 0, nonOk: {} },
  ...o,
});
const diagOf = (attempts: FontAttemptDiag[]): FontDiagnostics => ({
  families: [{ required: true, resolved: false, attempts }],
});

beforeEach(() => {
  process.env.HYPERFRAMES_FONT_CACHE_DIR = mkdtempSync(join(tmpdir(), "hf-dp-cache-"));
  _clearGoogleFontCssCacheForTests();
});

const ROWS: Array<{ name: string; css: Rule; woff?: Rule; expected: FontAttemptDiag }> = [
  { name: "CSS 400", css: () => status(400), expected: attempt({ cssStatus: 400 }) },
  {
    name: "CSS 204 empty body keeps the real status",
    css: () => new Response(null, { status: 204 }),
    expected: attempt({ cssStatus: 204 }),
  },
  {
    name: "CSS 206 empty body keeps the real status",
    css: () => new Response("", { status: 206 }),
    expected: attempt({ cssStatus: 206 }),
  },
  {
    name: "CSS 304 keeps the real status",
    css: () => new Response(null, { status: 304 }),
    expected: attempt({ cssStatus: 304 }),
  },
  {
    name: "CSS 200 zero regex matches (woff2-variations label)",
    css: () => ok(blocks(2, FAMILY, "woff2-variations")),
    expected: attempt({ blocksTotal: 2 }),
  },
  {
    name: "CSS 200 blocks without a url",
    css: () => ok(urlLessBlocks),
    expected: attempt({ blocksTotal: 2 }),
  },
  {
    name: "CSS 200 all faces dropped by the family filter",
    css: () => ok(blocks(2, "DM Sans")),
    expected: attempt({ blocksTotal: 2, regexMatches: 2 }),
  },
  {
    name: "CSS ok, all woff2 404",
    css: () => ok(blocks(3)),
    woff: () => status(404),
    expected: attempt({
      blocksTotal: 3,
      regexMatches: 3,
      assets: { total: 3, diskCacheHit: 0, fetchedOk: 0, nonOk: { "404": 3 } },
    }),
  },
];

describe("exact attempt record on the Unresolved error", () => {
  for (const { name, css, woff, expected } of ROWS) {
    it(name, async () => {
      const e = await fail(page(), stub(css, woff));
      expect(e.diagnostics).toEqual(diagOf([expected]));
    });
  }

  it("leaves the pre-existing error contract unchanged", async () => {
    const e = await fail(
      page(),
      stub(() => status(400)),
    );
    expect(e.message).toBe(
      `[Compiler] Unresolved fonts in fail-closed mode: ${FAMILY}. Distributed renders require all fonts to be resolvable.`,
    );
    expect(e.code).toBe(FONT_FETCH_FAILED);
    expect(e.name).toBe("FontFetchError");
    expect(e.familyName).toBe(FAMILY);
    expect(e.unresolvedFamilies).toEqual([FAMILY]);
  });

  it("a cached second failure records a cache hit with the retained status and no new request", async () => {
    const s = stub(() => status(400));
    const e1 = await fail(page(), s);
    const e2 = await fail(page(), s);
    expect(s.css.length).toBe(1);
    expect(e1.diagnostics).toEqual(diagOf([attempt({ cssStatus: 400, cssCache: "fresh" })]));
    expect(e2.diagnostics).toEqual(diagOf([attempt({ cssStatus: 400, cssCache: "hit" })]));
  });
});

describe("shared CSS lookups", () => {
  it("concurrent compiles each record their own attempt: one fresh, one hit, one upstream request", async () => {
    const s = stub(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return status(400);
    });
    const [e1, e2] = await Promise.all([fail(page(), s), fail(page(), s)]);
    expect(s.css.length).toBe(1);
    const caches = [e1, e2].map((e) => diagnosticsOf(e).families[0]?.attempts[0]?.cssCache);
    expect(caches.sort()).toEqual(["fresh", "hit"]);
    for (const e of [e1, e2]) {
      expect(diagnosticsOf(e).families[0]?.attempts[0]?.cssStatus).toBe(400);
    }
  });

  it("a retryable 503 keeps its UNAVAILABLE error and carries no diagnostics", async () => {
    const s = stub(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return status(503);
    });
    const errors = await Promise.all([fail(page(), s), fail(page(), s)]);
    for (const e of errors) {
      expect(e.code).toBe(FONT_FETCH_UNAVAILABLE);
      expect(e.name).toBe("FontFetchUnavailableError");
      expect(e.diagnostics).toBeUndefined();
    }
  });
});

describe("families", () => {
  it("lists every family in resolver order with its required and resolved flags", async () => {
    const html = page(
      ".b{font-family:var(--none, 'Zzz Example')}.i{font-family:'Inter',sans-serif}",
    );
    const e = await fail(
      html,
      stub(() => status(400)),
    );
    const families = diagnosticsOf(e).families;
    expect(families.map((f) => [f.required, f.resolved])).toEqual([
      [true, false],
      [true, true],
      [false, false],
    ]);
    expect(families[0]?.attempts[0]?.path).toBe("direct_google");
    expect(families[1]?.attempts[0]?.path).toBe("bundled_supplement");
  });

  it("carries flags in resolver order while unresolvedFamilies stays sorted by name", async () => {
    const html = `<!doctype html><html><head><style>.z{font-family:'Zzz Required Font',sans-serif}.i{font-family:'Inter',sans-serif}.o{font-family:var(--none, 'Aaa Optional Font')}</style></head><body><p class="z i o">${PAGE_TEXT}</p></body></html>`;
    const e = await fail(
      html,
      stub(() => status(400)),
    );
    expect(diagnosticsOf(e).families.map((f) => [f.required, f.resolved])).toEqual([
      [true, false],
      [true, true],
      [false, false],
    ]);
    expect(e.message).toBe(
      "[Compiler] Unresolved fonts in fail-closed mode: Zzz Required Font. Distributed renders require all fonts to be resolvable.",
    );
    expect(e.code).toBe(FONT_FETCH_FAILED);
    expect(e.familyName).toBe("Zzz Required Font");
    expect(e.unresolvedFamilies).toEqual(["Aaa Optional Font", "Zzz Required Font"]);
    expect(JSON.stringify(e.diagnostics)).not.toMatch(/Aaa|Zzz/);
  });

  it("two required families failing at different stages stay indistinguishable by name", async () => {
    const html = `<!doctype html><html><head><style>.z{font-family:'Zzz Required Font',sans-serif}.a{font-family:'Aaa Required Font',sans-serif}</style></head><body><p class="z a">${PAGE_TEXT}</p></body></html>`;
    const e = await fail(
      html,
      stub((url) =>
        url.includes("Aaa") ? status(400) : ok(blocks(2, FAMILY, "woff2-variations")),
      ),
    );
    const families = diagnosticsOf(e).families;
    expect(families.map((f) => [f.required, f.resolved])).toEqual([
      [true, false],
      [true, false],
    ]);
    const [first, second] = families.map((f) => f.attempts[0]);
    expect(first).toEqual(attempt({ blocksTotal: 2 }));
    expect(second).toEqual(attempt({ cssStatus: 400 }));
    expect({ ...first, blocksTotal: 0, cssStatus: 400 }).toEqual(second);
    // The payload cannot say which family produced which attempt.
    expect(e.message).toBe(
      "[Compiler] Unresolved fonts in fail-closed mode: Aaa Required Font, Zzz Required Font. Distributed renders require all fonts to be resolvable.",
    );
    expect(e.unresolvedFamilies).toEqual(["Aaa Required Font", "Zzz Required Font"]);
    expect(JSON.stringify(e.diagnostics)).not.toMatch(/Aaa|Zzz/);
  });
});

describe("authored stylesheet falling back to the default request", () => {
  const AUTHORED = "Zorblax Display";
  const OTHER = "Quillmark Serif";
  const LINK = `https://fonts.googleapis.com/css2?family=${AUTHORED.replace(" ", "+")}:wght@400;700&display=swap`;
  const authoredPage = (extraFamily = ""): string =>
    `<!doctype html><html><head><link rel="stylesheet" href="${LINK}"><style>.a{font-family:'${AUTHORED}',sans-serif}${extraFamily}</style></head><body><p class="a o">The ${PAGE_TEXT} jumps.</p></body></html>`;
  const isDefault = (url: string): boolean => url.includes("ital,wght@");
  const authoredAttempt = (o: Partial<FontAttemptDiag> = {}): FontAttemptDiag =>
    attempt({ urlSource: "authored", ...o });

  it("records the rejected authored stylesheet and then the default attempt that found no usable file", async () => {
    const e = await fail(
      authoredPage(),
      stub(
        (url) => (isDefault(url) ? ok(blocks(1, AUTHORED)) : status(400)),
        () => status(404),
      ),
    );
    expect(diagnosticsOf(e).families).toEqual([
      {
        required: true,
        resolved: false,
        attempts: [
          authoredAttempt({ cssStatus: 400 }),
          attempt({
            blocksTotal: 1,
            regexMatches: 1,
            assets: { total: 1, diskCacheHit: 0, fetchedOk: 0, nonOk: { "404": 1 } },
          }),
        ],
      },
    ]);
  });

  it("records an authored 200 with zero faces and then the default attempt", async () => {
    const e = await fail(
      authoredPage(),
      stub((url) => (isDefault(url) ? status(400) : ok(blocks(2, AUTHORED, "woff2-variations")))),
    );
    expect(diagnosticsOf(e).families[0]?.attempts).toEqual([
      authoredAttempt({ blocksTotal: 2 }),
      attempt({ cssStatus: 400 }),
    ]);
  });

  it("records no default attempt for a family whose authored stylesheet worked", async () => {
    const s = stub((url) => {
      if (url.includes("Quillmark")) return status(400);
      return ok(blocks(1, AUTHORED));
    });
    const e = await fail(authoredPage(`.o{font-family:'${OTHER}',serif}`), s);
    expect(diagnosticsOf(e).families).toEqual([
      {
        required: true,
        resolved: true,
        attempts: [
          authoredAttempt({
            blocksTotal: 1,
            regexMatches: 1,
            assets: { total: 1, diskCacheHit: 0, fetchedOk: 1, nonOk: {} },
          }),
        ],
      },
      { required: true, resolved: false, attempts: [attempt({ cssStatus: 400 })] },
    ]);
    expect(s.css.filter((url) => isDefault(url) && url.includes("Zorblax"))).toEqual([]);
  });

  it("keeps a transient UNAVAILABLE exactly as before: no default request, no diagnostics", async () => {
    const s = stub(() => status(503));
    const e = await fail(authoredPage(), s);
    expect(e.code).toBe(FONT_FETCH_UNAVAILABLE);
    expect(e.name).toBe("FontFetchUnavailableError");
    expect(e.diagnostics).toBeUndefined();
    expect(s.css.some(isDefault)).toBe(false);
  });

  it("records both attempts when the authored and default requests both fail, with the error contract unchanged", async () => {
    const e = await fail(
      authoredPage(),
      stub(() => status(400)),
    );
    expect(diagnosticsOf(e).families[0]?.attempts).toEqual([
      authoredAttempt({ cssStatus: 400 }),
      attempt({ cssStatus: 400 }),
    ]);
    expect(e.message).toBe(
      `[Compiler] Unresolved fonts in fail-closed mode: ${AUTHORED}. Distributed renders require all fonts to be resolvable.`,
    );
    expect(e.code).toBe(FONT_FETCH_FAILED);
    expect(e.name).toBe("FontFetchError");
    expect(e.familyName).toBe(AUTHORED);
    expect(e.unresolvedFamilies).toEqual([AUTHORED]);
    expect(e.url).toBe("");
    expect(e.cause).toBeUndefined();
  });

  it("labels both attempts of a repeated compile as cache hits while the first compile's are fresh", async () => {
    const s = stub(() => status(400));
    const first = await fail(authoredPage(), s);
    const second = await fail(authoredPage(), s);
    expect(s.css.length).toBe(2);
    expect(diagnosticsOf(first).families[0]?.attempts).toEqual([
      authoredAttempt({ cssStatus: 400, cssCache: "fresh" }),
      attempt({ cssStatus: 400, cssCache: "fresh" }),
    ]);
    expect(diagnosticsOf(second).families[0]?.attempts).toEqual([
      authoredAttempt({ cssStatus: 400, cssCache: "hit" }),
      attempt({ cssStatus: 400, cssCache: "hit" }),
    ]);
  });
});

describe("a lookup joined while another compile's request is in flight", () => {
  const REQUIRED = "Quillmark Serif";
  const OPTIONAL = "Zorblax Display";
  const html = `<!doctype html><html><head><style>.r{font-family:'${REQUIRED}',serif}.o{font-family:var(--none, '${OPTIONAL}')}</style></head><body><p class="r o">The ${PAGE_TEXT} jumps.</p></body></html>`;
  const drain = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const until = async (done: () => boolean, what: string): Promise<void> => {
    for (let turn = 0; turn < 200 && !done(); turn += 1) await drain();
    if (!done()) throw new Error(`timed out waiting for ${what}`);
  };

  it("labels the joiner's swallowed optional lookup as a hit with no status", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let optionalRequests = 0;
    const s = stub(async (url) => {
      if (!url.includes("Zorblax")) return status(400);
      optionalRequests += 1;
      if (optionalRequests === 1) await gate;
      return status(503);
    });
    // A lookup that awaits a shared promise registers an abort listener on its caller's signal, so
    // the second compile's listener count shows when it has reached the optional family's lookup.
    const joiner = new AbortController();
    const joinerListeners = vi.spyOn(joiner.signal, "addEventListener");
    try {
      const first = fail(html, s);
      await until(() => optionalRequests === 1, "the first compile's optional request");
      const second = fail(html, s, joiner.signal);
      await until(
        () => joinerListeners.mock.calls.length >= 2,
        "the second compile to await the optional lookup",
      );
      expect(optionalRequests).toBe(1);
      release();
      const errors = await Promise.all([first, second]);

      expect(optionalRequests).toBe(POLICY.maxAttempts);
      const optional = errors.map((e) => diagnosticsOf(e).families[1]);
      expect(optional.map((f) => [f?.required, f?.resolved, f?.attempts.length])).toEqual([
        [false, false, 1],
        [false, false, 1],
      ]);
      expect(optional.map((f) => f?.attempts[0]?.cssCache)).toEqual(["fresh", "hit"]);
      expect(optional.map((f) => f?.attempts[0]?.cssStatus)).toEqual([null, null]);
      for (const e of errors) {
        expect(e.code).toBe(FONT_FETCH_FAILED);
        expect(e.message).toBe(
          `[Compiler] Unresolved fonts in fail-closed mode: ${REQUIRED}. Distributed renders require all fonts to be resolvable.`,
        );
        expect(e.url).toBe("");
        expect(e.cause).toBeUndefined();
      }
    } finally {
      release();
    }
  });
});

describe("leak check", () => {
  for (const { name, css, woff } of ROWS) {
    it(`${name}: no family name, URL, CSS, page text or hash in the serialized diagnostics`, async () => {
      const e = await fail(
        page(`.b{font-family:var(--n, '${PRIVATE_FAMILY}')}.d{font-family:'${PAGE_TEXT} jumps'}`),
        stub(css, woff),
      );
      const json = JSON.stringify(e.diagnostics);
      expect(json).not.toMatch(
        /https?:|gstatic|googleapis|font-face|\.woff2|text=|src:|%[0-9A-Fa-f]{2}|unicode-range|base64|"family"/i,
      );
      for (const secret of [FAMILY, PRIVATE_FAMILY, PAGE_TEXT]) {
        expect(json).not.toContain(secret);
      }
    });
  }
});
