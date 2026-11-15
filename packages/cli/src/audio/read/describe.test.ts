import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeStems, type Measured } from "./describe.js";

let dir: string;
let path: string;
const origin = "https://api.heygen.test";
const audio = Buffer.from("ID3test audio");
const measured: Measured = {
  duration: 12,
  bpm: null,
  breaks: [],
  stems: [
    { name: "vocals", db: -16, spans: [{ start: 0, end: 10 }], description: null },
    { name: "other", db: -22, spans: [{ start: 0, end: 12 }], description: null },
  ],
};

function response(text: string): Response {
  return Response.json({
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
  });
}

function describeAudio(warnings: string[], input = measured) {
  return describeStems({ vocals: path, other: path }, input, dir, warnings);
}

function mockMessages(bgmPrompt: string | null = "Instrumental music that develops gradually.") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    return request.output_config
      ? response(
          JSON.stringify({ overall: "Speech with a changing background.", bgm_prompt: bgmPrompt }),
        )
      : response("The stem carries sound throughout.");
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-describe-test-"));
  path = join(dir, "stem.mp3");
  writeFileSync(path, audio);
  for (const key of ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY", "HEYGEN_ACCESS_TOKEN"])
    vi.stubEnv(key, "");
  vi.stubEnv("HEYGEN_API_URL", origin);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("describeStems", () => {
  it("makes no description request and warns once without a HeyGen credential, even with vendor keys", async () => {
    vi.stubEnv("GEMINI_API_KEY", "unused-vendor-key");
    vi.stubEnv("GOOGLE_API_KEY", "unused-google-key");
    vi.stubEnv("HYPERFRAMES_AUDIO_API_KEY", "unused-service-key");
    vi.stubEnv("HYPERFRAMES_AUDIO_STEMS_URL", "https://other.test/stems");
    const fetch = vi.spyOn(globalThis, "fetch");
    const warnings: string[] = [];
    const result = await describeAudio(warnings);
    expect(fetch).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      expect.stringContaining("stems not described: no HeyGen credential"),
    ]);
    expect(result).toEqual({ stems: measured.stems, description: null });
  });

  it.each([
    { credential: "HEYGEN_API_KEY", headers: { "x-api-key": "signed-in" } },
    {
      credential: "HEYGEN_ACCESS_TOKEN",
      headers: { authorization: "Bearer signed-in", "X-HeyGen-Source": "cli" },
    },
  ])(
    "uses $credential for base64 audio and schema-enforced summary requests",
    async ({ credential, headers }) => {
      vi.stubEnv(credential, "signed-in");
      vi.stubEnv("HYPERFRAMES_AUDIO_API_KEY", "not-the-description-key");
      vi.stubEnv("HYPERFRAMES_AUDIO_STEMS_URL", "https://other.test/stems");
      vi.stubEnv("HYPERFRAMES_READ_AUDIO_MODEL", "not-the-model");
      const fetch = mockMessages();
      const warnings: string[] = [];
      const result = await describeAudio(warnings);
      expect(warnings).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(3);
      for (const [url, init] of fetch.mock.calls) {
        expect(url).toBe(`${origin}/v1/hyperframes/llm/messages`);
        expect(init?.redirect).toBe("error");
        expect(init?.headers).toEqual({
          "content-type": "application/json",
          "X-HeyGen-Client-Source": "hyperframes",
          ...headers,
        });
        const request = JSON.parse(String(init?.body));
        expect(request.model).toBe("gemini-4-argon");
        expect(request.messages[0].content.at(-1)).toEqual({
          type: "text",
          text: expect.any(String),
        });
        expect(request.messages[0].content.at(-1).text).not.toMatch(
          /JSON|OVERALL:|BGM PROMPT:|opens with|for example/i,
        );
      }
      for (const call of fetch.mock.calls.slice(0, 2)) {
        const request = JSON.parse(String(call[1]?.body));
        expect(request.output_config).toBeUndefined();
        expect(request.messages).toEqual([
          {
            role: "user",
            content: [
              {
                type: "audio",
                source: {
                  type: "base64",
                  media_type: "audio/mpeg",
                  data: audio.toString("base64"),
                },
              },
              { type: "text", text: expect.any(String) },
            ],
          },
        ]);
      }
      const overall = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
      expect(overall.messages[0].content).toHaveLength(1);
      expect(overall.output_config).toEqual({
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { overall: { type: "string" }, bgm_prompt: { type: ["string", "null"] } },
            required: ["overall", "bgm_prompt"],
            additionalProperties: false,
          },
        },
      });
      expect(result.description).toEqual({
        overall: "Speech with a changing background.",
        bgmPrompt: "Instrumental music that develops gradually.",
      });
      expect(result.stems.map((stem) => stem.description)).toEqual([
        "The stem carries sound throughout.",
        "The stem carries sound throughout.",
      ]);
      await describeAudio(warnings);
      expect(fetch).toHaveBeenCalledTimes(3);
      vi.stubEnv(credential, "");
      expect((await describeAudio(warnings)).description).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(warnings).toHaveLength(1);
    },
  );

  it("preserves a null BGM prompt when there is no music", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    mockMessages(null);
    const warnings: string[] = [];
    expect((await describeAudio(warnings)).description).toEqual({
      overall: "Speech with a changing background.",
      bgmPrompt: null,
    });
    expect(warnings).toEqual([]);
  });

  it("never reads Gemini or Google API keys", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const reads: PropertyKey[] = [];
    const env = new Proxy(process.env, {
      get(target, key) {
        reads.push(key);
        return Reflect.get(target, key);
      },
    });
    const original = process;
    vi.stubGlobal(
      "process",
      new Proxy(original, {
        get(target, key) {
          return key === "env" ? env : Reflect.get(target, key);
        },
      }),
    );
    mockMessages();
    const warnings: string[] = [];
    expect((await describeAudio(warnings)).description).not.toBeNull();
    expect(reads).not.toContain("GEMINI_API_KEY");
    expect(reads).not.toContain("GOOGLE_API_KEY");
    expect(warnings).toEqual([]);
  });

  it.each([
    [
      400,
      { error: { code: "invalid_request", message: "Audio was refused.\nUse a supported model." } },
    ],
    [401, { error: { code: "unauthorized", message: "Sign in again." } }],
    [402, { error: { code: "insufficient_credits", message: "Not enough credits." } }],
    [503, { type: "error", error: { type: "api_error", message: "Please try again." } }],
  ])("reports HTTP %s once without a fallback", async (status, error) => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json(error, { status }));
    const warnings: string[] = [];
    expect(await describeAudio(warnings)).toEqual({ stems: measured.stems, description: null });
    expect(warnings).toEqual([
      `stems not described: the description service answered ${status}: ${error.error.message.replace(/\s+/g, " ")}`,
    ]);
    expect(fetch).toHaveBeenCalledTimes(status >= 500 ? 4 : 2);
  });

  it("reports a network failure once without making a summary request", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network unavailable.\nTry later."));
    const warnings: string[] = [];
    expect(await describeAudio(warnings)).toEqual({ stems: measured.stems, description: null });
    expect(warnings).toEqual(["stems not described: Network unavailable. Try later."]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "OVERALL: Words\nBGM PROMPT: none",
    JSON.stringify({ overall: "Words" }),
    JSON.stringify({ overall: "Words", bgm_prompt: 7 }),
    JSON.stringify({ overall: "", bgm_prompt: null }),
    JSON.stringify({ overall: "   ", bgm_prompt: null }),
    JSON.stringify({ overall: "Words", bgm_prompt: "   " }),
    JSON.stringify({ overall: 7, bgm_prompt: null }),
    JSON.stringify({ bgm_prompt: null }),
    "null",
    "[]",
  ])("rejects a summary outside the schema instead of guessing (%s)", async (answer) => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) =>
        response(JSON.parse(String(init?.body)).output_config ? answer : "Spoken words."),
      );
    const warnings: string[] = [];
    expect(await describeAudio(warnings)).toEqual({ stems: measured.stems, description: null });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^stems not described:/);
    expect(warnings[0]).not.toContain("\n");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([null, [], {}, { content: null }, { content: [null, {}, { type: "text", text: 7 }] }])(
    "rejects a response without text (%j)",
    async (answer) => {
      vi.stubEnv("HEYGEN_API_KEY", "test-key");
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(answer));
      const warnings: string[] = [];
      expect(await describeAudio(warnings)).toEqual({ stems: measured.stems, description: null });
      expect(warnings).toEqual(["stems not described: the description service returned no text"]);
    },
  );

  it("joins only text blocks in a mixed response", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (JSON.parse(String(init?.body)).output_config)
        return response(JSON.stringify({ overall: "Speech.", bgm_prompt: null }));
      return Response.json({
        content: [
          null,
          {},
          { type: "audio", text: "ignored" },
          { type: "text", text: 7 },
          { type: "text", text: "Spoken " },
          { type: "text", text: "words." },
        ],
      });
    });
    const warnings: string[] = [];
    const result = await describeAudio(warnings);
    expect(result.stems.map((stem) => stem.description)).toEqual([
      "Spoken words.",
      "Spoken words.",
    ]);
    expect(warnings).toEqual([]);
  });

  it("keys cached descriptions on content rather than the credential or endpoint", async () => {
    vi.stubEnv("HEYGEN_API_KEY", "first-key");
    const fetch = mockMessages();
    const warnings: string[] = [];
    const first = await describeAudio(warnings);
    vi.stubEnv("HEYGEN_API_KEY", "second-key");
    vi.stubEnv("HEYGEN_API_URL", "https://another.heygen.test");
    expect(await describeAudio(warnings)).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(warnings).toEqual([]);
  });

  it("does not describe silent stems", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const warnings: string[] = [];
    expect(
      await describeAudio(warnings, {
        ...measured,
        stems: measured.stems.map((stem) => ({ ...stem, spans: [] })),
      }),
    ).toEqual({
      stems: measured.stems.map((stem) => ({ ...stem, spans: [] })),
      description: null,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});
