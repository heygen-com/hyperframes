export type SceneFrameWindow = {
  scene: string;
  durationMs: number;
  expectedFrames: number;
  presentedFrames: number;
  decoderMs: number[];
  callbackDelayMs: number[];
};

export type SceneFrameSummary = {
  scene: string;
  expectedFps: number;
  presentedFps: number;
  missedFps: number;
  missedPercent: number;
  decoderP95Ms: number | null;
  callbackDelayP95Ms: number | null;
  frameBudgetMs: number;
};

export type FrameIntervalSummary = {
  frameBudgetMs: number;
  observedFrames: number;
  missedFrames: number;
  expectedFrames: number;
  missedPercent: number;
  p95IntervalMs: number;
  longFrameCount: number;
};

export function percentile(samples: number[], fraction: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function summarizeFrameIntervals(
  intervalsMs: number[],
  targetFps: number,
): FrameIntervalSummary {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error("targetFps must be positive");
  }
  if (intervalsMs.length === 0) {
    throw new Error("at least one frame interval is required");
  }

  const frameBudgetMs = 1_000 / targetFps;
  for (const interval of intervalsMs) {
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error("frame intervals must be positive finite numbers");
    }
  }

  const missedFrames = intervalsMs.reduce(
    (total, interval) => total + Math.max(0, Math.round(interval / frameBudgetMs) - 1),
    0,
  );
  const expectedFrames = intervalsMs.length + missedFrames;
  return {
    frameBudgetMs,
    observedFrames: intervalsMs.length,
    missedFrames,
    expectedFrames,
    missedPercent: (missedFrames / expectedFrames) * 100,
    p95IntervalMs: percentile(intervalsMs, 0.95)!,
    longFrameCount: intervalsMs.filter((interval) => interval > 50).length,
  };
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

export function summarizeSceneFrames(
  windows: SceneFrameWindow[],
  targetFps: number,
): SceneFrameSummary[] {
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new Error("targetFps must be positive");
  }
  if (windows.length === 0) {
    throw new Error("at least one scene measurement is required");
  }

  return windows.map((window) => {
    if (window.scene.trim().length === 0) {
      throw new Error("scene must not be empty");
    }
    if (!Number.isFinite(window.durationMs) || window.durationMs <= 0) {
      throw new Error("durationMs must be positive");
    }
    if (!Number.isFinite(window.expectedFrames) || window.expectedFrames <= 0) {
      throw new Error("expectedFrames must be positive");
    }
    assertFiniteNonNegative(window.presentedFrames, "presentedFrames");
    for (const duration of window.decoderMs) assertFiniteNonNegative(duration, "decoderMs item");
    for (const delay of window.callbackDelayMs)
      assertFiniteNonNegative(delay, "callbackDelayMs item");

    const durationSeconds = window.durationMs / 1_000;
    const missedFrames = Math.max(0, window.expectedFrames - window.presentedFrames);
    return {
      scene: window.scene,
      expectedFps: window.expectedFrames / durationSeconds,
      presentedFps: window.presentedFrames / durationSeconds,
      missedFps: missedFrames / durationSeconds,
      missedPercent: (missedFrames / window.expectedFrames) * 100,
      decoderP95Ms: percentile(window.decoderMs, 0.95),
      callbackDelayP95Ms: percentile(window.callbackDelayMs, 0.95),
      frameBudgetMs: 1_000 / targetFps,
    };
  });
}
