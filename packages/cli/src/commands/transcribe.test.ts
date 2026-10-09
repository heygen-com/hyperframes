import { runCommand } from "citty";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { WhisperUnavailableError } from "../whisper/manager.js";
import { formatVtt, loadTranscript } from "../whisper/normalize.js";
import { CliRuntimeError, consumeCommandResult } from "../utils/commandResult.js";

// Make the whisper core report "unavailable" so we exercise the soft-skip path.
const transcribeMock = vi.fn();
const prepareWavMock = vi.fn((input: string) => input);
let audioSeconds = 1;
vi.mock("../whisper/transcribe.js", () => ({
  transcribe: transcribeMock,
  prepareWav: (input: string) => prepareWavMock(input),
  getPreparedWavDurationSeconds: () => audioSeconds,
}));

// Engine selection: which runners look installed, and the sherpa decode child it spawns.
const runners = { sherpa: false, mlx: false };
let runtimeDir: string;
vi.mock("../whisper/sherpa.js", async (importOriginal) => {
  const sherpa = await importOriginal<typeof import("../whisper/sherpa.js")>();
  return {
    ...sherpa,
    sherpaParakeetInstalled: () => runners.sherpa,
    transcribeWithSherpa: (
      wavPath: string,
      dir: string,
      options: Parameters<typeof sherpa.transcribeWithSherpa>[2],
    ) =>
      sherpa.transcribeWithSherpa(wavPath, dir, {
        ...options,
        runtimeDir,
        cliUrl: pathToFileURL(join(runtimeDir, "dist", "cli.js")).href,
      }),
  };
});
const mlxMock = vi.fn();
vi.mock("../whisper/parakeet.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../whisper/parakeet.js")>()),
  findParakeet: () => (runners.mlx ? "/bin/parakeet-mlx" : undefined),
  transcribeWithParakeet: (...a: unknown[]) => mlxMock(...a),
}));
const execFileMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: (...a: unknown[]) => execFileMock(...a),
}));

const trackTranscribeUnavailable = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackTranscribeUnavailable: (...a: unknown[]) => trackTranscribeUnavailable(...a),
}));

import transcribeCmd from "./transcribe.js";

/** Makes each runner write a one-word transcript naming itself. */
function fakeTranscript(dir: string, text: string) {
  const transcriptPath = join(dir, "transcript.json");
  writeFileSync(transcriptPath, JSON.stringify([{ text, start: 0, end: 1 }]));
  return {
    model: text === "whisper" ? "small.en" : "parakeet-tdt-0.6b-v3",
    detectedLanguage: null,
    transcriptPath,
    wordCount: 1,
    durationSeconds: 1,
    speechOnsetSeconds: null,
  };
}

function lastJson(): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
}

function dummyAudio(): { dir: string; input: string } {
  const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
  const input = join(dir, "narration.wav");
  writeFileSync(input, "not-real-audio");
  return { dir, input };
}

