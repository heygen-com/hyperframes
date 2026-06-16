import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionImagesWithGemini } from "./contentExtractor.js";

// These tests exercise the OpenRouter provider path only — it makes a plain
// `fetch` call we can stub, with no native (`sharp`) or `@google/genai`
// dependency. OpenRouter wins over Gemini when OPENROUTER_API_KEY is set, so we
// don't need to clear the Gemini keys for the OpenRouter cases.

function makeProjectWithImage(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-caption-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  // Contents are irrelevant to the OpenRouter path (it just base64-encodes the
  // bytes); only the .png extension matters for the image filter.
  writeFileSync(join(dir, "assets", "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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
    const dir = makeProjectWithImage();
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
    const dir = makeProjectWithImage();
    dirs.push(dir);
    vi.stubEnv("OPENROUTER_API_KEY", "or-bad-key");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("invalid api key", { status: 401, statusText: "Unauthorized" }),
      ),
    );

    const warnings: string[] = [];
    // captionOne throws on !res.ok, but the throw is per-image inside
    // Promise.allSettled, so it's filtered out as a rejected result rather than
    // bubbling up — same silent degradation as the existing Gemini path.
    const captions = await captionImagesWithGemini(dir, () => {}, warnings);

    expect(captions).toEqual({});
  });

  it("skips captioning entirely when no provider key is present", async () => {
    const dir = makeProjectWithImage();
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
