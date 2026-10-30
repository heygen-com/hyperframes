import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pipeline from "./background-removal/pipeline.js";
import * as manager from "./whisper/manager.js";
import * as sherpa from "./whisper/sherpa.js";
import * as whisper from "./whisper/transcribe.js";
import {
  RemoveBackgroundError,
  TranscribeError,
  removeBackground,
  transcribe,
  type TranscribeOptions,
} from "./api.js";

const SRT = `1
00:00:01,000 --> 00:00:03,500
Write HTML.

2
00:00:03,500 --> 00:00:06,000
Render video. Built for agents.
`;

let dir: string;
let transcribeMock: MockInstance<typeof whisper.transcribe>;
let renderMock: MockInstance<typeof pipeline.render>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-api-test-"));
  transcribeMock = vi.spyOn(whisper, "transcribe");
  renderMock = vi.spyOn(pipeline, "render");
  // Parakeet runs on parakeet-mlx in these tests, whatever this machine has installed.
  vi.spyOn(sherpa, "sherpaParakeetInstalled").mockReturnValue(false);
  vi.spyOn(console, "log");
  vi.spyOn(console, "error");
});
afterEach(() => {
  // The API never prints: that is the CLI's job.
  expect(console.log).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function dummyAudio(): string {
  const input = join(dir, "narration.wav");
  writeFileSync(input, "not-real-audio");
  return input;
}

/** What a whisper run leaves behind: a one-word transcript in the output folder. */
function whisperResult(outputDir: string) {
  const transcriptPath = join(outputDir, "transcript.json");
  writeFileSync(transcriptPath, JSON.stringify([{ text: "hola", start: 0, end: 1 }]));
  return {
    model: "small.en",
    detectedLanguage: "es",
    transcriptPath,
    wordCount: 1,
    durationSeconds: 2,
    speechOnsetSeconds: null,
  };
}

async function transcribeError(options: Parameters<typeof transcribe>[0]) {
  const err = await transcribe(options).catch((e: unknown) => e);
  if (!(err instanceof TranscribeError)) throw new Error(`expected a TranscribeError, got ${err}`);
  return err;
}

describe("transcribe", () => {
  it("imports a transcript file into transcript.json", async () => {
    const input = join(dir, "sample.srt");
    writeFileSync(input, SRT);

    const result = await transcribe({ input });

    const transcriptPath = join(dir, "transcript.json");
    expect(result).toEqual({ kind: "imported", format: "srt", wordCount: 2, transcriptPath });
    expect(JSON.parse(readFileSync(transcriptPath, "utf8"))).toHaveLength(2);
  });

  it("writes only the caption file for a transcript input with captions", async () => {
    const input = join(dir, "words.json");
    writeFileSync(
      input,
      JSON.stringify([
        { text: "Yes", start: 0, end: 1 },
        { text: "No", start: 1, end: 2 },
      ]),
    );

    const result = await transcribe({ input, captions: { format: "srt", preserveCues: true } });

    const outputPath = join(dir, "transcript.srt");
    expect(result).toEqual({ kind: "exported", format: "srt", wordCount: 2, outputPath });
    expect(readFileSync(outputPath, "utf8")).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nYes\n\n2\n00:00:01,000 --> 00:00:02,000\nNo\n",
    );
    expect(existsSync(join(dir, "transcript.json"))).toBe(false);
  });

  it("transcribes with whisper and hands back the runner, status and progress", async () => {
    const input = dummyAudio();
    transcribeMock.mockImplementation(async (_input, outputDir, options) => {
      options?.onProgress?.("Checking model...");
      options?.onEvent?.({
        type: "progress",
        phase: "transcription",
        model: "small.en",
        status: "started",
      });
      return whisperResult(outputDir);
    });
    const onEngine = vi.fn();
    const onStatus = vi.fn();
    const onProgress = vi.fn();

    const result = await transcribe({
      input,
      engine: "whisper",
      model: "small.en",
      onEngine,
      onStatus,
      onProgress,
    });

    expect(result).toEqual({
      kind: "transcribed",
      engine: "whisper",
      model: "small.en",
      detectedLanguage: "es",
      wordCount: 1,
      durationSeconds: 2,
      speechOnsetSeconds: null,
      transcriptPath: join(dir, "transcript.json"),
    });
    expect(onEngine).toHaveBeenCalledExactlyOnceWith({
      runner: "whisper",
      engine: "whisper",
      model: "small.en",
    });
    expect(onStatus).toHaveBeenCalledWith("Checking model...");
    expect(onProgress).toHaveBeenCalledWith({
      type: "progress",
      phase: "transcription",
      model: "small.en",
      status: "started",
    });
  });

  it("asks whisper for progress only when the caller listens for it", async () => {
    // Whisper adds --print-progress whenever it gets an onEvent, so an unused one is not free.
    const input = dummyAudio();
    transcribeMock.mockImplementation(async (_input, outputDir) => whisperResult(outputDir));

    await transcribe({ input, engine: "whisper" });

    expect(transcribeMock.mock.calls[0]?.[2]).toMatchObject({
      onEvent: undefined,
      onProgress: undefined,
    });
  });

  it("stops on the caller's AbortSignal without installing process signal handlers", async () => {
    const input = dummyAudio();
    const controller = new AbortController();
    let handlersAdded = -1;
    let signal: unknown;
    transcribeMock.mockImplementation(async (_input, _outputDir, options) => {
      const before = process.listenerCount("SIGINT");
      signal = options?.startCancellation?.();
      handlersAdded = process.listenerCount("SIGINT") - before;
      controller.abort();
      throw new Error("Command failed: whisper-cli");
    });

    const err = await transcribeError({ input, engine: "whisper", signal: controller.signal });

    expect(err.code).toBe("cancelled");
    expect(signal).toBe(controller.signal);
    expect(handlersAdded).toBe(0);
  });

  it("names a missing whisper as whisper_unavailable, with the original error as cause", async () => {
    const input = dummyAudio();
    const missing = new manager.WhisperUnavailableError("whisper-cpp not found");
    transcribeMock.mockRejectedValue(missing);

    const err = await transcribeError({ input, engine: "whisper" });

    expect(err.code).toBe("whisper_unavailable");
    expect(err.cause).toBe(missing);
    expect(err.install).toBeUndefined();
  });

  it("adds the ASR program's last stderr lines to a failure", async () => {
    const input = dummyAudio();
    const crash = Object.assign(new Error("Command failed: whisper-cli"), {
      stderr: "loading model\nout of memory\n",
    });
    transcribeMock.mockRejectedValue(crash);

    const err = await transcribeError({ input, engine: "whisper" });

    expect(err.code).toBe("failed");
    expect(err.message).toBe("Command failed: whisper-cli\nloading model\nout of memory");
    expect(err.cause).toBe(crash);
  });

  it("reports the model whisper will run, not the English-only default", async () => {
    const input = dummyAudio();
    transcribeMock.mockImplementation(async (_input, outputDir) => whisperResult(outputDir));
    const onEngine = vi.fn();

    await transcribe({ input, engine: "whisper", language: "es", onEngine });

    expect(onEngine).toHaveBeenCalledWith(expect.objectContaining({ model: "small" }));
  });

  it("throws at once for a signal that is already aborted, before any setup", async () => {
    const input = dummyAudio();
    const controller = new AbortController();
    controller.abort();

    const err = await transcribeError({ input, engine: "whisper", signal: controller.signal });

    expect(err.code).toBe("cancelled");
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "stops a running parakeet-mlx when the signal aborts",
    async () => {
      const pidFile = join(dir, "parakeet.pid");
      const runner = join(dir, "parakeet-mlx");
      writeFileSync(
        runner,
        `#!/bin/sh\n[ "$1" = --help ] && exit 0\necho $$ > "${pidFile}"\nexec sleep 30\n`,
      );
      chmodSync(runner, 0o755);
      vi.stubEnv("HYPERFRAMES_PARAKEET", runner);
      const controller = new AbortController();
      const started = Date.now();
      // Abort once the child is really running; a blocked event loop never gets this far.
      const poll = setInterval(() => {
        if (existsSync(pidFile) && readFileSync(pidFile, "utf8").trim()) controller.abort();
      }, 20);

      const err = await transcribeError({
        input: dummyAudio(),
        engine: "parakeet",
        signal: controller.signal,
      }).finally(() => clearInterval(poll));

      expect(err.code).toBe("cancelled");
      expect(Date.now() - started).toBeLessThan(10_000);
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    },
  );

  /** A stand-in tool that starts a process of its own, writes both pids, then waits for it. */
  function hangingTool(path: string, pidFile: string, before = ""): void {
    writeFileSync(path, `#!/bin/sh\n${before}sleep 15 &\necho "$$ $!" > "${pidFile}"\nwait\n`);
    chmodSync(path, 0o755);
  }

  /** Aborts once the stand-in is running; a blocked event loop never gets to. */
  async function abortWhileRunning(pidFile: string, options: Omit<TranscribeOptions, "signal">) {
    const controller = new AbortController();
    const poll = setInterval(() => {
      if (existsSync(pidFile) && readFileSync(pidFile, "utf8").includes(" ")) controller.abort();
    }, 20);
    const started = Date.now();
    const err = await transcribeError({ ...options, signal: controller.signal }).finally(() =>
      clearInterval(poll),
    );
    const pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    return { err, elapsed: Date.now() - started, pids };
  }

  it.skipIf(process.platform === "win32")(
    "stops a whisper runtime install in progress when the signal aborts",
    async (ctx) => {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const pidFile = join(dir, "install.pid");
      // Homebrew on macOS, git clone elsewhere: whichever install step runs first never ends.
      hangingTool(join(bin, "brew"), pidFile);
      hangingTool(join(bin, "git"), pidFile);
      writeFileSync(join(bin, "cmake"), "#!/bin/sh\nexit 1\n");
      chmodSync(join(bin, "cmake"), 0o755);
      vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`);
      vi.stubEnv("HYPERFRAMES_WHISPER_PATH", "");
      if (manager.findWhisper()) ctx.skip();

      const { err, elapsed, pids } = await abortWhileRunning(pidFile, {
        input: dummyAudio(),
        engine: "whisper",
      });

      expect(err.code).toBe("cancelled");
      expect(elapsed).toBeLessThan(10_000);
      for (const pid of pids) expect(() => process.kill(pid, 0), `pid ${pid}`).toThrow();
    },
  );

  it.skipIf(process.platform === "win32")(
    "stops ffmpeg preparing the audio when the signal aborts, and removes its partial WAV",
    async () => {
      vi.spyOn(manager, "ensureWhisper").mockResolvedValue({
        executablePath: "/no/whisper-cli",
        source: "system",
      });
      vi.spyOn(manager, "ensureModel").mockResolvedValue(join(dir, "ggml-small.en.bin"));
      const ffmpeg = join(dir, "ffmpeg");
      const pidFile = join(dir, "ffmpeg.pid");
      hangingTool(ffmpeg, pidFile, 'for out; do :; done\nprintf partial > "$out"\n');
      vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", ffmpeg);
      vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", join(dir, "no-ffprobe"));
      const input = join(dir, "narration.mp3");
      writeFileSync(input, "not-real-audio");
      const wavs = () =>
        readdirSync(tmpdir()).filter((f) => f.startsWith(`hyperframes-audio-${process.pid}-`));

      const { err, elapsed, pids } = await abortWhileRunning(pidFile, { input, engine: "whisper" });

      expect(err.code).toBe("cancelled");
      expect(elapsed).toBeLessThan(10_000);
      for (const pid of pids) expect(() => process.kill(pid, 0), `pid ${pid}`).toThrow();
      expect(wavs()).toEqual([]);
    },
  );

  // Spelled so that this file's own source, which it also reads, does not match.
  const localLoad = /\bimport\(|\bimport[OAM](?:riginal|ctual|ock)\b/;

  it("keeps every module load at module scope, in the API, the code it runs and their tests", () => {
    for (const sample of [
      "await import" + "('x')",
      "vi.import" + "Actual('x')",
      "import" + "Original()",
    ]) {
      expect(sample).toMatch(localLoad);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const api = readdirSync(join(here, "api")).map((f) => join("api", f));
    const files = [
      "api.ts",
      ...api,
      "api.test.ts",
      "commands/remove-background.ts",
      "commands/transcribe.ts",
      "commands/transcribe.test.ts",
      "utils/download.ts",
      "utils/download.test.ts",
      "utils/stoppableExecFile.ts",
      "utils/stoppableExecFile.test.ts",
      "whisper/manager.ts",
      "whisper/modelFile.ts",
      "whisper/modelForLanguage.ts",
      "whisper/parakeet.ts",
      "whisper/sherpa.ts",
      "whisper/transcribe.ts",
      "whisper/transcribe.test.ts",
      "whisper/transcribe.signal.test.ts",
    ];
    for (const file of files) {
      expect(readFileSync(join(here, file), "utf8"), file).not.toMatch(localLoad);
    }
  });

  it.each([
    ["a missing input", () => ({ input: join(dir, "missing.wav") }), "input_not_found"],
    [
      "a transcript with no words",
      () => {
        writeFileSync(join(dir, "empty.json"), "[]");
        return { input: join(dir, "empty.json") };
      },
      "no_words",
    ],
    [
      "a timeout below the minimum",
      () => ({ input: dummyAudio(), timeoutMs: 100 }),
      "invalid_timeout",
    ],
  ])("rejects %s before any engine runs", async (_case, options, code) => {
    const err = await transcribeError(options());
    expect(err.code).toBe(code);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown caption format from an untyped caller", async () => {
    // @ts-expect-error -- plain JavaScript callers get no compile-time check.
    const err = await transcribeError({ input: dummyAudio(), captions: { format: "txt" } });
    expect(err).toMatchObject({
      code: "invalid_option",
      message: "Unsupported caption export format: txt. Use srt or vtt.",
    });
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});

describe("removeBackground", () => {
  it("hands the pipeline absolute paths and returns its result", async () => {
    const rendered = {
      outputPath: resolve("cutout.webm"),
      framesProcessed: 3,
      durationSeconds: 1,
      avgMsPerFrame: 10,
      provider: "cpu",
      format: "webm" as const,
    };
    renderMock.mockResolvedValue(rendered);
    const onProgress = vi.fn();

    const result = await removeBackground({
      input: "avatar.mp4",
      output: "cutout.webm",
      device: "cpu",
      quality: "fast",
      onProgress,
    });

    expect(result).toBe(rendered);
    expect(renderMock).toHaveBeenCalledExactlyOnceWith({
      inputPath: resolve("avatar.mp4"),
      outputPath: resolve("cutout.webm"),
      backgroundOutputPath: undefined,
      device: "cpu",
      quality: "fast",
      onProgress,
    });
  });

  async function rejected(options: Parameters<typeof removeBackground>[0]) {
    const err = await removeBackground(options).catch((e: unknown) => e);
    expect(renderMock).not.toHaveBeenCalled();
    return err;
  }

  it("rejects an unknown device or quality from an untyped caller", async () => {
    const paths = { input: "avatar.mp4", output: "cutout.webm" };
    // @ts-expect-error -- plain JavaScript callers get no compile-time check.
    expect(await rejected({ ...paths, device: "gpu" })).toMatchObject({
      name: "RemoveBackgroundError",
      code: "invalid_option",
      message: "Invalid device 'gpu'. Use: auto, cpu, coreml, cuda.",
    });
    // @ts-expect-error -- plain JavaScript callers get no compile-time check.
    expect(await rejected({ ...paths, quality: "max" })).toMatchObject({
      name: "RemoveBackgroundError",
      code: "invalid_option",
      message: "Invalid quality 'max'. Use: fast, balanced, best.",
    });
  });

  it("wraps a pipeline failure, keeping its message and the original as cause", async () => {
    const failure = new Error("ffmpeg and ffprobe are required.");
    renderMock.mockRejectedValue(failure);

    const err = await removeBackground({ input: "avatar.mp4", output: "cutout.webm" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RemoveBackgroundError);
    expect(err).toMatchObject({ code: "failed", message: failure.message, cause: failure });
  });
});
