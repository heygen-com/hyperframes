import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CaptureFailure,
  processCompositionAudio,
  type AudioFailureDiagnostic,
} from "@hyperframes/engine";
import { applyDistributedAudioWarningPolicy } from "../../../producer/src/services/distributed/plan.js";
import { buildSyntheticRenderJob } from "../../../producer/src/services/distributed/shared.js";
import {
  createRenderJob,
  executeRenderJob,
  RenderQualityError,
  type RenderJob,
} from "@hyperframes/producer";
import { runAudioStage } from "../../../producer/src/services/render/stages/audioStage.js";
import { renderFailureDiagnostic, renderMachineDiagnostic } from "./renderDiagnostic.js";

const roots: string[] = [];
const originalIsTTY = process.stdout.isTTY;
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function capture(values: readonly unknown[] | (() => void), terminal = false): string {
  Object.defineProperty(process.stdout, "isTTY", { value: terminal, configurable: true });
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  if (typeof values === "function") values();
  else renderMachineDiagnostic(values);
  return output;
}

function captureJob(job: Pick<RenderJob, "warnings">): string {
  return capture(job.warnings.flatMap((warning) => warning.details?.audioFailures ?? []));
}

const PRIVATE =
  "/private/customer/project?token=secret-token element-PRIVATE https://private.test/prompt";
const failure = {
  stage: "prepare",
  reason: "ffmpeg_failed",
  owner: "system",
  retryable: false,
  detail: PRIVATE,
  elementId: PRIVATE,
  subprocess: { exitCode: 7, terminationReason: "exit", stderr: PRIVATE, args: [PRIVATE] },
};

describe("render diagnostic wire", () => {
  it("re-projects every field and bounds the record count at the final writer", () => {
    const line = capture(Array.from({ length: 100 }, () => failure));
    const parsed = JSON.parse(line.slice("@hf-diagnostic ".length));
    expect(parsed.version).toBe(1);
    expect(parsed.operation).toBe("render");
    expect(parsed.audioFailures).toHaveLength(16);
    expect(parsed.audioFailures[0]).toEqual({
      stage: "prepare",
      reason: "ffmpeg_failed",
      owner: "system",
      retryable: false,
      subprocess: { exitCode: 7, terminationReason: "exit" },
    });
    expect(line).not.toContain(PRIVATE);
    expect(line.trim().split("\n")).toHaveLength(1);
  });

  it.each(["stage", "reason", "owner", "retryable"])(
    "rejects private text substituted for %s",
    (key) => {
      expect(capture([{ ...failure, [key]: PRIVATE }])).toBe("");
    },
  );

  it("drops non-allowlisted subprocess strings and unbounded exit codes", () => {
    const line = capture([
      {
        ...failure,
        subprocess: {
          exitCode: Infinity,
          signal: PRIVATE,
          terminationReason: PRIVATE,
          code: PRIVATE,
          message: PRIVATE,
          error: { code: PRIVATE, message: PRIVATE },
        },
      },
    ]);
    expect(JSON.parse(line.slice("@hf-diagnostic ".length)).audioFailures[0].subprocess).toEqual(
      {},
    );
    expect(line).not.toContain(PRIVATE);
  });

  it.each([
    [
      new RenderQualityError([
        { code: "audio_processing_failed", message: PRIVATE, stage: "capture-readiness" },
      ]),
      "AUDIO_PROCESSING_FAILED",
    ],
    [
      Object.assign(new Error(`Video extraction failed ${PRIVATE}`), {
        code: "VIDEO_SOURCE_UNRENDERABLE",
      }),
      "VIDEO_SOURCE_UNRENDERABLE",
    ],
    [new Error(`[HDR] No Chrome binary found [ACME_LAUNCH] ${PRIVATE}`), "RENDER_FAILED"],
    [
      Object.assign(new Error(`ENOENT: no such file, open '${PRIVATE}'`), { code: "ENOENT" }),
      "ENOENT",
    ],
    [new Error(`EPERM: operation not permitted, rename '${PRIVATE}'`), "EPERM"],
    [
      new CaptureFailure({
        kind: "transient_browser",
        message: `[Parallel] Capture failed: Worker 0: [FrameCapture] Composition has zero duration. ${PRIVATE}`,
      }),
      "COMPOSITION_ZERO_DURATION",
    ],
    [
      new CaptureFailure({ kind: "authoring", message: PRIVATE, pageErrorLines: [PRIVATE] }),
      "PAGE_ERROR",
    ],
    [
      new CaptureFailure({ kind: "protocol_timeout", message: PRIVATE }),
      "CAPTURE_PROTOCOL_TIMEOUT",
    ],
    [new Error(PRIVATE), "RENDER_FAILED"],
  ])("names a failed render's code without its words (%#)", (error, code) => {
    const line = capture(() => renderFailureDiagnostic(undefined, error, false));
    expect(JSON.parse(line.slice("@hf-diagnostic ".length))).toEqual({
      version: 1,
      operation: "render",
      code,
    });
    expect(line).not.toContain(PRIVATE);
  });

  it("stays silent for a terminal or a container attached to a terminal", () => {
    expect(capture([failure], true)).toBe("");
    vi.unstubAllEnvs();
    vi.stubEnv("HYPERFRAMES_STDOUT_IS_TTY", "1");
    expect(capture([failure])).toBe("");
  });
});

