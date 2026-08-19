import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FONT_FETCH_FAILED,
  FONT_FETCH_UNAVAILABLE,
  FontFetchError,
  FontFetchUnavailableError,
  injectDeterministicFontFaces,
  type FontFetchRetryPolicy,
} from "./deterministicFonts.js";

let previousCacheDir: string | undefined;
let testCacheDir: string;

beforeAll(() => {
  previousCacheDir = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  testCacheDir = mkdtempSync(join(tmpdir(), "hf-font-retries-"));
  process.env.HYPERFRAMES_FONT_CACHE_DIR = testCacheDir;
});

afterAll(() => {
  if (previousCacheDir === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousCacheDir;
  rmSync(testCacheDir, { recursive: true, force: true });
});

const FAST_RETRY = {
  maxAttempts: 2,
  attemptTimeoutMs: 20,
  maxElapsedMs: 100,
  baseDelayMs: 0,
} as const;

let familySequence = 0;

function unresolvedHtml(): { family: string; html: string } {
  familySequence += 1;
  const family = `RetryTestFont${process.pid}${familySequence}`;
  return {
    family,
    html: `<!doctype html><html><head><style>
      body { font-family: "${family}", sans-serif; }
    </style></head><body>retry</body></html>`,
  };
}

function googleCss(woff2Url: string): Response {
  return new Response(
    `@font-face {
      font-style: normal;
      font-weight: 400;
      src: url(${woff2Url}) format('woff2');
    }`,
    { status: 200 },
  );
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input);
}

function injectWithRetries(
  html: string,
  fetchImpl: typeof fetch,
  fontFetchRetryPolicy: Partial<FontFetchRetryPolicy> = FAST_RETRY,
): Promise<string> {
  return injectDeterministicFontFaces(html, {
    failClosedFontFetch: true,
    allowSystemFontCapture: false,
    fetchImpl,
    fontFetchRetryPolicy,
  });
}

