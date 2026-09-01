import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captionImagesWithGemini,
  resolveVisionPhaseCompletion,
  type VisionCaptionOutcome,
} from "./contentExtractor.js";

const { generateContentMock, clientOptions, sharpState } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
  // How the SDK client was constructed is the whole difference between the Vertex and API-key
  // paths, so the Vertex cases assert on it rather than on the request.
  clientOptions: [] as Record<string, unknown>[],
  // A native abort inside libvips cannot be caught, so the only defence is never running two
  // renders at once. That is a property of the loop, and this records it.
  sharpState: {
    inFlight: 0,
    maxInFlight: 0,
    concurrencyCalls: [] as number[],
    // Stands in for the host core count sharp reports before anything touches it, so a failure
    // to restore shows up as a wrong value rather than as a coincidental match with 1.
    HOST_CONCURRENCY: 8,
    concurrency: 8,
    renders: [] as string[],
  },
}));

vi.mock("sharp", () => {
  const pipeline = (filePath: string) => {
    const chain = {
      resize: () => chain,
      flatten: () => chain,
      png: () => chain,
      toBuffer: async () => {
        sharpState.inFlight += 1;
        sharpState.maxInFlight = Math.max(sharpState.maxInFlight, sharpState.inFlight);
        sharpState.renders.push(filePath);
        // Yield, so an overlapping caller would be observed rather than serialized by luck.
        await new Promise((resolve) => setTimeout(resolve, 5));
        sharpState.inFlight -= 1;
        return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      },
    };
    return chain;
  };
  const sharp = Object.assign(pipeline, {
    // Real `sharp.concurrency()` is a getter when called with no argument and a process-global
    // setter otherwise. The mock has to be both, or code that saves and restores the host value
    // cannot be tested at all.
    concurrency: (value?: number) => {
      if (typeof value === "number") {
        sharpState.concurrencyCalls.push(value);
        sharpState.concurrency = value;
      }
      return sharpState.concurrency;
    },
  });
  return { default: sharp };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
    constructor(options: Record<string, unknown>) {
      clientOptions.push(options);
    }
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

describe("captionImagesWithGemini — Vertex AI provider", () => {
  const dirs: string[] = [];
  const SERVICE_ACCOUNT = JSON.stringify({
    type: "service_account",
    project_id: "prefab-kit-000000",
    private_key: "-----BEGIN PRIVATE KEY-----super-secret-material-----END PRIVATE KEY-----",
    client_email: "capture@prefab-kit-000000.iam.gserviceaccount.com",
  });

  // Earlier describe blocks construct the SDK client too, so the record is cleared going in
  // rather than only on the way out.
  beforeEach(() => {
    clientOptions.length = 0;
  });

  afterEach(() => {
    generateContentMock.mockReset();
    clientOptions.length = 0;
    vi.unstubAllEnvs();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function vertexEnv(): void {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_VERTEX_PROJECT_ID", "prefab-kit-000000");
    vi.stubEnv("HYPERFRAMES_VERTEX_SERVICE_ACCOUNT", SERVICE_ACCOUNT);
  }

  it("prefers a service account over a bare API key, and authenticates against the project", async () => {
    // A deployment can hold a Gemini key that is present but rejected. Every request then
    // returns empty text, so the capture reports "Captioned N/N" followed by "0 images
    // captioned" and no error — which is exactly what production was doing.
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vertexEnv();
    vi.stubEnv("GEMINI_API_KEY", "a-key-that-the-server-would-be-rejected-for");
    generateContentMock.mockResolvedValue({ text: "A dark blue product screenshot." });

    const stages: string[] = [];
    const captions = await captionImagesWithGemini(
      dir,
      (stage, detail) => {
        stages.push(detail ?? stage);
      },
      [],
    );

    expect(captions).toEqual({ "hero.png": "A dark blue product screenshot." });
    expect(stages.join(" ")).toContain("Vertex AI");
    expect(clientOptions).toHaveLength(1);
    expect(clientOptions[0]).toMatchObject({
      vertexai: true,
      project: "prefab-kit-000000",
      location: "us-central1",
      googleAuthOptions: { credentials: JSON.parse(SERVICE_ACCOUNT) },
    });
    expect(clientOptions[0]).not.toHaveProperty("apiKey");
  });

  it("honours an explicit region", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vertexEnv();
    vi.stubEnv("HYPERFRAMES_VERTEX_LOCATION", "europe-west4");
    generateContentMock.mockResolvedValue({ text: "A caption." });

    await captionImagesWithGemini(dir, () => {}, []);

    expect(clientOptions[0]).toMatchObject({ location: "europe-west4" });
  });

  it("spends no output budget on thinking", async () => {
    // Thinking tokens come out of maxOutputTokens, so a model left free to think can consume
    // the whole budget and return empty text: a successful request that produces no caption.
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vertexEnv();
    // Capture the request inside the mock, where the argument is well-typed — avoids
    // indexing `mock.calls` (and the repo's ban on `as` assertions).
    let model: unknown;
    let thinkingConfig: unknown;
    generateContentMock.mockImplementation(
      async (request: { model: string; config?: { thinkingConfig?: unknown } }) => {
        model = request.model;
        thinkingConfig = request.config?.thinkingConfig;
        return { text: "A caption." };
      },
    );

    await captionImagesWithGemini(dir, () => {}, []);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(thinkingConfig).toEqual({ thinkingBudget: 0 });
    // The API's flash-lite preview id is not resolvable on Vertex, so the default differs.
    expect(model).toBe("gemini-2.5-flash");
  });

  it("skips captioning when the service account is unparseable, without echoing it", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_VERTEX_PROJECT_ID", "prefab-kit-000000");
    vi.stubEnv("HYPERFRAMES_VERTEX_SERVICE_ACCOUNT", "{not-json super-secret-material");

    const warnings: string[] = [];
    let outcome: VisionCaptionOutcome | undefined;
    const captions = await captionImagesWithGemini(dir, () => {}, warnings, {
      onOutcome: (value) => {
        outcome = value;
      },
    });

    expect(captions).toEqual({});
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(warnings.join(" ")).toContain("not valid JSON");
    expect(warnings.join(" ")).not.toContain("super-secret-material");
    if (!outcome) throw new Error("Expected vision caption outcome");
    expect(outcome.internalError).toBe(true);
    expect(resolveVisionPhaseCompletion(outcome, 10_000)).toEqual({
      status: "degraded",
      reason: "internal-error",
    });
  });

  it("stays on OpenRouter when the user has opted into it explicitly", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vertexEnv();
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "A caption." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await captionImagesWithGemini(dir, () => {}, []);

    expect(fetchMock).toHaveBeenCalled();
    expect(clientOptions).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("needs both halves of the credential before it will use Vertex", async () => {
    const dir = makeProjectWithImages();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HYPERFRAMES_VERTEX_PROJECT_ID", "prefab-kit-000000");
    vi.stubEnv("HYPERFRAMES_VERTEX_SERVICE_ACCOUNT", "");

    const captions = await captionImagesWithGemini(dir, () => {}, []);

    expect(captions).toEqual({});
    expect(clientOptions).toHaveLength(0);
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe("captionImagesWithGemini — SVG rasterization", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    sharpState.inFlight = 0;
    sharpState.maxInFlight = 0;
    sharpState.concurrencyCalls.length = 0;
    sharpState.concurrency = sharpState.HOST_CONCURRENCY;
    sharpState.renders.length = 0;
    clientOptions.length = 0;
  });

  afterEach(() => {
    generateContentMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function makeProjectWithSvgs(count: number): string {
    const dir = mkdtempSync(join(tmpdir(), "hf-svg-"));
    mkdirSync(join(dir, "assets", "svgs"), { recursive: true });
    for (let i = 0; i < count; i++) {
      writeFileSync(
        join(dir, "assets", "svgs", `logo-${i}.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h8v8H0z"/></svg>',
      );
    }
    return dir;
  }

  it("never runs two libvips renders at once", async () => {
    // Production aborted here with `free(): unaligned chunk detected in tcache 2` (SIGABRT),
    // twice in fourteen days, losing the whole capture. A native abort cannot be caught by the
    // surrounding try/catch, so the concurrency has to be absent rather than handled — which
    // makes "one at a time" the assertion, not "errors are reported".
    const dir = makeProjectWithSvgs(6);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Slower than a render, so overlapping renders would be the easy way to go faster —
        // the point is that the loop does not take it.
        await new Promise((resolve) => setTimeout(resolve, 15));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "A dark glyph." } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );

    const captions = await captionImagesWithGemini(dir, () => {}, []);

    expect(sharpState.renders).toHaveLength(6);
    expect(sharpState.maxInFlight).toBe(1);
    expect(Object.keys(captions)).toHaveLength(6);
  });

  it("bounds libvips' own worker pool for the renders, then hands it back", async () => {
    // Left at its default the pool sizes itself to the host's core count, so serializing the
    // loop alone still leaves one render fanning out across every core. But `sharp.concurrency`
    // is process-global: leaving it at 1 pins every later sharp caller in this process, none of
    // which asked for captioning, so the bound has to be given back when the renders are done.
    const dir = makeProjectWithSvgs(1);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "A glyph." } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await captionImagesWithGemini(dir, () => {}, []);

    expect(sharpState.concurrencyCalls).toEqual([1, sharpState.HOST_CONCURRENCY]);
    expect(sharpState.concurrency).toBe(sharpState.HOST_CONCURRENCY);
  });

  it("hands the worker pool back even when a rasterize throws", async () => {
    // The restore is in a `finally`, because a skipped SVG must not cost the rest of the process
    // its threads.
    const dir = makeProjectWithSvgs(2);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "A glyph." } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    // Unreadable, which is how an exotic SVG behaves through sharp.
    rmSync(join(dir, "assets", "svgs", "logo-0.svg"));
    mkdirSync(join(dir, "assets", "svgs", "logo-0.svg"));

    await captionImagesWithGemini(dir, () => {}, []);

    expect(sharpState.concurrency).toBe(sharpState.HOST_CONCURRENCY);
  });

  it("keeps captioning the rest when one SVG cannot be rasterized", async () => {
    const dir = makeProjectWithSvgs(3);
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "A glyph." } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    // One file is unreadable, which is how an exotic SVG behaves through sharp.
    rmSync(join(dir, "assets", "svgs", "logo-1.svg"));
    mkdirSync(join(dir, "assets", "svgs", "logo-1.svg"));

    const warnings: string[] = [];
    const captions = await captionImagesWithGemini(dir, () => {}, warnings);

    expect(Object.keys(captions).sort()).toEqual(["svgs/logo-0.svg", "svgs/logo-2.svg"]);
    expect(sharpState.maxInFlight).toBe(1);
  });
});