const cases: Array<{ name: string; script?: string; expected: AudioFailureDiagnostic }> = [
  {
    name: "missing executable",
    expected: {
      stage: "prepare",
      reason: "ffmpeg_unavailable",
      owner: "system",
      retryable: true,
      subprocess: { terminationReason: "spawn_error", code: "ENOENT" },
    },
  },
  {
    name: "ordinary exit",
    script: 'process.stderr.write("private-customer-stderr"); process.exit(7);',
    expected: {
      stage: "prepare",
      reason: "ffmpeg_failed",
      owner: "system",
      retryable: false,
      subprocess: { exitCode: 7, terminationReason: "exit" },
    },
  },
  {
    name: "inactivity",
    script: "setInterval(() => {}, 1000);",
    expected: {
      stage: "prepare",
      reason: "ffmpeg_timeout",
      owner: "system",
      retryable: true,
      subprocess: { signal: "SIGTERM", terminationReason: "inactivity" },
    },
  },
  {
    name: "group submix",
    script:
      'const fs = require("node:fs"); if (process.argv.includes("-filter_complex_script")) process.exit(9); fs.writeFileSync(process.argv.at(-1), "audio");',
    expected: {
      stage: "mix",
      reason: "ffmpeg_failed",
      owner: "system",
      retryable: false,
      subprocess: { exitCode: 9, terminationReason: "exit" },
    },
  },
];

// The executable stand-ins use a POSIX shebang; field validation above runs on every OS.
for (const scenario of cases) {
  it.skipIf(process.platform === "win32")(
    `carries a real ${scenario.name} through the mixer, producer policy and final CLI line`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), "hf-diagnostic-private-"));
      roots.push(root);
      const executable = join(root, "ffmpeg-private");
      if (scenario.script) {
        writeFileSync(executable, `#!${process.execPath}\n${scenario.script}\n`);
        chmodSync(executable, 0o755);
      }
      vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", executable);
      writeFileSync(join(root, "private.wav"), "RIFF0000WAVEfmt ");
      const result = await processCompositionAudio(
        [
          {
            id: "private-element",
            src: "private.wav",
            type: "audio",
            start: 0,
            end: 1,
            mediaStart: 0,
            layer: 0,
            volume: 1,
            ...(scenario.name === "group submix"
              ? { groupId: "private-group", groupVolume: 1 }
              : {}),
          },
        ],
        root,
        join(root, "work"),
        join(root, "out.m4a"),
        1,
        undefined,
        { ffmpegProcessTimeout: scenario.name === "inactivity" ? 200 : 5_000 },
      );
      expect(result.success).toBe(false);
      const job = buildSyntheticRenderJob({
        fps: { num: 30, den: 1 },
        format: "mp4",
        quality: "high",
        hdrMode: "force-sdr",
        entryFile: "index.html",
      });
      expect(() =>
        applyDistributedAudioWarningPolicy(job, result.error ?? "failed", result.failures),
      ).toThrow();
      const line = captureJob(job);
      expect(JSON.parse(line.slice("@hf-diagnostic ".length)).audioFailures).toEqual([
        scenario.expected,
      ]);
      for (const secret of [
        root,
        "private.wav",
        "private-element",
        "private-group",
        "private-customer-stderr",
      ])
        expect(line).not.toContain(secret);
    },
  );
}