describe("deterministic Google Fonts retries", () => {
  for (const status of [408, 425, 429, 500, 502, 503]) {
    it(`retries HTTP ${status} exactly once, then reports temporary unavailability`, async () => {
      const { html } = unresolvedHtml();
      let calls = 0;
      const fetchImpl = (async () => {
        calls += 1;
        return new Response("", {
          status,
          headers: status === 429 ? { "Retry-After": "0" } : undefined,
        });
      }) as typeof fetch;

      const result = injectWithRetries(html, fetchImpl);

      await expect(result).rejects.toMatchObject({
        code: FONT_FETCH_UNAVAILABLE,
        name: "FontFetchUnavailableError",
      });
      expect(calls).toBe(2);
    });
  }

  it("recovers when the Google Fonts CSS retry succeeds", async () => {
    const { html } = unresolvedHtml();
    const woff2Url = `https://fonts.gstatic.com/s/retry/${process.pid}-css.woff2`;
    let cssCalls = 0;
    let woff2Calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (requestUrl(input).startsWith("https://fonts.googleapis.com/")) {
        cssCalls += 1;
        return cssCalls === 1 ? new Response("", { status: 502 }) : googleCss(woff2Url);
      }
      woff2Calls += 1;
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;

    const result = await injectWithRetries(html, fetchImpl);

    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(cssCalls).toBe(2);
    expect(woff2Calls).toBe(1);
  });

  it("does not wait for a stalled retryable response-body cancellation", async () => {
    const { html } = unresolvedHtml();
    const woff2Url = `https://fonts.gstatic.com/s/retry/${process.pid}-cancel.woff2`;
    let cssCalls = 0;
    let cancelledBodies = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (!requestUrl(input).startsWith("https://fonts.googleapis.com/")) {
        return new Response(new Uint8Array([10, 11, 12]), { status: 200 });
      }
      cssCalls += 1;
      if (cssCalls === 1) {
        return new Response(
          new ReadableStream({
            cancel() {
              cancelledBodies += 1;
              return new Promise<void>(() => {});
            },
          }),
          { status: 502 },
        );
      }
      return googleCss(woff2Url);
    }) as typeof fetch;

    const result = await injectWithRetries(html, fetchImpl);

    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(cssCalls).toBe(2);
    expect(cancelledBodies).toBe(1);
  });

  it("recovers when a woff2 retry succeeds", async () => {
    const { html } = unresolvedHtml();
    const woff2Url = `https://fonts.gstatic.com/s/retry/${process.pid}-woff2.woff2`;
    let cssCalls = 0;
    let woff2Calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (requestUrl(input).startsWith("https://fonts.googleapis.com/")) {
        cssCalls += 1;
        return googleCss(woff2Url);
      }
      woff2Calls += 1;
      return woff2Calls === 1
        ? new Response("", { status: 503 })
        : new Response(new Uint8Array([4, 5, 6]), { status: 200 });
    }) as typeof fetch;

    const result = await injectWithRetries(html, fetchImpl);

    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(cssCalls).toBe(1);
    expect(woff2Calls).toBe(2);
  });

  it("reports temporary unavailability when woff2 retries are exhausted", async () => {
    const { html } = unresolvedHtml();
    const woff2Url = `https://fonts.gstatic.com/s/retry/${process.pid}-woff2-exhausted.woff2`;
    let cssCalls = 0;
    let woff2Calls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (requestUrl(input).startsWith("https://fonts.googleapis.com/")) {
        cssCalls += 1;
        return googleCss(woff2Url);
      }
      woff2Calls += 1;
      return new Response("", { status: 502 });
    }) as typeof fetch;

    const result = injectWithRetries(html, fetchImpl);

    await expect(result).rejects.toMatchObject({
      code: FONT_FETCH_UNAVAILABLE,
      url: woff2Url,
    });
    expect(cssCalls).toBe(1);
    expect(woff2Calls).toBe(2);
  });

  it("retries transport exceptions and preserves the final cause", async () => {
    const { html } = unresolvedHtml();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new TypeError(`network failure ${calls}`);
    }) as typeof fetch;

    let caught: unknown;
    try {
      await injectWithRetries(html, fetchImpl);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FontFetchUnavailableError);
    expect(caught).toBeInstanceOf(FontFetchError);
    expect((caught as FontFetchUnavailableError).code).toBe(FONT_FETCH_UNAVAILABLE);
    expect((caught as Error).message).toContain("network failure 2");
    expect(calls).toBe(2);
  });

  it("retries a response-body transport failure", async () => {
    const { html } = unresolvedHtml();
    const woff2Url = `https://fonts.gstatic.com/s/retry/${process.pid}-body.woff2`;
    let cssCalls = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (!requestUrl(input).startsWith("https://fonts.googleapis.com/")) {
        return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
      }
      cssCalls += 1;
      if (cssCalls === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("CSS body connection reset"));
            },
          }),
          { status: 200 },
        );
      }
      return googleCss(woff2Url);
    }) as typeof fetch;

    const result = await injectWithRetries(html, fetchImpl);

    expect(result).toContain("data-hyperframes-deterministic-fonts");
    expect(cssCalls).toBe(2);
  });

  it("times out each hung attempt and reports temporary unavailability", async () => {
    const { html } = unresolvedHtml();
    let calls = 0;
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing timeout signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }) as typeof fetch;

    const result = injectWithRetries(html, fetchImpl, {
      ...FAST_RETRY,
      attemptTimeoutMs: 5,
      maxElapsedMs: 50,
    });

    await expect(result).rejects.toMatchObject({ code: FONT_FETCH_UNAVAILABLE });
    expect(calls).toBe(2);
  });

  it("does not exceed the shared budget to honor a long Retry-After", async () => {
    const { html } = unresolvedHtml();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    }) as typeof fetch;

    const result = injectWithRetries(html, fetchImpl, {
      ...FAST_RETRY,
      maxElapsedMs: 100,
    });

    await expect(result).rejects.toMatchObject({ code: FONT_FETCH_UNAVAILABLE });
    expect(calls).toBe(1);
  });

  it("shares one elapsed-time budget across multiple font resources", async () => {
    const { html } = unresolvedHtml();
    const firstUrl = `https://fonts.gstatic.com/s/retry/${process.pid}-budget-first.woff2`;
    const secondUrl = `https://fonts.gstatic.com/s/retry/${process.pid}-budget-second.woff2`;
    let firstCalls = 0;
    let secondCalls = 0;
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (url.startsWith("https://fonts.googleapis.com/")) {
        return Promise.resolve(
          new Response(
            `@font-face {
              font-style: normal;
              font-weight: 400;
              src: url(${firstUrl}) format('woff2');
            }
            @font-face {
              font-style: normal;
              font-weight: 700;
              src: url(${secondUrl}) format('woff2');
            }`,
            { status: 200 },
          ),
        );
      }
      if (url === firstUrl) {
        firstCalls += 1;
        return new Promise<Response>((resolve, reject) => {
          const timeout = setTimeout(
            () => resolve(new Response(new Uint8Array([13, 14, 15]), { status: 200 })),
            30,
          );
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(init.signal?.reason);
            },
            { once: true },
          );
        });
      }
      secondCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
    }) as typeof fetch;

    const result = injectWithRetries(html, fetchImpl, {
      maxAttempts: 2,
      attemptTimeoutMs: 70,
      maxElapsedMs: 100,
      baseDelayMs: 0,
    });

    await expect(result).rejects.toMatchObject({ code: FONT_FETCH_UNAVAILABLE });
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
  });

  it("does not retry an ordinary 4xx and retains deterministic failure classification", async () => {
    const { html } = unresolvedHtml();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 400 });
    }) as typeof fetch;

    const result = injectWithRetries(html, fetchImpl);

    await expect(result).rejects.toMatchObject({
      code: FONT_FETCH_FAILED,
      name: "FontFetchError",
    });
    expect(calls).toBe(1);
  });

  it("propagates caller cancellation without wrapping or retrying it", async () => {
    const { html } = unresolvedHtml();
    const controller = new AbortController();
    const cancellation = new Error("render cancelled by caller");
    let calls = 0;
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }) as typeof fetch;

    const result = injectDeterministicFontFaces(html, {
      failClosedFontFetch: true,
      allowSystemFontCapture: false,
      fetchImpl,
      abortSignal: controller.signal,
      fontFetchRetryPolicy: FAST_RETRY,
    });
    controller.abort(cancellation);

    await expect(result).rejects.toBe(cancellation);
    expect(calls).toBe(1);
  });

  it("keeps fail-open mode at one attempt with no typed failure", async () => {
    const { html } = unresolvedHtml();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("", { status: 503 });
    }) as typeof fetch;

    const result = await injectDeterministicFontFaces(html, {
      failClosedFontFetch: false,
      allowSystemFontCapture: false,
      fetchImpl,
      fontFetchRetryPolicy: FAST_RETRY,
    });

    expect(result).not.toContain("data-hyperframes-deterministic-fonts");
    expect(calls).toBe(1);
  });
});
