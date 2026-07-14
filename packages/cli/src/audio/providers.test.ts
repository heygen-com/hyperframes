import { describe, expect, it } from "vitest";
import { decideMusic, decideVoice, KOKORO_PIP, MUSICGEN_PIP } from "./providers.js";

describe("decideVoice — mirrors the skill's heygen → elevenlabs → cartesia → kokoro order", () => {
  it("prefers HeyGen when configured", () => {
    const r = decideVoice({ hasHeygen: true, elevenlabs: true, cartesia: true, kokoro: true });
    expect(r.engine).toBe("heygen");
    expect(r.ready).toBe(true);
  });

  it("prefers ElevenLabs over ready Cartesia and Kokoro", () => {
    const r = decideVoice({ hasHeygen: false, elevenlabs: true, cartesia: true, kokoro: true });
    expect(r.engine).toBe("elevenlabs");
  });

  it("falls to ready Cartesia before Kokoro", () => {
    const r = decideVoice({ hasHeygen: false, elevenlabs: false, cartesia: true, kokoro: true });
    expect(r).toEqual({ engine: "cartesia", label: "Cartesia", local: false, ready: true });
  });

  it("falls to ready Kokoro when no cloud provider is usable", () => {
    const r = decideVoice({ hasHeygen: false, elevenlabs: false, cartesia: false, kokoro: true });
    expect(r.engine).toBe("kokoro");
    expect(r.ready).toBe(true);
  });

  it("flags Kokoro as not-ready with a pip hint when all providers are unavailable", () => {
    const r = decideVoice({
      hasHeygen: false,
      elevenlabs: false,
      cartesia: false,
      kokoro: false,
    });
    expect(r.engine).toBe("kokoro");
    expect(r.ready).toBe(false);
    expect(r.setupHint).toBe(KOKORO_PIP);
  });

  it("omits the hint when Kokoro is ready", () => {
    expect(
      decideVoice({ hasHeygen: false, elevenlabs: false, cartesia: false, kokoro: true }).setupHint,
    ).toBeUndefined();
  });
});

describe("decideMusic — mirrors the skill's heygen → lyria → musicgen order", () => {
  it("prefers HeyGen, then Lyria, then MusicGen", () => {
    expect(decideMusic({ hasHeygen: true, lyria: true, musicgen: true }).engine).toBe("heygen");
    expect(decideMusic({ hasHeygen: false, lyria: true, musicgen: true }).engine).toBe("lyria");
    expect(decideMusic({ hasHeygen: false, lyria: false, musicgen: true }).engine).toBe("musicgen");
  });

  it("flags MusicGen as not-ready with a pip hint when deps are missing", () => {
    const r = decideMusic({ hasHeygen: false, lyria: false, musicgen: false });
    expect(r.engine).toBe("musicgen");
    expect(r.ready).toBe(false);
    expect(r.setupHint).toBe(MUSICGEN_PIP);
  });
});
