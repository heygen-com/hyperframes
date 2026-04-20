import { describe, expect, it } from "vitest";
import {
  BUNDLED_VOICES,
  SUPPORTED_LANGS,
  inferLangFromVoiceId,
  isSupportedLang,
} from "./manager.js";

describe("inferLangFromVoiceId", () => {
  it.each([
    ["af_heart", "en-us"],
    ["am_adam", "en-us"],
    ["bf_emma", "en-gb"],
    ["bm_george", "en-gb"],
    ["ef_dora", "es"],
    ["ff_siwis", "fr-fr"],
    ["hf_alpha", "hi"],
    ["if_sara", "it"],
    ["jf_alpha", "ja"],
    ["pf_dora", "pt-br"],
    ["zf_xiaobei", "zh"],
  ])("maps voice %s to lang %s", (voiceId, expected) => {
    expect(inferLangFromVoiceId(voiceId)).toBe(expected);
  });

  it("falls back to en-us for unknown prefixes", () => {
    expect(inferLangFromVoiceId("xf_test")).toBe("en-us");
    expect(inferLangFromVoiceId("")).toBe("en-us");
  });

  it("is case-insensitive on the prefix letter", () => {
    expect(inferLangFromVoiceId("EF_dora")).toBe("es");
    expect(inferLangFromVoiceId("ZF_xiaobei")).toBe("zh");
  });
});

describe("isSupportedLang", () => {
  it("accepts every value in SUPPORTED_LANGS", () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(isSupportedLang(lang)).toBe(true);
    }
  });

  it("rejects invalid or misspelled lang codes", () => {
    expect(isSupportedLang("english")).toBe(false);
    expect(isSupportedLang("de")).toBe(false);
    expect(isSupportedLang("")).toBe(false);
  });
});

describe("BUNDLED_VOICES", () => {
  // --lang is user-facing, so the voice list must give users a working
  // example in at least the most common non-English locales.
  it("exposes at least one voice per non-English language", () => {
    const langs = new Set(BUNDLED_VOICES.map((v) => inferLangFromVoiceId(v.id)));
    expect(langs.has("es")).toBe(true);
    expect(langs.has("fr-fr")).toBe(true);
    expect(langs.has("ja")).toBe(true);
    expect(langs.has("zh")).toBe(true);
  });
});
