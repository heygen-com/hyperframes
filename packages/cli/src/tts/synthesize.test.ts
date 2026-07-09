import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the espeak-ng Mandarin language code mismatch:
// Kokoro's own voice-ID-prefix convention (and our public --lang value) uses
// "zh", but espeak-ng 1.52.0 only recognizes the ISO 639-3 code "cmn" for
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

// argv passed to execFileSync: [scriptPath, modelPath, voicesPath, text, voice, speed, outputPath, lang]
const LANG_ARGV_INDEX = 7;

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

  it("leaves other languages unchanged", async () => {
    await synthesize("Hola mundo", "/tmp/hyperframes-test-es.wav", { voice: "ef_dora" });

    const argv = getCapturedArgv();
    expect(argv).toBeDefined();
    expect(argv![LANG_ARGV_INDEX]).toBe("es");
  });

  it("returns the public zh value in the result even though cmn is sent to Python", async () => {
    const result = await synthesize("你好世界", "/tmp/hyperframes-test-zh-2.wav", {
      voice: "zf_xiaobei",
    });

    // langApplied comes back from the (mocked) Python side untouched — this
    // just guards that the public API doesn't leak the espeak override.
    expect(result.langApplied).toBe(true);
  });
});
