import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Tests for MiniMax TTS provider (packages/cli/src/tts/minimax.ts)
// ---------------------------------------------------------------------------

describe("MiniMax TTS — MINIMAX_VOICES", () => {
  it("exports a non-empty voice list", async () => {
    const { MINIMAX_VOICES } = await import("./minimax.js");
    expect(MINIMAX_VOICES.length).toBeGreaterThan(0);
  });

  it("all voices have required fields", async () => {
    const { MINIMAX_VOICES } = await import("./minimax.js");
    for (const v of MINIMAX_VOICES) {
      expect(v.id).toBeTruthy();
      expect(v.label).toBeTruthy();
      expect(v.language).toBeTruthy();
      expect(["female", "male", "neutral"]).toContain(v.gender);
    }
  });

  it("default voice is present in the list", async () => {
    const { MINIMAX_VOICES, MINIMAX_DEFAULT_VOICE } = await import("./minimax.js");
    const ids = MINIMAX_VOICES.map((v) => v.id);
    expect(ids).toContain(MINIMAX_DEFAULT_VOICE);
  });
});

describe("MiniMax TTS — constants", () => {
  it("MINIMAX_BASE_URL uses the international MiniMax domain", async () => {
    const { MINIMAX_BASE_URL } = await import("./minimax.js");
    expect(MINIMAX_BASE_URL).toMatch(/^https:\/\/api\.minimax\.io/);
  });

  it("MINIMAX_DEFAULT_MODEL is speech-2.8-hd", async () => {
    const { MINIMAX_DEFAULT_MODEL } = await import("./minimax.js");
    expect(MINIMAX_DEFAULT_MODEL).toBe("speech-2.8-hd");
  });
});

describe("MiniMax TTS — synthesizeWithMiniMax", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "minimax-test-"));
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when MINIMAX_API_KEY is missing and no apiKey provided", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await expect(synthesizeWithMiniMax("hello", join(tmpDir, "out.mp3"))).rejects.toThrow(
      /MINIMAX_API_KEY/,
    );
  });

  it("calls the correct endpoint with Authorization header", async () => {
    // Build a minimal SSE response with one audio chunk (hex-encoded "ID3")
    const hexChunk = Buffer.from("ID3").toString("hex"); // "494433"
    const sseBody = [
      `data: ${JSON.stringify({ data: { audio: hexChunk, status: 1 }, base_resp: { status_code: 0, status_msg: "success" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(sseBody, { status: 200 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    const outPath = join(tmpDir, "out.mp3");
    const result = await synthesizeWithMiniMax("Hello world", outPath, {
      apiKey: "test-key",
    });

    // Verify API endpoint contains /v1/t2a_v2
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/t2a_v2"),
      expect.objectContaining({ method: "POST" }),
    );

    // Verify Authorization header
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");

    // Verify output file was written
    expect(existsSync(outPath)).toBe(true);

    // Verify result shape
    expect(result.outputPath).toBe(outPath);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("uses custom baseUrl when provided", async () => {
    const hexChunk = Buffer.from("data").toString("hex");
    const sseBody = [
      `data: ${JSON.stringify({ data: { audio: hexChunk, status: 1 }, base_resp: { status_code: 0, status_msg: "success" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(sseBody, { status: 200 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await synthesizeWithMiniMax("Hello", join(tmpDir, "out.mp3"), {
      apiKey: "test-key",
      baseUrl: "https://custom.example.com",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.example.com/v1/t2a_v2",
      expect.anything(),
    );
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await expect(
      synthesizeWithMiniMax("Hello", join(tmpDir, "out.mp3"), { apiKey: "bad-key" }),
    ).rejects.toThrow(/401/);
  });

  it("throws when API returns a non-zero status_code in SSE event", async () => {
    const sseBody = [
      `data: ${JSON.stringify({ base_resp: { status_code: 2013, status_msg: "invalid voice" } })}`,
      "",
    ].join("\n");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(sseBody, { status: 200 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await expect(
      synthesizeWithMiniMax("Hello", join(tmpDir, "out.mp3"), { apiKey: "test-key" }),
    ).rejects.toThrow(/2013/);
  });

  it("uses default model speech-2.8-hd in request body", async () => {
    const hexChunk = Buffer.from("data").toString("hex");
    const sseBody = [
      `data: ${JSON.stringify({ data: { audio: hexChunk, status: 1 }, base_resp: { status_code: 0, status_msg: "success" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(sseBody, { status: 200 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await synthesizeWithMiniMax("Hello", join(tmpDir, "out.mp3"), { apiKey: "test-key" });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("speech-2.8-hd");
  });

  it("uses MINIMAX_API_KEY from environment if no explicit apiKey", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");

    const hexChunk = Buffer.from("data").toString("hex");
    const sseBody = [
      `data: ${JSON.stringify({ data: { audio: hexChunk, status: 1 }, base_resp: { status_code: 0, status_msg: "success" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(sseBody, { status: 200 }));

    const { synthesizeWithMiniMax } = await import("./minimax.js");
    await synthesizeWithMiniMax("Hello", join(tmpDir, "out.mp3"));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer env-key");
  });
});

describe("MiniMax TTS — audio decoding", () => {
  it("correctly decodes hex-encoded audio", () => {
    const original = Buffer.from("Hello audio data");
    const hex = original.toString("hex");
    const decoded = Buffer.from(hex, "hex");
    expect(decoded).toEqual(original);
  });

  it("concatenates multiple hex-encoded chunks correctly", () => {
    const chunk1 = Buffer.from("Hello ");
    const chunk2 = Buffer.from("world");
    const combined = Buffer.concat([
      Buffer.from(chunk1.toString("hex"), "hex"),
      Buffer.from(chunk2.toString("hex"), "hex"),
    ]);
    expect(combined.toString()).toBe("Hello world");
  });
});
