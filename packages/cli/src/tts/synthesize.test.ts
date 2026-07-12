import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportedLang } from "./manager.js";

// Regression coverage for the espeak-ng Mandarin language code mismatch:
// Kokoro's own voice-ID-prefix convention (and our public --lang value) uses
// "zh", but kokoro-onnx/espeak-ng only accept the ISO 639-3 code "cmn" for
// Mandarin. synthesize() must translate at the Python/espeak boundary
// (the argv it hands to execFileSync) without changing the public lang
// value used anywhere else.

const { execFileSyncMock, getCapturedArgv, resetCapturedArgv } = vi.hoisted(() => {
  let capturedArgv: string[] | undefined;
  const mock = vi.fn((cmd: string, args: string[]) => {
    // findPython's `--version` probe.
    if (args[0] === "--version") return "Python 3.11.0";
    // hasPythonPackage's `-c "import <pkg>"` probe — succeed (no throw).
    if (args[0] === "-c") return "";
    // findPython's `which`/`where` lookup.
    if (cmd === "which" || cmd === "where") return "/usr/bin/python3\n";
    // Anything else is the real synthesis script invocation — capture it.
    capturedArgv = args;
    return JSON.stringify({
      outputPath: args[6],
      sampleRate: 24000,
      durationSeconds: 1,
      langApplied: true,
    });
  });
  return {
    execFileSyncMock: mock,
    getCapturedArgv: () => capturedArgv,
    resetCapturedArgv: () => {
      capturedArgv = undefined;
      mock.mockClear();
    },
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn() };
});

vi.mock("./manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager.js")>();
  return {
    ...actual,
    ensureModel: vi.fn().mockResolvedValue("/fake/model.onnx"),
    ensureVoices: vi.fn().mockResolvedValue("/fake/voices.bin"),
  };
});

const { synthesize } = await import("./synthesize.js");
const { SUPPORTED_LANGS } = await import("./manager.js");

// argv passed to execFileSync: [scriptPath, modelPath, voicesPath, text, voice, speed, outputPath, lang]
const LANG_ARGV_INDEX = 7;

const EXPECTED_ESPEAK_LANGS = {
  "en-us": "en-us",
  "en-gb": "en-gb",
  es: "es",
  "fr-fr": "fr-fr",
  hi: "hi",
  it: "it",
  "pt-br": "pt-br",
  ja: "ja",
  zh: "cmn",
} satisfies Record<SupportedLang, string>;

describe("synthesize — espeak-ng language code translation", () => {
  beforeEach(() => {
    resetCapturedArgv();
    delete process.env.HYPERFRAMES_PYTHON;
  });

  it("translates the public zh lang to espeak-ng's cmn at the Python boundary", async () => {
    await synthesize("你好世界", "/tmp/hyperframes-test-zh.wav", { voice: "zf_xiaobei" });

    const argv = getCapturedArgv();
    expect(argv).toBeDefined();
    expect(argv![LANG_ARGV_INDEX]).toBe("cmn");
    expect(argv![LANG_ARGV_INDEX]).not.toBe("zh");
  });

  it("translates an explicit zh override too", async () => {
    const progress: string[] = [];
    await synthesize("你好世界", "/tmp/hyperframes-test-explicit-zh.wav", {
      voice: "af_heart",
      lang: "zh",
      onProgress: (message) => progress.push(message),
    });

    expect(getCapturedArgv()?.[LANG_ARGV_INDEX]).toBe("cmn");
    expect(progress).toContain("Generating speech with voice af_heart (zh)...");
  });

  it("keeps every non-Mandarin public lang unchanged at the Python boundary", async () => {
    for (const lang of SUPPORTED_LANGS) {
      resetCapturedArgv();

      await synthesize("Hello world", `/tmp/hyperframes-test-${lang}.wav`, {
        voice: "af_heart",
        lang,
      });

      expect(getCapturedArgv()?.[LANG_ARGV_INDEX]).toBe(EXPECTED_ESPEAK_LANGS[lang]);
    }
  });

  it("leaves voice-inferred Spanish unchanged", async () => {
    await synthesize("Hola mundo", "/tmp/hyperframes-test-es.wav", {
      voice: "ef_dora",
    });

    expect(getCapturedArgv()?.[LANG_ARGV_INDEX]).toBe("es");
  });
});
