import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captionImagesWithGemini,
  resolveVisionPhaseCompletion,
  type VisionCaptionOutcome,
} from "./contentExtractor.js";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

// These tests exercise the OpenRouter provider path only — it makes a plain
// `fetch` call we can stub, with no native (`sharp`) or `@google/genai`
// dependency. OpenRouter wins over Gemini when OPENROUTER_API_KEY is set, so we
// don't need to clear the Gemini keys for the OpenRouter cases.

function makeProjectWithImages(files = ["hero.png"]): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-caption-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  // Contents are irrelevant to the OpenRouter path (it just base64-encodes the
  // bytes); only the .png extension matters for the image filter.
  for (const file of files) {
    writeFileSync(join(dir, "assets", file), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  return dir;
}

describe("captionImagesWithGemini — OpenRouter provider", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("captions via OpenRouter when OPENROUTER_API_KEY is set", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-test-key");
    vi.stubEnv("HYPERFRAMES_OPENROUTER_MODEL", "google/gemini-3.1-flash-lite");

    // Capture the request inside the mock, where the args are well-typed —
    // avoids casting `mock.calls` (and the repo's ban on `as` assertions).
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "A dark hero with blue accents." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const warnings: string[] = [];
    const captions = await captionImagesWithGemini(dir, () => {}, warnings);

    expect(captions).toEqual({ "hero.png": "A dark hero with blue accents." });
    expect(warnings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(capturedUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(capturedInit?.headers).get("authorization")).toBe("Bearer or-test-key");
    const body = JSON.parse(typeof capturedInit?.body === "string" ? capturedInit.body : "{}");
    expect(body.model).toBe("google/gemini-3.1-flash-lite");
    const image = body.messages[0].content.find((p: { type: string }) => p.type === "image_url");
    expect(image?.image_url?.url).toMatch(/^data:image\/png;base64,/);
  });

  it("degrades gracefully (no throw, no captions) when OpenRouter returns a non-OK status", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-bad-key");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("provider detail containing or-bad-key", {
            status: 401,
            statusText: "Unauthorized",
          }),
      ),
    );

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({});
    expect(warnings).toEqual(["OpenRouter vision failed for 1 asset(s); captions omitted."]);
    expect(warnings.join(" ")).not.toContain("or-bad-key");
    expect(outcome).toEqual({
      timedOutRequests: 0,
      failedRequests: 1,
      budgetExhausted: false,
    });
    if (!outcome) throw new Error("Expected vision caption outcome");
    expect(resolveVisionPhaseCompletion(outcome, 10_000)).toEqual({
      status: "degraded",
      reason: "provider-error",
    });
  });

  it("terminates captioning when the vision provider never responds", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-hanging-key");
    vi.stubEnv("HYPERFRAMES_VISION_TIMEOUT_MS", "20");

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );

    const warnings: string[] = [];
    const result = await Promise.race([
      captionImagesWithGemini(dir, () => {}, warnings),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
    ]);

    expect(result).toEqual({});
  });

  it.each([
    { label: "success JSON", status: 200, partialBody: '{"choices":[' },
    { label: "failure text", status: 500, partialBody: "upstream failed: " },
  ])(
    "terminates captioning when OpenRouter $label body never ends",
    async ({ status, partialBody }) => {
      const dir = makeProjectWithImages();
      dirs.push(dir);
      vi.stubEnv("OPENROUTER_API_KEY", "or-stalled-body-key");
      vi.stubEnv("HYPERFRAMES_VISION_TIMEOUT_MS", "20");

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(partialBody));
            },
          });
          return new Response(body, {
            status,
            headers: { "content-type": "application/json" },
          });
        }),
      );

      const warnings: string[] = [];
      let outcome: VisionCaptionOutcome | undefined;
      const result = await Promise.race([
        captionImagesWithGemini(dir, () => {}, warnings, {
          onOutcome: (value) => {
            outcome = value;
          },
        }),
        new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
      ]);

      expect(result).toEqual({});
      expect(warnings).toEqual(["OpenRouter vision timed out for 1 asset(s); captions omitted."]);
      expect(outcome).toEqual({
        timedOutRequests: 1,
        failedRequests: 0,
        budgetExhausted: false,
      });
    },
  );

  it("keeps successful captions while reporting a failed sibling request", async () => {
    const dir = makeProjectWithImages(["failed.png", "success.png"]);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-mixed-failure-key");

    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount++;
        if (requestCount === 1) {
          return new Response("upstream exploded with or-mixed-failure-key", {
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Successful image." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({ "success.png": "Successful image." });
    expect(warnings).toEqual(["OpenRouter vision failed for 1 asset(s); captions omitted."]);
    expect(warnings.join(" ")).not.toContain("or-mixed-failure-key");
    expect(outcome).toEqual({
      timedOutRequests: 0,
      failedRequests: 1,
      budgetExhausted: false,
    });
  });

  it("keeps a successful sibling caption when another request times out", async () => {
    const dir = makeProjectWithImages(["hang.png", "success.png"]);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-mixed-key");
    vi.stubEnv("HYPERFRAMES_VISION_TIMEOUT_MS", "20");

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const imageUrl = body.messages?.[0]?.content?.[1]?.image_url?.url;
        if (typeof imageUrl === "string" && imageUrl.includes("iVBORw==")) {
          // Both fixtures contain the same bytes, so use call order: the first
          // request hangs while the second succeeds independently.
          const fetchMock = vi.mocked(fetch);
          if (fetchMock.mock.calls.length === 1) return new Promise<Response>(() => {});
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "Successful image." } }] }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }),
    );

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({ "success.png": "Successful image." });
    expect(outcome).toEqual({
      timedOutRequests: 1,
      failedRequests: 0,
      budgetExhausted: false,
    });
    if (!outcome) throw new Error("Expected vision caption outcome");
    expect(resolveVisionPhaseCompletion(outcome, 10_000)).toEqual({
      status: "degraded",
      reason: "request-timeout",
    });
  });

  it("does not call a configured provider when vision is skipped", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-unused-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const captions = await captionImagesWithGemini(dir, () => {}, [], { skipVision: true });

    expect(captions).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start a vision batch after the capture budget is exhausted", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-budget-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const captions = await captionImagesWithGemini(dir, () => {}, [], {
      remainingMs: () => 0,
    });

    expect(captions).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies non-provider pipeline failures without leaking the local path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-caption-no-assets-"));
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-unused-key");

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({});
    expect(warnings).toEqual(["OpenRouter captioning failed internally; captions omitted."]);
    expect(warnings.join(" ")).not.toContain(dir);
    expect(outcome).toEqual({
      timedOutRequests: 0,
      failedRequests: 0,
      budgetExhausted: false,
      internalError: true,
    });
    if (!outcome) throw new Error("Expected vision caption outcome");
    expect(resolveVisionPhaseCompletion(outcome, 10_000)).toEqual({
      status: "degraded",
      reason: "internal-error",
    });
  });

  it("skips captioning entirely when no provider key is present", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const warnings: string[] = [];
    const captions = await captionImagesWithGemini(dir, () => {}, warnings);

    expect(captions).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("captionImagesWithGemini — Gemini provider", () => {
  const dirs: string[] = [];

  afterEach(() => {
    generateContentMock.mockReset();
    vi.unstubAllEnvs();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("terminates captioning when Gemini never settles even if the SDK ignores abort", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-hanging-key");
    vi.stubEnv("HYPERFRAMES_VISION_TIMEOUT_MS", "20");
    generateContentMock.mockImplementation(() => new Promise(() => {}));

    const result = await Promise.race([
      captionImagesWithGemini(dir, () => {}, []),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
    ]);

    expect(result).toEqual({});
  });

  it("reports a rejected Gemini request without leaking its error detail", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "gemini-secret-key");
    generateContentMock.mockRejectedValue(
      new Error("provider echoed gemini-secret-key in its response"),
    );

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({});
    expect(warnings).toEqual(["Gemini vision failed for 1 asset(s); captions omitted."]);
    expect(warnings.join(" ")).not.toContain("gemini-secret-key");
    expect(outcome).toEqual({
      timedOutRequests: 0,
      failedRequests: 1,
      budgetExhausted: false,
    });
    if (!outcome) throw new Error("Expected vision caption outcome");
    expect(resolveVisionPhaseCompletion(outcome, 10_000)).toEqual({
      status: "degraded",
      reason: "provider-error",
    });
  });
});