describe("transcribe command", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
    consumeCommandResult();
    transcribeMock.mockReset();
    prepareWavMock.mockReset().mockImplementation((input: string) => input);
    trackTranscribeUnavailable.mockReset();
    mlxMock.mockReset();
    Object.assign(runners, { sherpa: false, mlx: false });
    transcribeMock.mockRejectedValue(
      new WhisperUnavailableError("whisper-cpp not found. Install: brew install whisper-cpp"),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consumeCommandResult();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps quiet Spanish words before the relative speech onset in transcript and captions", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const words = [
      { id: "w0", text: "Siempre", start: 0.2, end: 0.49 },
      { id: "w1", text: "que", start: 0.49, end: 0.7 },
      { id: "w2", text: "los", start: 0.7, end: 0.91 },
      { id: "w3", text: "nietos", start: 0.91, end: 1.33 },
      { id: "w4", text: "vecindario", start: 10.03, end: 11.02 },
    ];
    const htmlPath = join(dir, "index.html");
    writeFileSync(htmlPath, "<script>const TRANSCRIPT = [];</script>");
    transcribeMock.mockImplementation(async (_input, outputDir) => {
      const result = fakeTranscript(outputDir, "whisper");
      writeFileSync(result.transcriptPath, JSON.stringify(words));
      return { ...result, wordCount: 5, durationSeconds: 50, speechOnsetSeconds: 10 };
    });

    await runCommand(transcribeCmd, {
      rawArgs: [input, "--dir", dir, "--engine", "whisper", "--language", "es", "--json"],
    });

    expect(JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"))).toEqual(words);
    const captions = readFileSync(htmlPath, "utf8").match(/const TRANSCRIPT = ([\s\S]*?);/)![1]!;
    expect(JSON.parse(captions)).toEqual(words);
    expect(lastJson()).toMatchObject({ ok: true, wordCount: 5, speechOnsetSeconds: 10 });
  });

  it("keeps typed progress on stderr and reports resolved metadata in one stdout result", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    transcribeMock.mockImplementation(async (_input, outputDir, options) => {
      options.onEvent?.({
        type: "progress",
        phase: "download",
        model: "small",
        receivedBytes: 5,
        totalBytes: null,
      });
      options.onEvent?.({
        type: "progress",
        phase: "transcription",
        model: "small",
        status: "started",
      });
      options.onEvent?.({
        type: "progress",
        phase: "transcription",
        model: "small",
        status: "completed",
      });
      return { ...fakeTranscript(outputDir, "hola"), model: "small", detectedLanguage: "es" };
    });
    await transcribeCmd.run!({
      args: { input, dir, json: true, engine: "whisper", model: "small.en" },
    } as never);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(lastJson()).toMatchObject({ ok: true, model: "small", detectedLanguage: "es" });
    expect(stderr.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { type: "progress", phase: "download", model: "small", receivedBytes: 5, totalBytes: null },
      { type: "progress", phase: "transcription", model: "small", status: "started" },
      { type: "progress", phase: "transcription", model: "small", status: "completed" },
    ]);
    expect(JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"))).toEqual([
      { id: "w0", text: "hola", start: 0, end: 1 },
    ]);
  });

  it("explicit run exits non-zero and is NOT reported as a command failure", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    // Pin the engine. `auto` picks Parakeet whenever parakeet-mlx happens to be
    // installed, and only the whisper path is mocked here -- so on those
    // machines this test used to shell out to a real ASR binary, fail with
    // "Parakeet did not produce output", and land in the generic failure branch
    // instead of the soft-skip it is asserting.
    await transcribeCmd.run!({
      args: { input, json: true, optional: false, engine: "whisper" },
    } as never);

    expect(transcribeMock).toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(trackTranscribeUnavailable).toHaveBeenCalledWith({ optional: false });
  });

  it("--optional skips cleanly with exit 0", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    await transcribeCmd.run!({
      args: { input, json: true, optional: true, engine: "whisper" },
    } as never);

    // Asserting the mock ran is what keeps this honest: without it the test
    // passes on a machine with no Parakeet and silently tests nothing on one
    // that has it.
    expect(transcribeMock).toHaveBeenCalled();
    expect(prepareWavMock).not.toHaveBeenCalled();
    expect(consumeCommandResult().exitCode).toBe(0);
    expect(trackTranscribeUnavailable).toHaveBeenCalledWith({ optional: true });
  });

  describe("engine selection", () => {
    beforeEach(() => {
      runtimeDir = mkdtempSync(join(tmpdir(), "hf-transcribe-runtime-"));
      dirs.push(runtimeDir);
      const pkg = join(runtimeDir, "node_modules", "sherpa-onnx-node");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ main: "index.js" }));
      writeFileSync(join(pkg, "index.js"), "module.exports = {};");
      transcribeMock.mockImplementation(async (_in: string, dir: string) =>
        fakeTranscript(dir, "whisper"),
      );
      mlxMock.mockImplementation((_in: string, dir: string) => fakeTranscript(dir, "mlx"));
      execFileMock.mockReset();
      execFileMock.mockImplementation((_cmd, _args, _opts, done) => {
        const windows = [{ offset: 60, tokens: [" sherpa"], timestamps: [0.5], durations: [0.25] }];
        done(null, `HYPERFRAMES_PARAKEET_RESULT:${JSON.stringify(windows)}\n`, "");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(process.report, "getReport").mockReturnValue({
        header: { glibcVersionRuntime: "2.36" },
      } as never);
    });

    async function transcribeWith(engine: string, installed: typeof runners, language?: string) {
      Object.assign(runners, installed);
      const { dir, input } = dummyAudio();
      dirs.push(dir);
      await transcribeCmd.run!({ args: { input, json: true, engine, language } } as never);
      const out = lastJson();
      const words = JSON.parse(readFileSync(String(out.transcriptPath), "utf-8"));
      return { engine: out.engine, model: out.model, word: words[0]?.text, start: words[0]?.start };
    }

    it("installs whisper's stop handling only when whisper starts, after any install or download", async () => {
      const run = transcribeMock.getMockImplementation()!;
      const handlers: number[] = [];
      let signal: unknown;
      transcribeMock.mockImplementationOnce(async (input, outputDir, options) => {
        handlers.push(process.listenerCount("SIGTERM"));
        signal = options.startCancellation();
        handlers.push(process.listenerCount("SIGTERM"));
        return run(input, outputDir, options);
      });
      await transcribeWith("whisper", { sherpa: false, mlx: false });
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(handlers[1]).toBeGreaterThan(handlers[0]!);
    });

    it("auto and parakeet prefer sherpa-onnx, then parakeet-mlx, then whisper", async () => {
      const sherpa = {
        engine: "parakeet",
        model: "parakeet-tdt-0.6b-v3",
        word: "sherpa",
        start: 60.5,
      };
      expect(await transcribeWith("auto", { sherpa: true, mlx: true })).toEqual(sherpa);
      expect(await transcribeWith("parakeet", { sherpa: true, mlx: true })).toEqual(sherpa);
      expect(await transcribeWith("auto", { sherpa: false, mlx: true })).toMatchObject({
        engine: "parakeet",
        word: "mlx",
      });
      expect(await transcribeWith("auto", { sherpa: false, mlx: false })).toMatchObject({
        engine: "whisper",
        word: "whisper",
      });
      expect(await transcribeWith("whisper", { sherpa: true, mlx: true })).toMatchObject({
        engine: "whisper",
        word: "whisper",
      });
    });

    it.skipIf(process.platform === "win32")(
      "lets parakeet-mlx detect the language itself, since it has no --language option",
      async () => {
        const parakeet =
          await vi.importActual<typeof import("../whisper/parakeet.js")>("../whisper/parakeet.js");
        // Rejects --language the way parakeet-mlx does, and writes one token otherwise.
        const runner = join(runtimeDir, "parakeet-mlx");
        writeFileSync(
          runner,
          `#!/bin/sh
[ "$1" = --help ] && exit 0
in="$1"
for a in "$@"; do [ "$a" = --language ] && { echo "Error: No such option: --language" >&2; exit 2; }; done
while [ "$1" != --output-dir ]; do shift; done
echo '{"sentences":[{"tokens":[{"text":" hola","start":0,"end":1}]}]}' > "$2/$(basename "$in" .wav).json"
`,
        );
        chmodSync(runner, 0o755);
        vi.stubEnv("HYPERFRAMES_PARAKEET", runner);
        mlxMock.mockImplementation(parakeet.transcribeWithParakeet);

        expect(await transcribeWith("auto", { sherpa: false, mlx: true }, "es")).toMatchObject({
          engine: "parakeet",
          word: "hola",
        });
      },
    );

    it("auto uses Parakeet only for a language it transcribes", async () => {
      const both = { sherpa: true, mlx: true };
      expect(await transcribeWith("auto", both, "ja")).toMatchObject({ engine: "whisper" });
      expect(await transcribeWith("auto", both, "pt-BR")).toMatchObject({ engine: "parakeet" });
      expect(await transcribeWith("auto", both, "UK")).toMatchObject({ engine: "parakeet" });
      expect(transcribeMock).toHaveBeenCalledTimes(1);
    });

    it("--engine parakeet with a language it does not transcribe fails without falling back", async () => {
      Object.assign(runners, { sherpa: true, mlx: true });
      const { exitCode, out } = await transcribeFails("parakeet", { language: "ja" });
      expect(exitCode).toBe(1);
      expect(out.error).toMatch(
        /^Parakeet does not transcribe --language ja; it covers en, es, .*uk\. Use --engine whisper\.$/,
      );
      expect(execFileMock).not.toHaveBeenCalled();
      expect(transcribeMock).not.toHaveBeenCalled();
    });

    it("listens for Ctrl-C from before audio prep until the run ends", async () => {
      const before = process.listenerCount("SIGINT");
      let duringPrep = 0;
      prepareWavMock.mockImplementation((input: string) => {
        duringPrep = process.listenerCount("SIGINT");
        return input;
      });
      expect(await transcribeWith("auto", { sherpa: true, mlx: false })).toMatchObject({
        engine: "parakeet",
      });
      expect(duringPrep).toBe(before + 1);
      expect(process.listenerCount("SIGINT")).toBe(before);
    });

    it("exits 130 when Ctrl-C stops the whisper fallback too", async () => {
      crashChild("SIGABRT");
      // No signal reaches the listener in time: the synchronous whisper child's own signal decides.
      transcribeMock.mockImplementation(async () => {
        throw Object.assign(new Error("Command failed: whisper-cli"), { signal: "SIGINT" });
      });
      Object.assign(runners, { sherpa: true, mlx: false });
      const { exitCode, out } = await transcribeFails("auto");
      expect(exitCode).toBe(130);
      expect(out).toEqual({ ok: false, error: "Transcription cancelled" });
    });

    it("reports the fallback's own timeout as a failure, not a cancel", async () => {
      crashChild("SIGABRT");
      transcribeMock.mockImplementation(async () => {
        throw Object.assign(new Error("spawnSync whisper-cli ETIMEDOUT"), {
          code: "ETIMEDOUT",
          signal: "SIGTERM",
        });
      });
      Object.assign(runners, { sherpa: true, mlx: false });
      const { exitCode, out } = await transcribeFails("auto");
      expect(exitCode).toBe(1);
      expect(out.error).toMatch(/The whisper fallback failed too: spawnSync whisper-cli ETIMEDOUT/);
    });

    it("--engine parakeet with nothing installed names the install command", async () => {
      Object.assign(runners, { sherpa: false, mlx: false });
      const { dir, input } = dummyAudio();
      dirs.push(dir);
      await expect(
        transcribeCmd.run!({ args: { input, json: true, engine: "parakeet" } } as never),
      ).rejects.toThrow(CliRuntimeError);
      expect(lastJson().error).toContain("hyperframes models install parakeet");
      expect(transcribeMock).not.toHaveBeenCalled();
    });

    const crashChild = (signal: string, stderr = "") =>
      execFileMock.mockImplementation((_cmd, _args, _opts, done) => {
        done(Object.assign(new Error("Command failed"), { code: null, signal }), "", stderr);
      });

    async function transcribeFails(engine: string, extra: Record<string, unknown> = {}) {
      const { dir, input } = dummyAudio();
      dirs.push(dir);
      let exitCode = 0;
      try {
        await transcribeCmd.run!({ args: { input, json: true, engine, ...extra } } as never);
      } catch (err) {
        if (!(err instanceof CliRuntimeError)) throw err;
        exitCode = err.result.exitCode;
      }
      return { exitCode: exitCode || consumeCommandResult().exitCode, out: lastJson() };
    }

    it("auto names the Parakeet install when whisper is missing and Parakeet is not installed", async () => {
      transcribeMock.mockRejectedValue(new WhisperUnavailableError("whisper-cpp not found"));
      const { exitCode, out } = await transcribeFails("auto", { optional: true });
      expect(exitCode).toBe(0);
      expect(out).toEqual({
        ok: false,
        skipped: true,
        reason: "whisper_unavailable",
        install: "hyperframes models install parakeet",
      });
    });

    it.each([
      ["a language Parakeet does not transcribe", "auto", "ja"],
      ["an explicit --engine whisper", "whisper", undefined],
    ])("offers no Parakeet install for %s", async (_case, engine, language) => {
      transcribeMock.mockRejectedValue(new WhisperUnavailableError("whisper-cpp not found"));
      const { out } = await transcribeFails(engine, { optional: true, language });
      expect(out).toEqual({ ok: false, skipped: true, reason: "whisper_unavailable" });
    });

    it.each(["whisper", "auto"])(
      "--no-runtime-install reaches %s including the fallback",
      async (engine) => {
        crashChild("SIGABRT");
        Object.assign(runners, { sherpa: true, mlx: false });
        const { dir, input } = dummyAudio();
        dirs.push(dir);
        await runCommand(transcribeCmd, {
          rawArgs: [input, "--engine", engine, "--json", "--no-runtime-install"],
        });
        expect(transcribeMock.mock.calls.at(-1)?.[2]).toMatchObject({ installRuntime: false });
      },
    );

    it("auto falls back to whisper with one line naming the Parakeet error and the repair", async () => {
      crashChild("SIGABRT", "terminate called after throwing an instance of 'Ort::Exception'\n");
      expect(await transcribeWith("auto", { sherpa: true, mlx: false })).toMatchObject({
        engine: "whisper",
        word: "whisper",
      });
      const warnings = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        /^.*Parakeet failed: .*SIGABRT.*Ort::Exception.*hyperframes models install parakeet.*Using whisper/,
      );
    });

    it("an explicit --engine parakeet fails with the Parakeet error instead of falling back", async () => {
      crashChild("SIGABRT", "Protobuf parsing failed.\n");
      Object.assign(runners, { sherpa: true, mlx: false });
      const { exitCode, out } = await transcribeFails("parakeet");
      expect(exitCode).toBe(1);
      expect(out.error).toMatch(
        /^Parakeet failed: .*Protobuf parsing failed\. To repair it, run: hyperframes models install parakeet$/,
      );
      expect(transcribeMock).not.toHaveBeenCalled();
    });

    it("keeps a long decoder error whole up to a bound", async () => {
      crashChild(
        "SIGABRT",
        `HYPERFRAMES_PARAKEET_ERROR:${"a".repeat(590)} tail ${"b".repeat(2000)}\n`,
      );
      Object.assign(runners, { sherpa: true, mlx: false });
      const { out } = await transcribeFails("parakeet");
      expect(out.error).toContain(`${"a".repeat(590)} tail`);
      expect(out.error).toContain("b…. To repair it");
      expect(String(out.error).length).toBeLessThan(800);
    });

    it("reports the Parakeet error, not whisper_unavailable, when the fallback is missing too", async () => {
      crashChild("SIGABRT");
      transcribeMock.mockRejectedValue(new WhisperUnavailableError("whisper-cpp not found"));
      Object.assign(runners, { sherpa: true, mlx: false });
      const { exitCode, out } = await transcribeFails("auto", { optional: true });
      expect(exitCode).toBe(1);
      expect(out.skipped).toBeUndefined();
      expect(out.error).toMatch(/^Parakeet failed: .*install parakeet.*whisper-cpp not found/);
    });

    it("stops with exit 130 on Ctrl-C instead of falling back", async () => {
      crashChild("SIGINT");
      Object.assign(runners, { sherpa: true, mlx: false });
      const { exitCode, out } = await transcribeFails("auto");
      expect(exitCode).toBe(130);
      expect(out).toEqual({ ok: false, error: "Transcription cancelled" });
      expect(transcribeMock).not.toHaveBeenCalled();
    });

    describe.skipIf(process.platform === "win32")("when ffmpeg exits 255 while preparing", () => {
      it.each([
        ["Exiting normally, received signal 2.", 130, "Transcription cancelled"],
        [
          "Error opening input files: Operation not permitted",
          1,
          "ffmpeg failed: Error opening input files: Operation not permitted",
        ],
        [
          "Output file does not contain any stream\nError opening output files: Invalid argument",
          1,
          "ffmpeg failed: Error opening output files: Invalid argument\nOutput file does not contain any stream",
        ],
      ])("after saying %j, the run exits %i", async (said, code, error) => {
        const actual = await vi.importActual<typeof import("../whisper/transcribe.js")>(
          "../whisper/transcribe.js",
        );
        prepareWavMock.mockImplementation((input: string) => actual.prepareWav(input));
        const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-ffmpeg-"));
        dirs.push(dir);
        const ffmpeg = join(dir, "ffmpeg");
        const script = `process.stderr.write(${JSON.stringify(`${said}\n`)}); process.exit(255);`;
        writeFileSync(ffmpeg, `#!${process.execPath}\n${script}\n`);
        chmodSync(ffmpeg, 0o755);
        vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", ffmpeg);
        Object.assign(runners, { sherpa: true, mlx: false });
        const { exitCode, out } = await transcribeFails("auto");
        expect(exitCode).toBe(code);
        expect(out).toEqual({ ok: false, error });
        expect(transcribeMock).not.toHaveBeenCalled();
      });
    });

    it("fails an unreadable input as an input error, with no Parakeet repair and no fallback", async () => {
      prepareWavMock.mockImplementation(() => {
        throw new Error("Command failed: ffmpeg -i silent.mp4 -vn -ar 16000");
      });
      Object.assign(runners, { sherpa: true, mlx: false });
      for (const optional of [false, true]) {
        const { exitCode, out } = await transcribeFails("auto", { optional });
        expect(exitCode).toBe(1);
        expect(out).toEqual({
          ok: false,
          error: "Command failed: ffmpeg -i silent.mp4 -vn -ar 16000",
        });
      }
      expect(execFileMock).not.toHaveBeenCalled();
      expect(transcribeMock).not.toHaveBeenCalled();
    });

    it("prepares the audio once, hands the same WAV to the fallback, and removes it", async () => {
      crashChild("SIGABRT");
      const prepared: string[] = [];
      prepareWavMock.mockImplementation((input: string) => {
        prepared.push(`${input}.16k.wav`);
        writeFileSync(prepared[0]!, "wav");
        return prepared[0]!;
      });
      expect(await transcribeWith("auto", { sherpa: true, mlx: false })).toMatchObject({
        engine: "whisper",
      });
      expect(prepared).toHaveLength(1);
      const sherpaInput = JSON.parse(
        execFileMock.mock.calls[0]?.[2].env.HYPERFRAMES_PARAKEET_INPUT,
      );
      expect(sherpaInput.wavPath).toBe(prepared[0]);
      expect(transcribeMock.mock.calls[0]?.[0]).toBe(prepared[0]);
      expect(existsSync(prepared[0]!)).toBe(false);
    });

    it("gives the decode at least 30 minutes, and twice the audio length", async () => {
      Object.assign(runners, { sherpa: true, mlx: false });
      for (const [seconds, timeout] of [
        [60, 1_800_000],
        [3600, 7_200_000],
      ]) {
        audioSeconds = seconds!;
        const { dir, input } = dummyAudio();
        dirs.push(dir);
        await transcribeCmd.run!({ args: { input, json: true, engine: "auto" } } as never);
        expect(execFileMock.mock.calls.at(-1)?.[2]).toMatchObject({ timeout });
      }
      audioSeconds = 1;
    });

    it("succeeds with 0 words when the audio has no speech", async () => {
      execFileMock.mockImplementation((_cmd, _args, _opts, done) => {
        done(null, `HYPERFRAMES_PARAKEET_RESULT:${JSON.stringify([])}\n`, "");
      });
      Object.assign(runners, { sherpa: true, mlx: false });
      const { dir, input } = dummyAudio();
      dirs.push(dir);
      await transcribeCmd.run!({ args: { input, json: true, engine: "auto" } } as never);
      expect(lastJson()).toMatchObject({ ok: true, engine: "parakeet", wordCount: 0 });

      await transcribeCmd.run!({ args: { input, json: true, engine: "auto", to: "srt" } } as never);
      expect(lastJson()).toMatchObject({ ok: true, wordCount: 0, format: "srt" });
      expect(readFileSync(join(dir, "transcript.srt"), "utf-8")).toBe("");
    });

    it.runIf(process.platform === "linux" && process.arch === "x64")(
      "skips Parakeet when glibc is too old for sherpa-onnx, never naming the install command",
      async () => {
        vi.mocked(process.report.getReport).mockReturnValue({
          header: { glibcVersionRuntime: "2.31" },
        } as never);
        expect(await transcribeWith("auto", { sherpa: true, mlx: false })).toMatchObject({
          engine: "whisper",
        });
        expect(execFileMock).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
        const { exitCode, out } = await transcribeFails("parakeet");
        expect(exitCode).toBe(1);
        expect(out.error).toMatch(
          /^Parakeet needs glibc 2\.32 or newer; this system has glibc 2\.31\.$/,
        );
      },
    );
  });

  it("imports an SRT and exports an SRT sidecar from transcript.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
    dirs.push(dir);
    const input = join(dir, "sample.srt");
    const sample = `1
00:00:01,000 --> 00:00:03,500
Write HTML.

2
00:00:03,500 --> 00:00:06,000
Render video. Built for agents.
`;
    writeFileSync(input, sample);

    await transcribeCmd.run!({ args: { input, dir, json: true } } as never);
    const transcriptPath = join(dir, "transcript.json");

    await transcribeCmd.run!({ args: { input: transcriptPath, to: "srt", json: true } } as never);
    const outputPath = join(dir, "transcript.srt");

    expect(readFileSync(outputPath, "utf-8")).toBe(sample);
    const log = vi.mocked(console.log).mock.calls.at(-1)?.[0];
    expect(typeof log).toBe("string");
    if (typeof log !== "string") throw new Error("Expected JSON log output");
    expect(JSON.parse(log)).toEqual({
      ok: true,
      format: "srt",
      wordCount: 2,
      outputPath,
    });
  });

  it("transcribes a media file straight to a VTT sidecar in one run", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const words = [
      { id: "w0", text: "Write", start: 0, end: 0.5 },
      { id: "w1", text: "HTML.", start: 0.5, end: 1 },
    ];
    transcribeMock.mockImplementation(async (_input, outputDir) => {
      const result = fakeTranscript(outputDir, "whisper");
      writeFileSync(result.transcriptPath, JSON.stringify(words));
      return { ...result, wordCount: 2 };
    });

    await runCommand(transcribeCmd, {
      rawArgs: [input, "--dir", dir, "--engine", "whisper", "--to", "vtt", "--json"],
    });

    const outputPath = join(dir, "transcript.vtt");
    expect(readFileSync(outputPath, "utf-8")).toBe(formatVtt(words));
    expect(JSON.parse(readFileSync(join(dir, "transcript.json"), "utf8"))).toEqual(words);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(lastJson()).toMatchObject({ ok: true, wordCount: 2, format: "vtt", outputPath });
  });

  it("fails on a missing --output folder before transcribing", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const output = join(dir, "missing", "captions.srt");

    await expect(
      transcribeCmd.run!({
        args: { input, json: true, engine: "whisper", to: "srt", output },
      } as never),
    ).rejects.toThrow(CliRuntimeError);

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(lastJson()).toEqual({
      ok: false,
      error: `Output folder not found: ${join(dir, "missing")}`,
    });
  });

  it.each([
    ["an existing folder", (dir: string) => dir, "--output is a folder"],
    [
      "a path ending in a slash",
      (dir: string) => join(dir, "captions") + "/",
      "--output is a folder",
    ],
    [
      "a path under a file",
      (dir: string) => join(dir, "narration.wav", "out.srt"),
      "Output folder not found",
    ],
    ["the input media", (dir: string) => join(dir, "narration.wav"), "--output would overwrite"],
    [
      "the transcript it writes",
      (dir: string) => join(dir, "transcript.json"),
      "--output would overwrite",
    ],
  ])("fails --output naming %s before transcribing", async (_name, output, error) => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);

    await expect(
      transcribeCmd.run!({
        args: { input, json: true, engine: "whisper", to: "srt", output: output(dir) },
      } as never),
    ).rejects.toThrow(CliRuntimeError);

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(lastJson()).toMatchObject({ ok: false, error: expect.stringContaining(error) });
  });

  it("says the transcript was saved when the caption file cannot be written", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const output = join(dir, "captions.srt");
    transcribeMock.mockImplementation(async (_input, outputDir) => {
      // A folder at the caption path makes the write fail on any OS, even as root.
      mkdirSync(output);
      return fakeTranscript(outputDir, "whisper");
    });

    await transcribeCmd.run!({
      args: { input, json: true, engine: "whisper", to: "srt", output },
    } as never);

    expect(consumeCommandResult().exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        `Transcript saved to ${join(dir, "transcript.json")}, but the caption file ${output} could not be written: `,
      ),
    });
    expect(existsSync(join(dir, "transcript.json"))).toBe(true);
  });

  it("groups transcribed CJK words into captions instead of one cue per word", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    transcribeMock.mockImplementation(async (_input, outputDir) => {
      const result = fakeTranscript(outputDir, "whisper");
      writeFileSync(
        result.transcriptPath,
        JSON.stringify([
          { text: "今日はいい", start: 0, end: 0.8 },
          { text: "天気ですね", start: 0.8, end: 1.6 },
        ]),
      );
      return { ...result, wordCount: 2 };
    });

    await transcribeCmd.run!({
      args: { input, dir, json: true, engine: "whisper", to: "srt" },
    } as never);

    const { words: cues } = loadTranscript(join(dir, "transcript.srt"));
    expect(cues.map((cue) => cue.text)).toEqual(["今日はいい天気ですね"]);
  });

  it("rejects a below-minimum --timeout with a discoverable error", async () => {
    const { dir, input } = dummyAudio();
    dirs.push(dir);
    const consoleLog = vi.mocked(console.log);

    // 100 is well below the 5000ms minimum — must fail loud instead of silently
    // reverting to the auto-scaled default (the whole point of the flag is
    // that the user explicitly asked for a specific value).
    await expect(
      transcribeCmd.run!({ args: { input, json: true, timeout: "100" } } as never),
    ).rejects.toThrow(CliRuntimeError);

    const log = consoleLog.mock.calls.at(-1)?.[0];
    expect(typeof log).toBe("string");
    if (typeof log !== "string") throw new Error("Expected JSON log output");
    const parsed = JSON.parse(log);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("--timeout");
    expect(parsed.error).toContain("5000");
  });

  it("--preserve-cues keeps single-word cues separate when exporting from JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-transcribe-test-"));
    dirs.push(dir);
    // Single-word cues have no internal whitespace, so the whitespace heuristic
    // can't tell them from word-level whisper output. --preserve-cues forces 1:1.
    const transcriptPath = join(dir, "transcript.json");
    writeFileSync(
      transcriptPath,
      JSON.stringify([
        { text: "Yes", start: 0, end: 1 },
        { text: "No", start: 1, end: 2 },
      ]),
    );

    await transcribeCmd.run!({
      args: { input: transcriptPath, to: "srt", "preserve-cues": true, json: true },
    } as never);

    const output = readFileSync(join(dir, "transcript.srt"), "utf-8");
    expect(output).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nYes\n\n2\n00:00:01,000 --> 00:00:02,000\nNo\n",
    );
  });
});