it("carries a local render audio failure through the real orchestration warning policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-local-audio-diagnostic-"));
  roots.push(root);
  vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", process.execPath);
  writeFileSync(join(root, "private.wav"), "RIFF0000WAVEfmt ");
  writeFileSync(
    join(root, "index.html"),
    `<html><body><div data-composition-id="root" data-width="320" data-height="240" data-duration="1"><audio id="private-cue" src="private.wav" data-start="0" data-duration="1"></audio></div></body></html>`,
  );
  const job = createRenderJob({ fps: 30, quality: "standard", hdrMode: "force-sdr" });
  await expect(executeRenderJob(job, root, join(root, "out.mp4"))).rejects.toThrow();
  const line = captureJob(job);
  expect(JSON.parse(line.slice("@hf-diagnostic ".length)).audioFailures).toEqual([
    {
      stage: "prepare",
      reason: "ffmpeg_failed",
      owner: "system",
      retryable: false,
      subprocess: { exitCode: 9, terminationReason: "exit" },
    },
  ]);
  for (const secret of [root, "private.wav", "private-cue"]) expect(line).not.toContain(secret);
});

it.skipIf(process.platform === "win32")(
  "keeps the triggering seventeenth interruption in the final bounded record",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-audio-mixed-failure-"));
    roots.push(root);
    const executable = join(root, "ffmpeg");
    writeFileSync(executable, `#!${process.execPath}\nprocess.kill(process.pid, "SIGTERM");\n`);
    chmodSync(executable, 0o755);
    vi.stubEnv("HYPERFRAMES_FFMPEG_PATH", executable);
    writeFileSync(join(root, "private.wav"), "RIFF0000WAVEfmt ");
    const track = {
      id: "private-cue",
      src: "private.wav",
      type: "audio" as const,
      start: 0,
      end: 1,
      mediaStart: 0,
      volume: 1,
      layer: 0,
    };
    let interrupted: unknown;
    try {
      await runAudioStage({
        projectDir: root,
        compiledDir: root,
        workDir: join(root, "work"),
        totalFrames: 30,
        fps: { num: 30, den: 1 },
        ffmpegProcessTimeout: 5_000,
        audioGain: 1,
        abortSignal: undefined,
        assertNotAborted: () => {},
        audios: [
          ...Array.from({ length: 16 }, (_, i) => ({
            ...track,
            id: `private-missing-${i}`,
            src: `private-missing-${i}.wav`,
          })),
          track,
        ],
      });
    } catch (error) {
      interrupted = error;
    }
    expect(interrupted).toBeInstanceOf(Error);
    const line = capture(() => renderFailureDiagnostic(undefined, interrupted, false));
    const records = JSON.parse(line.slice("@hf-diagnostic ".length)).audioFailures;
    expect(records).toHaveLength(16);
    expect(records[0]).toEqual({
      stage: "prepare",
      reason: "external_interruption",
      owner: "system",
      retryable: true,
      subprocess: { signal: "SIGTERM", terminationReason: "exit" },
    });
    expect(
      records.slice(1).every((entry: { reason: string }) => entry.reason === "source_not_found"),
    ).toBe(true);
    expect(line).not.toMatch(/private-|secret/);
  },
);
