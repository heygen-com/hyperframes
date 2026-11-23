import { describe, expect, it, setSystemTime } from "bun:test";
import type { ParallelProgress } from "@hyperframes/engine";
import type { RenderJob } from "../renderOrchestrator.js";
import {
  describeWorkerPhases,
  forgetWorkerPhases,
  reportAssembleProgress,
  reportEncodeProgress,
  reportExtractProgress,
  reportFrameProgress,
  reportWorkerStartup,
  resolveBrowserMediaEnd,
} from "./shared.js";

describe("resolveBrowserMediaEnd", () => {
  it("prefers a runtime duration over a stale compiler-clamped end", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, 56.738)).toBe(56.738);
  });

  it("projects a runtime duration from the browser-local start", () => {
    expect(resolveBrowserMediaEnd(2, 7.04, 56.738)).toBe(58.738);
  });

  it("falls back to data-end when runtime duration is unavailable", () => {
    expect(resolveBrowserMediaEnd(0, 5.04, Number.NaN)).toBe(5.04);
    expect(resolveBrowserMediaEnd(0, 5.04, 0)).toBe(5.04);
  });
});

describe("reportWorkerStartup", () => {
  it("counts ready workers and drops ids past a smaller retry's worker count", () => {
    const job = { progress: 25 } as RenderJob;
    const stages: string[] = [];
    const phase = (workerId: number, name: string, activeWorkers: number) => {
      setSystemTime(Date.now() + 1_000);
      reportWorkerStartup(
        job,
        {
          activeWorkers,
          latestWorkerPhase: { workerId, phase: name },
        } as unknown as ParallelProgress,
        (_job, stage) => {
          stages.push(stage);
        },
      );
    };
    try {
      phase(0, "browser_launch", 3);
      phase(2, "frame_capture", 3);
      phase(0, "frame_capture", 3);
      phase(0, "browser_launch", 2);
      phase(1, "frame_capture", 2);
    } finally {
      setSystemTime();
    }
    expect(stages).toEqual([
      "Starting browsers (0/3 ready)",
      "Starting browsers (1/3 ready)",
      "Starting browsers (2/3 ready)",
      "Starting browsers (0/2 ready)",
      "Starting browsers (1/2 ready)",
    ]);
  });
});

describe("describeWorkerPhases", () => {
  it("names the last phase each worker reported, and nothing before any did", () => {
    const job = { progress: 25 } as RenderJob;
    expect(describeWorkerPhases(job)).toBeUndefined();
    const phase = (workerId: number, name: string) =>
      reportWorkerStartup(
        job,
        {
          activeWorkers: 2,
          latestWorkerPhase: { workerId, phase: name },
        } as unknown as ParallelProgress,
        undefined,
      );
    phase(0, "browser_launch");
    phase(1, "session_init");
    phase(0, "frame_capture");
    expect(describeWorkerPhases(job)).toBe(
      "Last phase per worker: worker 0 frame_capture, worker 1 session_init.",
    );
    forgetWorkerPhases(job);
    expect(describeWorkerPhases(job)).toBeUndefined();
  });
});

describe("stage progress for machines", () => {
  const job = () => ({ progress: 0, status: "rendering" }) as unknown as RenderJob;
  const heard = (j: RenderJob) => {
    const seen: unknown[] = [];
    return {
      seen,
      onProgress: (_job: RenderJob, stage: string) =>
        void seen.push({ stage, progress: j.progress, ...j.stageProgress }),
    };
  };

  it("names capture frames done out of total", () => {
    const j = job();
    const { seen, onProgress } = heard(j);
    reportFrameProgress(j, "Capturing frame 3/3", 70, onProgress, 3, 3);
    expect(seen).toEqual([
      { stage: "Capturing frame 3/3", progress: 70, code: "capture", done: 3, total: 3 },
    ]);
  });

  it("moves extract_video from 10 to 20 by frames done", () => {
    const j = job();
    const { seen, onProgress } = heard(j);
    reportExtractProgress(j, 0, 40, onProgress);
    reportExtractProgress(j, 40, 40, onProgress);
    expect(seen).toEqual([
      { stage: "Extracting video frames", progress: 10, code: "extract_video", done: 0, total: 40 },
      {
        stage: "Extracting video frames",
        progress: 20,
        code: "extract_video",
        done: 40,
        total: 40,
      },
    ]);
  });

  it("moves encode from where capture left the bar to 90, never back", () => {
    const j = job();
    j.progress = 80;
    const { seen, onProgress } = heard(j);
    reportEncodeProgress(j, 0, 600, onProgress, 80);
    reportEncodeProgress(j, 600, 600, onProgress, 80);
    expect(seen).toEqual([
      { stage: "Encoding frame 0/600", progress: 80, code: "encode", done: 0, total: 600 },
      { stage: "Encoding frame 600/600", progress: 90, code: "encode", done: 600, total: 600 },
    ]);
  });

  it("sends a stage's closing update once when ffmpeg already reported the last frame", () => {
    const j = job();
    const { seen, onProgress } = heard(j);
    reportEncodeProgress(j, 600, 600, onProgress, 75);
    reportEncodeProgress(j, 600, 600, onProgress, 75);
    expect(seen).toHaveLength(1);
  });

  it("reports nothing for a stage with no frames or seconds, so the bar never turns NaN", () => {
    const j = job();
    j.progress = 80;
    const { seen, onProgress } = heard(j);
    reportEncodeProgress(j, 0, 0, onProgress, 80);
    reportAssembleProgress(j, 0, 0, onProgress);
    expect(seen).toEqual([]);
    expect(j.progress).toBe(80);
  });

  it("keeps assemble under 100 until the render completes, even past the end", () => {
    const j = job();
    j.progress = 90;
    const { seen, onProgress } = heard(j);
    reportAssembleProgress(j, 25, 20, onProgress);
    expect(seen).toEqual([
      { stage: "Assembling final video", progress: 99, code: "assemble", done: 20, total: 20 },
    ]);
  });
});
